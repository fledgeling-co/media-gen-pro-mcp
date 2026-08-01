/**
 * Configuration, parsed once at startup.
 *
 * Environment is a trust boundary: every value is Zod-parsed here and the rest
 * of the server reads the typed result. An invalid value fails fast with a
 * readable message rather than surfacing as a mystery mid-request.
 */

import { z } from 'zod';

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
  readonly preferGateway: boolean;
  readonly maxPerHour: number;
  readonly maxPerCall: number;
  readonly timeoutMs: number;
  readonly videoTimeoutMs: number;
  readonly videoMaxPerHour: number;
}

export const DEFAULT_PROVIDER = 'openai' as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  const e = parsed.data;
  return {
    // `||` rather than `??`: a key present but empty is the common shape in a
    // committed .env file, and it must fall through to the alias.
    openaiKey: e.OPENAI_API_KEY || '',
    googleKey: e.GEMINI_API_KEY || e.GOOGLE_API_KEY || '',
    gatewayKey: e.AI_GATEWAY_API_KEY || '',
    outputDir: e.IMAGE_GEN_OUTPUT_DIR || '',
    defaultProvider: e.IMAGE_GEN_DEFAULT_PROVIDER || DEFAULT_PROVIDER,
    preferGateway: e.IMAGE_GEN_PREFER_GATEWAY,
    maxPerHour: e.IMAGE_GEN_MAX_PER_HOUR,
    maxPerCall: e.IMAGE_GEN_MAX_PER_CALL,
    timeoutMs: e.IMAGE_GEN_TIMEOUT_MS,
    videoTimeoutMs: e.IMAGE_GEN_VIDEO_TIMEOUT_MS,
    videoMaxPerHour: e.IMAGE_GEN_VIDEO_MAX_PER_HOUR,
  };
}
