/**
 * Video generation, and why it is a separate tool rather than a flag.
 *
 * A video call differs from an image call in every way that matters to a caller:
 * it takes tens of seconds to minutes rather than seconds, it costs
 * substantially more per output, and the most useful input is usually an image
 * you already have rather than a paragraph of text. Folding it into
 * `generate_image` would put a parameter on the image tool whose presence
 * multiplies the bill by an order of magnitude, which is exactly the shape of
 * an accident.
 *
 * `experimental_generateVideo` is still experimental in AI SDK v7, so the name
 * carries the prefix and this module is the only place that touches it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createGateway } from '@ai-sdk/gateway';
import { experimental_generateVideo as generateVideo, generateText } from 'ai';
import type { Config } from './config.js';
import { GenerationError } from './generate.js';
import { generateVideoViaGrokCli, readGrokCliSession } from './grok-cli.js';

export type VideoVendor =
  | 'seedance'
  | 'seedance-mini'
  | 'minimax'
  | 'minimax-max'
  | 'wan'
  | 'wan-prime'
  | 'flux'
  | 'grok'
  | 'grokcli'
  | 'gemini'
  | 'veo';

export interface VideoChoice {
  readonly vendor: VideoVendor;
  readonly modelId: string;
  readonly label: string;
  /** True when the route is the Grok CLI session rather than the gateway. */
  readonly viaCli: boolean;
  /** True when the model is reached through generateText rather than the video API. */
  readonly viaLanguage: boolean;
  /** Supported durations if constrained by the provider (e.g. Veo [4, 6, 8]). */
  readonly supportedDurations?: readonly number[];
}

const CATALOGUE: Record<
  VideoVendor,
  {
    modelId: string;
    label: string;
    viaCli: boolean;
    disabled?: boolean;
    viaLanguage?: boolean;
    supportedDurations?: readonly number[];
  }
> = {
  seedance: { modelId: 'bytedance/seedance-2.0', label: 'Seedance 2.0', viaCli: false },
  'seedance-mini': { modelId: 'bytedance/seedance-2.0-mini', label: 'Seedance 2.0 Mini', viaCli: false },
  minimax: { modelId: 'minimax/minimax-h3', label: 'MiniMax H3', viaCli: false },
  'minimax-max': { modelId: 'minimax/minimax-h3-max', label: 'MiniMax H3 Max', viaCli: false },
  wan: { modelId: 'alibaba/wan-v3.0-video', label: 'Wan 3.0 Video', viaCli: false },
  'wan-prime': { modelId: 'alibaba/wan-v3.0-video-prime', label: 'Wan 3.0 Video Prime', viaCli: false },
  flux: { modelId: 'bfl/flux-3-video', label: 'FLUX.3 Video', viaCli: false },
  grok: { modelId: 'spacexai/grok-imagine-video-1.5', label: 'Grok Imagine Video 1.5', viaCli: false },
  // Typed `language` on the gateway, not `video`, exactly like Gemini's image
  // models: it is a multimodal LLM that emits video files rather than a video
  // endpoint. `generateText` reaches it and the clip arrives on `files`.
  // Confirmed 1 August 2026.
  gemini: {
    modelId: 'google/gemini-omni-flash-preview',
    label: 'Gemini Omni Flash',
    viaCli: false,
    viaLanguage: true,
  },
  veo: {
    modelId: 'google/veo-3.1-lite-generate-001',
    label: 'Veo 3.1 Lite',
    viaCli: false,
    supportedDurations: [4, 6, 8],
  },
  grokcli: { modelId: 'grok-imagine-video', label: 'Grok Imagine Video (CLI subscription)', viaCli: true, disabled: true },
};

