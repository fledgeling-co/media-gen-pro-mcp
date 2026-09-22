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
import { type Vendor, isVectorVendor, nearestReachableVendor, resolveVendor } from './models.js';

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
  'flare',
  'sunburst',
  'gemini-pro',
  'gemini',
  'gemini-lite',
  'photoreal',
  'recraft-utility',
  'seedream',
  'grok',
  'muse',
  'svg',
  'svg-telos',
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
 * Two kinds of claim live here and the prompt keeps them apart on purpose. A
 * measured line comes from the run published in the README: one sample, but a
 * sample, and it is the only reason to trust this over the model's own priors
 * about these names. A positioning line is the vendor's own account of what a
 * model is for, used where no run of ours has tested the thing the vendor
 * claims — Sunburst's edit precision, Muse's tool use, Grok's typography.
 * Marking which is which lets the classifier weigh them differently, and stops
 * marketing quietly acquiring the authority of a measurement.
 */
const SYSTEM = `You route an image-generation request to one model. Answer with a choice and a one-sentence reason.

The models. Where a line says a model "held" or "missed" something, that is from one controlled comparison published in this repo's README; where it describes what a model is built for, that is the vendor's own stated positioning. Both are marked, because they are worth different amounts.

- flare (GPT Image 2.5 Flare): measured the best at obeying rules stated in the prompt — a clean pass on the exact count AND the arrangement, and it honoured every "no X" exclusion. OpenAI positions it as the default for most work, at about half the latency of the previous generation. Pick it when the prompt states a number, an exclusion, or a precise arrangement, and as the general default.
- sunburst (GPT Image 2.5 Sunburst): flare's slower, more precise sibling. Same measured rule-following; OpenAI positions it for premium work that needs tighter control across edits — production campaign creative, polished product imagery. Pick it when the brief is a finished asset rather than a draft, or when editing an existing image precisely, and accept the longer wait.
- gemini (Gemini 3.1 Flash Image): fast and capable, good with reference images. The sensible pick for an ordinary illustration with no hard constraints.
- gemini-lite (Gemini 3.1 Flash Lite Image): the same family as gemini at about half the per-image price, and the cheapest Google route here. It held the exact count and got the portrait's stated light direction right. Pick it when cost matters and the brief is ordinary.
- gemini-pro (Gemini 3 Pro Image): careful composition when high obedience is needed. It passed the exact-count test and got a stated light direction right that the flash model inverted.
- photoreal (Recraft V4.1 Pro): by a clear margin the most convincing photographs. Pick it whenever the brief is a photograph, a product shot, or anything that must not look illustrated. It miscounted, so avoid it when an exact number matters.
- recraft-utility (Recraft V4.1 Utility): the same family at roughly a sixth of Pro's price, and Recraft's cheaper tier for illustration and design work rather than photography.
- seedream (Seedream 5.0 Pro): rich illustration, but slower and it watermarks its output with a visible "AI generated". Pick it only when the prompt asks for elaborate illustration and nothing else fits.
- grok (Grok Imagine 2.0): held the exact count, honoured every exclusion, and bound all five attribute pairs in the run. xAI positions it around planning typography and layout the way a designer would, so dense multi-part visuals hold together and small text stays sharp, and it takes up to five reference images in one call. Pick it for a poster, a layout with small lettering, a composite from several references, or a vivid scene.
- muse (Muse Image 1.0): the cheapest model here at about a seventh of gemini's per-image price. It was a clean pass on the exact count and the only model to follow a stated hand position. Meta positions it as agentic — it can search the web to ground an image in current fact, and write code to produce an accurate plot or QR code — and strong at composing several references into one scene. Pick it when budget matters, when the image depends on a real-world fact, or when a plot or code must actually be correct.
- svg (Arrow 2): emits real vector source, not pixels. Pick it for a diagram, flowchart, icon, logo, chart layout, or anything that must be editable or scale losslessly. It cannot produce a photograph. This is the fast, cheaper vector route and the right default for vector work.
- svg-telos (Arrow 2 Telos): the same vector output from a more refined model. Quiver's own guidance is to take plain Arrow 2 when speed and cost per asset matter, and Telos for harder briefs that benefit from extra refinement. Pick it for a dense or complex diagram, a detailed illustration, a technical drawing, or a piece that must hold one style across variants.

Rules:
- Prefer flare when the prompt contains an exact count, an explicit exclusion, or a precise spatial arrangement.
- Prefer sunburst over flare when the prompt asks for a finished, production-quality or campaign-ready asset, or for a precise edit to an existing image.
- Prefer photoreal when the prompt asks for a photograph and states no exact count.
- Prefer a vector choice for anything diagrammatic, even if the prompt does not say "SVG". Use svg by default and svg-telos only when the piece is genuinely complex or has to hold a style across variants.
- Prefer grok when the image carries dense small text or a designed layout, such as a poster or an infographic panel.
- Prefer muse when the image must reflect a real-world fact, or when it needs a correct plot or QR code.
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

    const vendor = resolveVendor(output.choice, config.defaultProvider);
    // The enum and the alias table are maintained separately, so a choice that
    // resolves to nothing is a drift between them rather than a model error.
    if (!vendor) return fallback(`the classifier answered "${output.choice}", which is not a known style`);
    // The classifier answers with the best vendor for the request; this deployment may not be able
    // to reach it. Substitute rather than let the call fail: a photograph request on a gateway with
    // no photorealism credential used to be four identical refusals, not a picture.
    const reachable = nearestReachableVendor(vendor, config.allowedVendors);
    // `svg` is a property of the vendor that actually runs, not of the word the
    // classifier said. Deriving it after substitution keeps the flag honest when
    // a deployment allows one Arrow and not the other.
    if (reachable !== vendor) {
      return {
        vendor: reachable,
        svg: isVectorVendor(reachable),
        reason: output.reason,
        substituted: { from: vendor, why: 'not in IMAGE_GEN_ALLOWED_STYLES' },
      };
    }
    return { vendor, svg: isVectorVendor(vendor), reason: output.reason };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return fallback(`the classifier did not answer within ${String(timeoutMs)}ms`);
    return fallback(`the classifier failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}
