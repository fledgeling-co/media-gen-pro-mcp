/**
 * Configuration, parsed once at startup.
 *
 * Environment is a trust boundary: every value is Zod-parsed here and the rest
 * of the server reads the typed result. An invalid value fails fast with a
 * readable message rather than surfacing as a mystery mid-request.
 */

import { z } from 'zod';
import { resolveVendor, type Vendor } from './models.js';

const numeric = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? Number(v) : fallback))
    .pipe(z.number().min(min).max(max));

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * A boolean that refuses to guess.
 *
 * Treating anything unrecognised as `false` means a typo silently flips a
 * setting, and it always flips it in the permissive direction.
 */
const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? '').trim().toLowerCase();
      if (!s) return fallback;
      if (TRUTHY.has(s)) return true;
      if (FALSY.has(s)) return false;
      ctx.addIssue({
        code: 'custom',
        message: `expected one of ${[...TRUTHY, ...FALSY].join('/')}, got ${JSON.stringify(v)}`,
      });
      return z.NEVER;
    });

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().trim().max(500).optional(),
  GEMINI_API_KEY: z.string().trim().max(500).optional(),
  /** Accepted as an alias because the Google SDKs read it and people have it set. */
  GOOGLE_API_KEY: z.string().trim().max(500).optional(),
  /**
   * Vercel AI Gateway. One key reaches all three vendors, and it is the ONLY
   * route to Seedream, which has no first-party key here.
   */
  AI_GATEWAY_API_KEY: z.string().trim().max(500).optional(),

  /**
   * Where generated images are written.
   *
   * Written to disk rather than returned inline, and that is the whole shape of
   * this server. A 1024x1024 PNG is roughly 1.4 MB of base64; three of them in
   * one tool result is a context window spent on bytes the model cannot read.
   * The caller gets paths, and paths are what an `<img src>` needs anyway.
   */
  IMAGE_GEN_OUTPUT_DIR: z.string().trim().max(1000).optional(),

  /** Which vendor is used when the caller names no style. */
  IMAGE_GEN_DEFAULT_PROVIDER: z.enum(['openai', 'google', 'bytedance']).optional(),

  /**
   * Style aliases this deployment may actually reach, comma-separated. Empty means no restriction.
   *
   * A deployment's reachable set and the classifier's opinion are independent facts, and when they
   * disagree the classifier wins: it is an LLM call whose answer is used directly, while
   * `IMAGE_GEN_DEFAULT_PROVIDER` is only consulted when it cannot run. Measured 2026-08-24, a caller
   * on a Zero-Data-Retention gateway asked for a photograph, the classifier correctly chose the
   * photorealism vendor, and every attempt was refused because that vendor has no ZDR-attested
   * credential — four identical retries, and a finished deck thrown away for want of two pictures.
   *
   * So name the reachable set here and the classifier chooses within it. Written as STYLE ALIASES
   * (`gemini-pro,gemini`) rather than internal vendor keys, because aliases are the vocabulary
   * callers already use in `style`.
   */
  IMAGE_GEN_ALLOWED_STYLES: z.string().trim().max(400).optional(),

  /**
   * Force everything through the gateway even when a first-party key exists.
   *
   * Off by default: a first-party key is the cheaper path and the one most
   * people already hold. On, it makes billing land in one place.
   */
  IMAGE_GEN_PREFER_GATEWAY: boolish(false),

  /** Images allowed per rolling hour. 0 disables the cap. */
  IMAGE_GEN_MAX_PER_HOUR: numeric(60, 0, 100_000),

  /** Ceiling on images per single call, whatever the caller asks for. */
  IMAGE_GEN_MAX_PER_CALL: numeric(4, 1, 10),

  IMAGE_GEN_TIMEOUT_MS: numeric(180_000, 5_000, 600_000),

  /**
   * Ceiling for one video call.
   *
   * Far longer than the image one because video models are far slower, and a
   * timeout that fires mid-generation still bills for the work. 25 minutes,
   * because Grok Imagine Video exceeded 10 on all three of its first attempts
   * at a 5-second clip while MiniMax took roughly 4.
   */
  IMAGE_GEN_VIDEO_TIMEOUT_MS: numeric(1_500_000, 30_000, 3_600_000),

  /** Videos allowed per rolling hour. 0 disables the cap. */
  IMAGE_GEN_VIDEO_MAX_PER_HOUR: numeric(20, 0, 10_000),
});

