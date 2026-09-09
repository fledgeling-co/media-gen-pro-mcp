/**
 * Which model runs, and which key pays for it.
 *
 * Three vendors, two routes to each of the first two, one route to the third.
 * The routing is small but it is the part people get wrong, so it is a table
 * and a pure function rather than a chain of ifs spread through the handler.
 *
 * **The model ids are not the same on both routes.** Google's own API serves
 * the model as `gemini-3-pro-image-preview`; the gateway serves the identical
 * model as `google/gemini-3-pro-image`. Verified against
 * `@ai-sdk/google`'s own `GoogleImageModelId` union and the gateway's live
 * `/v1/models` on 30 July 2026. Hardcoding one id for both routes gets a 404
 * from whichever route you did not test.
 */

import { createGateway } from '@ai-sdk/gateway';
import { createGoogle } from '@ai-sdk/google';
import type { ImageModel, LanguageModel } from 'ai';
import type { Config } from './config.js';
import { GROK_CLI_MODEL, readGrokCliSession } from './grok-cli.js';

export type Vendor =
  | 'flare'
  | 'sunburst'
  | 'google'
  | 'googlelite'
  | 'googlepro'
  | 'bytedance'
  | 'quiver'
  | 'xai'
  | 'xaicli'
  | 'recraft'
  | 'recraft-utility'
  | 'recraft-utility-pro'
  | 'recraft-v4.1'
  | 'muse';
export type Route = 'direct' | 'gateway';

export interface ModelChoice {
  readonly vendor: Vendor;
  readonly route: Route;
  /** False when several images means several calls. */
  readonly batches: boolean;
  /** Which SDK call reaches it. Gemini image models are language models. */
  readonly api: 'image' | 'language' | 'openai-compat' | 'grok-cli';
  /** The id actually sent, which differs between routes. */
  readonly modelId: string;
  readonly label: string;
}

/**
 * What a caller may write to pick a vendor.
 *
 * "nanobanana" is in here because it is what people call Google's image model
 * out loud, and a server that only accepts the official string makes the user
 * look up a name they already know by a different one.
 */
const ALIASES: Record<string, Vendor> = {
  flare: 'flare',
  'gpt-image-2.5-flare': 'flare',

  sunburst: 'sunburst',
  'gpt-image-2.5-sunburst': 'sunburst',

  google: 'google',
  gemini: 'google',
  nanobanana: 'google',
  'nano-banana': 'google',
  'nano banana': 'google',
  'gemini-flash': 'google',
  'gemini-3.1-flash': 'google',
  'gemini-3.1-flash-image': 'google',

  googlelite: 'googlelite',
  'google-lite': 'googlelite',
  'gemini-lite': 'googlelite',
  geminilite: 'googlelite',
  'flash-lite': 'googlelite',
  flashlite: 'googlelite',
  'gemini-3.1-flash-lite': 'googlelite',
  'gemini-3.1-flash-lite-image': 'googlelite',

  'gemini-pro': 'googlepro',
  geminipro: 'googlepro',
  'gemini-3-pro': 'googlepro',
  googlepro: 'googlepro',

  bytedance: 'bytedance',
  seedream: 'bytedance',
  'seedream-5.0-pro': 'bytedance',

  meta: 'muse',
  muse: 'muse',
  'muse-image': 'muse',
  'muse-image-1.0': 'muse',
  'muse-1.0': 'muse',

  grok: 'xai',
  xai: 'xai',
  imagine: 'xai',
  'grok-2': 'xai',
  'grok-2.0': 'xai',
  'grok-imagine-2.0': 'xai',
  'grok-imagine-image-2.0': 'xai',
  'grok-cli': 'xaicli',
  grokcli: 'xaicli',
  subscription: 'xaicli',

  recraft: 'recraft',
  photo: 'recraft',
  photoreal: 'recraft',
  photorealistic: 'recraft',
  'recraft-pro': 'recraft',
  'recraft-v4.1-pro': 'recraft',

  'recraft-utility': 'recraft-utility',
  utility: 'recraft-utility',
  'recraft-v4.1-utility': 'recraft-utility',

  'recraft-utility-pro': 'recraft-utility-pro',
  'utility-pro': 'recraft-utility-pro',
  'recraft-v4.1-utility-pro': 'recraft-utility-pro',

  'recraft-v4.1': 'recraft-v4.1',
  'recraft-standard': 'recraft-v4.1',
  'recraft-base': 'recraft-v4.1',

  quiver: 'quiver',
  quiverai: 'quiver',
  arrow: 'quiver',
  svg: 'quiver',
};

export function resolveVendor(style: string | undefined, fallback: Vendor): Vendor | undefined {
  if (style === undefined || style.trim() === '') return fallback;
  return ALIASES[style.trim().toLowerCase()];
}

export const KNOWN_STYLES = Object.keys(ALIASES);

