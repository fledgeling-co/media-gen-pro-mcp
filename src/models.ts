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
import { createOpenAI } from '@ai-sdk/openai';
import type { ImageModel } from 'ai';
import type { Config } from './config.js';

export type Vendor = 'openai' | 'google' | 'bytedance';
export type Route = 'direct' | 'gateway';

export interface ModelChoice {
  readonly vendor: Vendor;
  readonly route: Route;
  /** False when several images means several calls. */
  readonly batches: boolean;
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
  openai: 'openai',
  'gpt-image': 'openai',
  'gpt-image-2': 'openai',
  dalle: 'openai',
  google: 'google',
  gemini: 'google',
  nanobanana: 'google',
  'nano-banana': 'google',
  'nano banana': 'google',
  bytedance: 'bytedance',
  seedream: 'bytedance',
  'seedream-4.5': 'bytedance',
};

export function resolveVendor(style: string | undefined, fallback: Vendor): Vendor | undefined {
  if (style === undefined || style.trim() === '') return fallback;
  return ALIASES[style.trim().toLowerCase()];
}

export const KNOWN_STYLES = Object.keys(ALIASES);

/** Per vendor: the id on each route, and whether a direct route exists at all. */
const CATALOGUE: Record<
  Vendor,
  { direct?: string; gateway: string; label: string; batches: boolean }
> = {
  openai: { direct: 'gpt-image-2', gateway: 'openai/gpt-image-2', label: 'GPT Image 2', batches: true },
  google: {
    direct: 'gemini-3-pro-image-preview',
    gateway: 'google/gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    // Verified by calling it on 30 July 2026: `n: 2` is refused outright with
    // "Gemini image models do not support generating a set number of images per
    // call". So a request for several images becomes several requests, which
    // the caller should not have to know or care about.
    batches: false,
  },
  // No `direct`: ByteDance sells no first-party key that this server can use,
  // so the gateway is not a preference here, it is the only way in.
  bytedance: { gateway: 'bytedance/seedream-4.5', label: 'Seedream 4.5', batches: true },
};

/** Whether one call to this vendor can return more than one image. */
export function supportsBatch(vendor: Vendor): boolean {
  return CATALOGUE[vendor].batches;
}

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
  const directKey = vendor === 'openai' ? config.openaiKey : vendor === 'google' ? config.googleKey : '';
  const canDirect = entry.direct !== undefined && directKey !== '';
  const canGateway = config.gatewayKey !== '';

  if (entry.direct === undefined && !canGateway) {
    throw new RoutingError(
      `${entry.label} is only reachable through the Vercel AI Gateway, and AI_GATEWAY_API_KEY is not set. ` +
        'There is no first-party key for it. Set the gateway key, or ask for openai or google instead.',
    );
  }

  const useGateway = canGateway && (config.preferGateway || !canDirect);
  if (!useGateway && !canDirect) {
    const wanted = vendor === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
    throw new RoutingError(
      `No key for ${entry.label}. Set ${wanted} for the direct route, or AI_GATEWAY_API_KEY to reach it through the gateway.`,
    );
  }

  return useGateway
    ? { vendor, route: 'gateway', modelId: entry.gateway, label: entry.label, batches: entry.batches }
    : { vendor, route: 'direct', modelId: entry.direct ?? entry.gateway, label: entry.label, batches: entry.batches };
}

/** Build the SDK model for a resolved choice. */
export function imageModelFor(choice: ModelChoice, config: Config): ImageModel {
  if (choice.route === 'gateway') {
    return createGateway({ apiKey: config.gatewayKey }).imageModel(choice.modelId);
  }
  if (choice.vendor === 'openai') {
    return createOpenAI({ apiKey: config.openaiKey }).imageModel(choice.modelId);
  }
  return createGoogle({ apiKey: config.googleKey }).image(choice.modelId);
}

/** Every route that is usable right now, for the startup line and the doctor. */
export function availableRoutes(config: Config): { vendor: Vendor; route: Route; label: string }[] {
  const out: { vendor: Vendor; route: Route; label: string }[] = [];
  for (const vendor of ['openai', 'google', 'bytedance'] as const) {
    try {
      const c = chooseModel(vendor, config);
      out.push({ vendor, route: c.route, label: c.label });
    } catch {
      // A vendor with no key is not an error at startup, it is simply absent.
    }
  }
  return out;
}