export interface Config {
  readonly openaiKey: string;
  readonly googleKey: string;
  readonly gatewayKey: string;
  readonly outputDir: string;
  readonly defaultProvider: 'openai' | 'google' | 'bytedance';
  /** Vendors this deployment may reach. Empty array means "no restriction configured". */
  readonly allowedVendors: readonly Vendor[];
  readonly preferGateway: boolean;
  readonly maxPerHour: number;
  readonly maxPerCall: number;
  readonly timeoutMs: number;
  readonly videoTimeoutMs: number;
  readonly videoMaxPerHour: number;
}

export const DEFAULT_PROVIDER = 'openai' as const;

/**
 * The vendor used when the caller names none and the router cannot run.
 *
 * Whichever key the operator actually supplied, rather than a constant. A server
 * holding only a Gemini key was defaulting to OpenAI and failing every unstyled
 * request on a missing key, which reads as a broken install rather than as a
 * default nobody chose.
 *
 * The tie is broken toward OpenAI: with a gateway key everything is reachable,
 * and with both first-party keys either would work, so the one that was best at
 * following instructions in the published comparison wins.
 */
export function inferDefaultProvider(
  openaiKey: string,
  googleKey: string,
  gatewayKey: string,
): 'openai' | 'google' | 'bytedance' {
  if (gatewayKey !== '') return 'openai';
  if (openaiKey !== '') return 'openai';
  if (googleKey !== '') return 'google';
  return DEFAULT_PROVIDER;
}

/**
 * Resolve a comma-separated list of style aliases to vendors, dropping names the alias table does
 * not know so a typo narrows the set rather than emptying it silently. An unparseable or empty
 * value means no restriction, which is the historical behaviour.
 */
function parseAllowedVendors(raw: string | undefined): readonly Vendor[] {
  const names = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const vendors: Vendor[] = [];
  for (const name of names) {
    // A second argument is required, and an unknown alias must not silently become it:
    // resolveVendor returns the fallback only for an EMPTY style, and undefined for an
    // unknown one, so passing a real vendor here is safe.
    const vendor = resolveVendor(name, 'google');
    if (vendor && !vendors.includes(vendor)) vendors.push(vendor);
  }
  return vendors;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  const e = parsed.data;
  // `||` rather than `??`: a key present but empty is the common shape in a
  // committed .env file, and it must fall through to the alias.
  const openaiKey = e.OPENAI_API_KEY || '';
  const googleKey = e.GEMINI_API_KEY || e.GOOGLE_API_KEY || '';
  const gatewayKey = e.AI_GATEWAY_API_KEY || '';
  return {
    openaiKey,
    googleKey,
    gatewayKey,
    outputDir: e.IMAGE_GEN_OUTPUT_DIR || '',
    defaultProvider: e.IMAGE_GEN_DEFAULT_PROVIDER || inferDefaultProvider(openaiKey, googleKey, gatewayKey),
    allowedVendors: parseAllowedVendors(e.IMAGE_GEN_ALLOWED_STYLES),
    preferGateway: e.IMAGE_GEN_PREFER_GATEWAY,
    maxPerHour: e.IMAGE_GEN_MAX_PER_HOUR,
    maxPerCall: e.IMAGE_GEN_MAX_PER_CALL,
    timeoutMs: e.IMAGE_GEN_TIMEOUT_MS,
    videoTimeoutMs: e.IMAGE_GEN_VIDEO_TIMEOUT_MS,
    videoMaxPerHour: e.IMAGE_GEN_VIDEO_MAX_PER_HOUR,
  };
}