const ALIASES: Record<string, VideoVendor> = {
  // Seedance
  seedance: 'seedance',
  'seedance-2.0': 'seedance',
  bytedance: 'seedance',
  'seedance-mini': 'seedance-mini',
  'seedance-2.0-mini': 'seedance-mini',
  'seedance-fast': 'seedance-mini',

  // MiniMax
  minimax: 'minimax',
  h3: 'minimax',
  'minimax-h3': 'minimax',
  'minimax-max': 'minimax-max',
  'minimax-h3-max': 'minimax-max',
  'h3-max': 'minimax-max',

  // Wan
  wan: 'wan',
  'wan-3.0': 'wan',
  'wan-video': 'wan',
  'wan-prime': 'wan-prime',
  'wan-3.0-prime': 'wan-prime',
  'wan-video-prime': 'wan-prime',

  // Flux
  flux: 'flux',
  'flux-video': 'flux',
  'flux-3-video': 'flux',

  // Grok
  grok: 'grok',
  xai: 'grok',
  imagine: 'grok',
  'grok-video': 'grok',
  'grok-imagine-video': 'grok',
  'grok-imagine-video-1.5': 'grok',
  'grok-cli': 'grokcli',
  grokcli: 'grokcli',
  subscription: 'grokcli',

  // Gemini Omni Flash
  gemini: 'gemini',
  google: 'gemini',
  omni: 'gemini',
  'gemini-omni': 'gemini',

  // Google Veo
  veo: 'veo',
  'veo-3.1': 'veo',
  'veo-lite': 'veo',
  'veo-3.1-lite': 'veo',
};

export const KNOWN_VIDEO_STYLES = Object.keys(ALIASES);

export function resolveVideoVendor(style: string | undefined): VideoVendor | undefined {
  if (style === undefined || style.trim() === '') return 'seedance';
  return ALIASES[style.trim().toLowerCase()];
}

export function chooseVideoModel(vendor: VideoVendor, config: Config): VideoChoice {
  const e = CATALOGUE[vendor];
  if (e.disabled === true) {
    throw new GenerationError(
      `${e.label} is not available. Its image-to-video request shape was never established: the endpoint refuses both a data URL and a bare base64 string for the source image, and the account used to develop it ran out of video credit before the correct shape was found. ` +
        'Use `style: "grok"` for the same model through the gateway, or `style: "minimax"` / `style: "seedance"`.',
    );
  }
  if (e.viaCli) {
    if (!readGrokCliSession()) {
      throw new GenerationError(
        'Video on a Grok CLI subscription needs the Grok CLI signed in: no session found at ~/.grok/auth.json. ' +
          'Run `grok` and sign in, or use `style: "grok"` to reach the same model through the gateway on credit.',
      );
    }
    return { vendor, modelId: e.modelId, label: e.label, viaCli: true, viaLanguage: false };
  }
  if (config.gatewayKey === '') {
    throw new GenerationError(
      `${e.label} is reached through the Vercel AI Gateway, and AI_GATEWAY_API_KEY is not set. ` +
        'Every video model here is gateway-only, except `style: "grok-cli"`, which uses a signed-in Grok CLI instead.',
    );
  }
  return {
    vendor,
    modelId: e.modelId,
    label: e.label,
    viaCli: false,
    viaLanguage: e.viaLanguage === true,
    ...(e.supportedDurations ? { supportedDurations: e.supportedDurations } : {}),
  };
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Read the still a video should start from. */
async function loadFrame(path: string): Promise<Uint8Array> {
  const ext = extname(path).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new GenerationError(
      `\`${path}\` does not look like an image (${ext || 'no extension'}). A video's source frame must be one of ${[...IMAGE_EXTENSIONS].join(', ')}. ` +
        'An SVG cannot be a source frame; rasterise it first.',
    );
  }
  try {
    return new Uint8Array(await readFile(path));
  } catch (e: unknown) {
    throw new GenerationError(
      `Could not read \`${path}\`: ${e instanceof Error ? e.message : String(e)}. Paths are read by this server, so absolute paths are safest.`,
    );
  }
}

/** Extension for the bytes, sniffed rather than trusted. */
function videoExtension(bytes: Uint8Array, mediaType: string): string {
  // `ftyp` at offset 4 is the ISO base media signature, covering mp4 and mov.
  const tag = new TextDecoder().decode(bytes.slice(4, 8));
  if (tag === 'ftyp') return '.mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return '.webm';
  return mediaType.includes('webm') ? '.webm' : '.mp4';
}

export interface VideoRequest {
  readonly prompt: string;
  readonly sourceImage?: string | undefined;
  readonly n: number;
  readonly durationSeconds: number;
  readonly aspectRatio?: `${number}:${number}` | undefined;
  readonly outputDir: string;
  readonly basename?: string | undefined;
}

export interface GeneratedVideo {
  readonly path: string;
  readonly bytes: number;
  readonly mediaType: string;
}