/**
 * Per vendor: the id on each route, which API serves it, and whether it batches.
 *
 * `api` is the field that matters and the one that is easy to get wrong. Gemini's
 * image models are multimodal LANGUAGE models that happen to emit images, so the
 * gateway types them `language` and the image API refuses them outright:
 * "Model 'google/gemini-3-pro-image' is a language model, not an image model."
 * Reaching them means `generateText` and pulling the image files out of the
 * response, which works on both routes. Checked 30 July 2026 against the
 * gateway's own /v1/models and by calling both.
 */
const CATALOGUE: Record<
  Vendor,
  {
    direct?: string;
    gateway?: string;
    label: string;
    batches: boolean;
    api: 'image' | 'language' | 'openai-compat' | 'grok-cli';
  }
> = {
  // No `direct`: OpenAI's own /v1/models lists gpt-image-1 through gpt-image-2
  // only, so the gateway is the only way in. Checked 9 September 2026, when a
  // direct call for the sunburst id 403'd on organisation verification anyway.
  // GPT Image 2 itself was removed in 0.6.0, superseded by these two siblings.
  // Both answered n=2 in a single call, so they batch.
  flare: {
    gateway: 'openai/gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    batches: true,
    api: 'image',
  },
  sunburst: {
    gateway: 'openai/gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    batches: true,
    api: 'image',
  },
  google: {
    direct: 'gemini-3.1-flash-image',
    gateway: 'google/gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    // One image per call either way, so several images is several calls.
    batches: false,
    api: 'language',
  },
  googlelite: {
    direct: 'gemini-3.1-flash-lite-image',
    gateway: 'google/gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Lite Image',
    batches: false,
    api: 'language',
  },
  // No `direct`: ByteDance sells no first-party key that this server can use,
  // so the gateway is not a preference here, it is the only way in.
  bytedance: {
    gateway: 'bytedance/seedream-5.0-pro',
    label: 'Seedream 5.0 Pro',
    batches: true,
    api: 'image',
  },
  // The odd one out, and the reason it is worth a vendor of its own: Arrow
  // writes SVG source rather than pixels, so its output is editable geometry
  // instead of an approximation of it. Gateway-only, like Seedream.
  // The slower, stronger sibling of `google`. Same language-model route.
  googlepro: {
    direct: 'gemini-3-pro-image-preview',
    gateway: 'google/gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    batches: false,
    api: 'language',
  },
  // The one to reach for when the brief is a photograph rather than an
  // illustration.
  recraft: {
    gateway: 'recraft/recraft-v4.1-pro',
    label: 'Recraft V4.1 Pro',
    batches: true,
    api: 'image',
  },
  'recraft-utility': {
    gateway: 'recraft/recraft-v4.1-utility',
    label: 'Recraft V4.1 Utility',
    batches: true,
    api: 'image',
  },
  'recraft-utility-pro': {
    gateway: 'recraft/recraft-v4.1-utility-pro',
    label: 'Recraft V4.1 Utility Pro',
    batches: true,
    api: 'image',
  },
  'recraft-v4.1': {
    gateway: 'recraft/recraft-v4.1',
    label: 'Recraft V4.1',
    batches: true,
    api: 'image',
  },
  muse: {
    gateway: 'meta/muse-image-1.0',
    label: 'Muse Image 1.0',
    batches: true,
    api: 'image',
  },
  // The same vendor as `xai`, paid for differently: it uses the Grok CLI's own
  // signed-in session, so an image lands on an X Premium or SuperGrok
  // subscription rather than on gateway credit. No `direct` and no `gateway`
  // because it authenticates from a file rather than from a key, which is why
  // `chooseModel` special-cases it.
  xaicli: {
    label: 'Grok Imagine (CLI subscription)',
    batches: false,
    api: 'grok-cli',
  },
  // Updated to Grok Imagine 2.0 (spacexai/grok-imagine-image-2.0)
  xai: {
    gateway: 'spacexai/grok-imagine-image-2.0',
    label: 'Grok Imagine 2.0',
    batches: true,
    api: 'image',
  },
  quiver: {
    gateway: 'quiverai/arrow-1.1',
    label: 'Arrow 1.1 (SVG)',
    batches: true,
    api: 'image',
  },
};

/** Whether one call to this vendor can return more than one image. */
export function supportsBatch(vendor: Vendor): boolean {
  return CATALOGUE[vendor].batches;
}

/** The only vendor here that emits real vector source rather than pixels. */
/**
 * The reachable vendor that best stands in for one this deployment cannot serve.
 *
 * Substitution is by TIER, not by taking the first allowed name. The tiers are a CAREFUL one — the
 * models that hold an exact count, an exclusion or a stated light direction, and make the most
 * convincing photographs — and a FAST one for an ordinary illustration. So a request routed to the
 * photorealism vendor substitutes to the best Google model rather than the cheapest, and a request
 * routed to a cheap vendor stays cheap: the caller's intent survives the substitution.
 *
 * A vendor the table does not know degrades to the first allowed one rather than throwing, so a
 * vendor added later is reachable-or-substituted instead of fatal.
 */
