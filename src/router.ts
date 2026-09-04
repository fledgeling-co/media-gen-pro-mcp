/**
 * Choosing the model from the prompt, with a model.
 *
 * This reverses the position the advisory layer took. That one deliberately
 * never routed: it generated with whatever it was asked for and printed a note
 * saying what else existed, on the grounds that silent substitution makes a
 * caller's own logs lie. The owner overruled it for the no-style case, which is
 * the case where there is nothing to substitute FOR: with no `style` the server
 * was picking `openai` from a constant, which is not a decision about the prompt
 * at all, merely a default that happened to be right sometimes.
 *
 * So the rule is narrow. An explicit `style` is still obeyed exactly and never
 * second-guessed. Only an absent one triggers inference, and the answer is
 * always reported, so the caller can see which model ran and why.
 *
 * **The cost.** One extra call on a flash-lite model per generation, hundreds of
 * output tokens at most. Against an image model's price that is close to noise,
 * which is what makes this affordable for routing where it was not affordable
 * for advice: advice is worth less than the call, a wrong model is worth more.
 */

import { createGateway } from '@ai-sdk/gateway';
import { Output, generateText } from 'ai';
import { z } from 'zod';
import type { Config } from './config.js';
import { type Vendor, nearestReachableVendor, resolveVendor } from './models.js';

/**
 * The classifier.
 *
 * The cheapest capable thing on the gateway, because this is a labelling job and
 * paying frontier prices for it would cost more than the mistake it prevents.
 */
export const ROUTER_MODEL = 'google/gemini-3.1-flash-lite';

/**
 * What the classifier is allowed to answer.
 *
 * Exported so a test can prove every one of these resolves to a real vendor.
 * The enum and the alias table are maintained separately, and a choice that
 * resolves to nothing degrades every routed request for that category to the
 * configured default without anything failing loudly — so the drift is worth a
 * test rather than a comment.
 */
export const CHOICES = [
  'openai',
  'gemini-pro',
  'gemini',
  'gemini-lite',
  'photoreal',
  'recraft-utility',
  'seedream',
  'grok',
  'muse',
  'svg',
] as const;

const DecisionSchema = z.object({
  choice: z.enum(CHOICES),
  reason: z.string().max(200),
});

export interface RoutingDecision {
  readonly vendor: Vendor;
  /** True when the caller asked for an SVG without saying so. */
  readonly svg: boolean;
  readonly reason: string;
  /** Present when inference failed and the fallback was used. */
  readonly fallback?: string;
  /**
   * Present when the classifier's choice was not reachable and a substitute was used. Reported
   * rather than silent: a caller who asked for a photograph and received an illustration should be
   * able to see that the deployment, not the classifier, made that decision.
   */
  readonly substituted?: { readonly from: Vendor; readonly why: string };
}

/**
 * The guidance the classifier routes on.
 *
 * Every line is an observation from the run published in the README rather than
 * a vendor's marketing, which is the only reason to trust it over the model's
 * own priors about these names.
 */
const SYSTEM = `You route an image-generation request to one model. Answer with a choice and a one-sentence reason.

The models, and what a single controlled comparison actually showed about each:

- openai (GPT Image 2): the best at obeying rules stated in the prompt. The only model to get an exact count AND the arrangement right, and the only one to honour every "no X" exclusion. Pick it when the prompt states a number, an exclusion, or a precise arrangement.
- gemini (Gemini 3.1 Flash Image): fast and capable, good with reference images. The sensible pick for an ordinary illustration with no hard constraints.
- gemini-lite (Gemini 3.1 Flash Lite Image): the same family as gemini at about half the per-image price, and the cheapest Google route here. It held the exact count and got the portrait's stated light direction right. Pick it when cost matters and the brief is ordinary.
- gemini-pro (Gemini 3 Pro Image): careful composition when high obedience is needed. It passed the exact-count test and got a stated light direction right that the flash model inverted.
- photoreal (Recraft V4.1 Pro): by a clear margin the most convincing photographs. Pick it whenever the brief is a photograph, a product shot, or anything that must not look illustrated. It miscounted, so avoid it when an exact number matters.
- recraft-utility (Recraft V4.1 Utility): the same family at roughly a sixth of Pro's price, and Recraft's cheaper tier for illustration and design work rather than photography.
- seedream (Seedream 5.0 Pro): rich illustration, but slower and it watermarks its output with "AI generated". Pick it only when the prompt asks for elaborate illustration and nothing else fits.
- grok (Grok Imagine 2.0): held the exact count, honoured every exclusion, and bound all five attribute pairs in the run. Pick it for a draft or a vivid scene, and it is a reasonable second choice when the prompt states a rule.
- muse (Muse Image 1.0): the cheapest model here at about a seventh of gemini's per-image price. It was a clean pass on the exact count and the only model to follow a stated hand position. A sensible general-purpose pick when budget matters.
- svg (Arrow 1.1): emits real vector source, not pixels. Pick it for a diagram, flowchart, icon, logo, chart layout, or anything that must be editable or scale losslessly. It cannot produce a photograph.

Rules:
- Prefer openai when the prompt contains an exact count, an explicit exclusion, or a precise spatial arrangement.
- Prefer photoreal when the prompt asks for a photograph and states no exact count.
- Prefer svg for anything diagrammatic, even if the prompt does not say "SVG".
- When nothing in the prompt is precise, prefer gemini or gemini-lite for cost.
- Do not pick seedream unless the prompt genuinely calls for elaborate illustration.`;

/**
 * Which model the prompt calls for.
 *
 * Never throws. A classifier that is down, rate limited or confused must not
 * take the whole generation with it, so any failure falls back to the
 * configured default and says so in the returned reason.
 */
export async function route(
  prompt: string,
  config: Config,
  timeoutMs = 15_000,
): Promise<RoutingDecision> {
  const fallback = (why: string): RoutingDecision => ({
    vendor: config.defaultProvider,
    svg: false,
    reason: `fell back to the default (${config.defaultProvider})`,
    fallback: why,
  });

  if (config.gatewayKey === '') return fallback('no gateway key, so the classifier cannot run');

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const { output } = await generateText({
      model: createGateway({ apiKey: config.gatewayKey })(ROUTER_MODEL),
      system: SYSTEM,
      prompt: `Route this request:\n\n${prompt.slice(0, 2000)}`,
      output: Output.object({ schema: DecisionSchema }),
      abortSignal: controller.signal,
    });

    if (output.choice === 'svg') {
      return { vendor: 'quiver', svg: true, reason: output.reason };
    }
    const vendor = resolveVendor(output.choice, config.defaultProvider);
    // The enum and the alias table are maintained separately, so a choice that
    // resolves to nothing is a drift between them rather than a model error.
    if (!vendor) return fallback(`the classifier answered "${output.choice}", which is not a known style`);
    // The classifier answers with the best vendor for the request; this deployment may not be able
    // to reach it. Substitute rather than let the call fail: a photograph request on a gateway with
    // no photorealism credential used to be four identical refusals, not a picture.
    const reachable = nearestReachableVendor(vendor, config.allowedVendors);
    if (reachable !== vendor) {
      return {
        vendor: reachable,
        svg: false,
        reason: output.reason,
        substituted: { from: vendor, why: 'not in IMAGE_GEN_ALLOWED_STYLES' },
      };
    }
    return { vendor, svg: false, reason: output.reason };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return fallback(`the classifier did not answer within ${String(timeoutMs)}ms`);
    return fallback(`the classifier failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}