export async function generateVideoFile(
  req: VideoRequest,
  choice: VideoChoice,
  config: Config,
): Promise<{ videos: GeneratedVideo[]; warnings: string[] }> {
  const frame = req.sourceImage ? await loadFrame(req.sourceImage) : undefined;

  const duration = choice.supportedDurations
    ? choice.supportedDurations.includes(req.durationSeconds)
      ? req.durationSeconds
      : choice.supportedDurations.reduce((prev, curr) =>
          Math.abs(curr - req.durationSeconds) < Math.abs(prev - req.durationSeconds) ? curr : prev,
        )
    : req.durationSeconds;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, config.videoTimeoutMs);

  let produced: { uint8Array: Uint8Array; mediaType: string }[];
  let warnings: string[] = [];
  try {
    if (choice.viaCli) {
      const session = readGrokCliSession();
      if (!session) throw new GenerationError('The Grok CLI session vanished between routing and generating.');
      produced = await Promise.all(
        Array.from({ length: req.n }, () =>
          generateVideoViaGrokCli({
            token: session.token,
            prompt: req.prompt,
            ...(frame ? { image: frame } : {}),
            durationSeconds: duration,
            ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
            timeoutMs: config.videoTimeoutMs,
          }),
        ),
      );
    } else if (choice.viaLanguage) {
      // A multimodal language model that emits video files. The video API
      // refuses it, the same way the image API refuses Gemini's image models.
      const gw = createGateway({ apiKey: config.gatewayKey });
      const parts = await Promise.all(
        Array.from({ length: req.n }, async () => {
          const r = await generateText({
            model: gw(choice.modelId),
            ...(frame
              ? {
                  messages: [
                    {
                      role: 'user' as const,
                      content: [
                        { type: 'text' as const, text: `${req.prompt}\n\nAnimate this image as a ${String(duration)} second video.` },
                        { type: 'image' as const, image: frame },
                      ],
                    },
                  ],
                }
              : { prompt: `${req.prompt}\n\nGenerate a ${String(duration)} second video.` }),
            abortSignal: controller.signal,
          });
          const files = r.files.filter((f) => f.mediaType.startsWith('video/'));
          const first = files[0];
          if (!first) {
            throw new GenerationError(
              `${choice.label} returned no video, only text: ${r.text.slice(0, 300)}`,
            );
          }
          return { uint8Array: first.uint8Array, mediaType: first.mediaType };
        }),
      );
      produced = parts;
    } else {
      const model = createGateway({ apiKey: config.gatewayKey }).videoModel(choice.modelId);
      const result = await generateVideo({
        model,
        // The object form is image-to-video; the string form is text-to-video.
        prompt: frame ? { image: frame, text: req.prompt } : req.prompt,
        n: req.n,
        duration,
        // Text-to-video needs an explicit ratio. Omitting it sends MiniMax
        // `adaptive`, which it rejects outright: "ratio is required for t2va
        // (text-only) and cannot be 'adaptive'". With a source image the still
        // sets the frame, so the ratio is left alone there.
        ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : frame ? {} : { aspectRatio: '16:9' as const }),
        abortSignal: controller.signal,
      });
      produced = result.videos.map((v) => ({ uint8Array: v.uint8Array, mediaType: v.mediaType }));
      warnings = result.warnings.map((w) => ('message' in w && typeof w.message === 'string' ? w.message : JSON.stringify(w)));
    }
  } catch (e: unknown) {
    if (e instanceof GenerationError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new GenerationError(
        `${choice.label} did not return within ${String(Math.round(config.videoTimeoutMs / 1000))}s. ` +
          'Video models are slow; raise IMAGE_GEN_VIDEO_TIMEOUT_MS or ask for a shorter clip.',
      );
    }
    throw new GenerationError(`${choice.label} failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  const dir = isAbsolute(req.outputDir) ? req.outputDir : resolve(req.outputDir);
  await mkdir(dir, { recursive: true });

  const stem =
    req.basename && req.basename.trim() !== ''
      ? req.basename.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60)
      : `vid-${createHash('sha256').update(req.prompt).digest('hex').slice(0, 8)}`;

  const videos: GeneratedVideo[] = [];
  for (const [i, v] of produced.entries()) {
    const ext = videoExtension(v.uint8Array, v.mediaType);
    const path = join(dir, `${stem}-${randomUUID().slice(0, 6)}${i > 0 ? `-${String(i + 1)}` : ''}${ext}`);
    await writeFile(path, v.uint8Array);
    videos.push({ path, bytes: v.uint8Array.byteLength, mediaType: ext === '.webm' ? 'video/webm' : 'video/mp4' });
  }
  return { videos, warnings };
}