const NEAREST_REACHABLE: Readonly<Partial<Record<Vendor, readonly Vendor[]>>> = {
  flare: ['sunburst', 'googlepro', 'google'],
  sunburst: ['flare', 'googlepro', 'google'],
  recraft: ['googlepro', 'google', 'googlelite'],
  'recraft-utility': ['recraft', 'googlepro', 'google'],
  'recraft-utility-pro': ['recraft', 'googlepro', 'google'],
  'recraft-v4.1': ['recraft', 'googlepro', 'google'],
  bytedance: ['googlepro', 'google', 'googlelite'],
  googlepro: ['googlepro', 'google', 'googlelite'],
  google: ['google', 'googlepro', 'googlelite'],
  googlelite: ['google', 'googlepro'],
  muse: ['google', 'googlepro'],
  quiver: ['quiver'],
  xai: ['google', 'googlepro', 'googlelite'],
  xaicli: ['google', 'googlepro', 'googlelite'],
};

export function nearestReachableVendor(
  chosen: Vendor,
  allowed: readonly Vendor[],
): Vendor {
  const first = allowed[0];
  if (first === undefined || allowed.includes(chosen)) return chosen;
  const nearest = NEAREST_REACHABLE[chosen] ?? [];
  return nearest.find((candidate) => allowed.includes(candidate)) ?? first;
}

export const SVG_VENDOR: Vendor = 'quiver';

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

/**
 * Pick the route, or explain precisely which key is missing.
 *
 * The error is written for someone who has one key and assumed it covered
 * everything, because that is the common case and "authentication failed" from
 * three vendors away is a bad way to learn it.
 */
export function chooseModel(vendor: Vendor, config: Config): ModelChoice {
  const entry = CATALOGUE[vendor];

  // Authenticated by a signed-in CLI rather than by a key, so the key checks
  // below do not apply and would reject it for having no key of its own.
  if (entry.api === 'grok-cli') {
    if (!readGrokCliSession()) {
      throw new RoutingError(
        'Grok Imagine on a CLI subscription needs the Grok CLI signed in: no session found at ~/.grok/auth.json. ' +
          'Run `grok` and sign in, or use `style: "grok"` to reach the same model through the gateway on credit.',
      );
    }
    return { vendor, route: 'direct', modelId: GROK_CLI_MODEL, label: entry.label, batches: entry.batches, api: entry.api };
  }

  const directKey =
    vendor === 'google' || vendor === 'googlelite' || vendor === 'googlepro' ? config.googleKey : '';
  const canDirect = entry.direct !== undefined && directKey !== '';
  const canGateway = config.gatewayKey !== '';

  if (entry.direct === undefined && !canGateway) {
    throw new RoutingError(
      `${entry.label} is only reachable through the Vercel AI Gateway, and AI_GATEWAY_API_KEY is not set. ` +
        'There is no first-party key for it. Set the gateway key, or ask for openai or google instead.',
    );
  }

  const canUseGateway = canGateway && entry.gateway !== undefined;
  const useGateway = canUseGateway && (config.preferGateway || !canDirect);
  if (!useGateway && !canDirect) {
    throw new RoutingError(
      `No key for ${entry.label}. Set GEMINI_API_KEY for the direct route, or AI_GATEWAY_API_KEY to reach it through the gateway.`,
    );
  }

  return useGateway && entry.gateway !== undefined
    ? { vendor, route: 'gateway', modelId: entry.gateway, label: entry.label, batches: entry.batches, api: entry.api }
    : {
        vendor,
        route: 'direct',
        modelId: entry.direct ?? entry.gateway ?? '',
        label: entry.label,
        batches: entry.batches,
        api: entry.api,
      };
}

/** Build the SDK image model for a choice the image API can serve. */
export function imageModelFor(choice: ModelChoice, config: Config): ImageModel {
  if (choice.route === 'gateway') {
    return createGateway({ apiKey: config.gatewayKey }).imageModel(choice.modelId);
  }
  return createGoogle({ apiKey: config.googleKey }).image(choice.modelId);
}

/** Build the SDK language model for a choice served by `generateText`. */
export function languageModelFor(choice: ModelChoice, config: Config): LanguageModel {
  return choice.route === 'gateway'
    ? createGateway({ apiKey: config.gatewayKey })(choice.modelId)
    : createGoogle({ apiKey: config.googleKey })(choice.modelId);
}

/** Every route that is usable right now, for the startup line and the doctor. */
export function availableRoutes(config: Config): { vendor: Vendor; route: Route; label: string }[] {
  const out: { vendor: Vendor; route: Route; label: string }[] = [];
  for (const vendor of [
    'flare',
    'sunburst',
    'google',
    'googlelite',
    'googlepro',
    'bytedance',
    'recraft',
    'recraft-utility',
    'recraft-utility-pro',
    'recraft-v4.1',
    'muse',
    'xai',
    'xaicli',
    'quiver',
  ] as const) {
    try {
      const c = chooseModel(vendor, config);
      out.push({ vendor, route: c.route, label: c.label });
    } catch {
      // A vendor with no key is not an error at startup, it is simply absent.
    }
  }
  return out;
}
