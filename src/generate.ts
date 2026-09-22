/**
 * Generating the images, and putting them somewhere a page can use.
 *
 * Two decisions shape this file.
 *
 * **Images are written to disk, never returned inline.** A 1024x1024 PNG is
 * roughly 1.4 MB once base64'd. Three of those in one tool result is a context
 * window spent on bytes the model cannot read, and the caller wanted a file
 * anyway, because an `<img src>` takes a path. So the tool returns paths.
 *
 * **Reference images are read from disk by the caller's path.** The alternative
 * is accepting base64 in the tool call, which puts the same megabytes back into
 * the context this design exists to protect.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { generateImage, generateText } from 'ai';
import { z } from 'zod';

/** Only the fields read from the gateway's OpenAI-compatible images response. */
const OpenAiImagesSchema = z.object({
  data: z.array(z.object({ b64_json: z.string() })).optional(),
});
import type { Config } from './config.js';
import { generateViaGrokCli, readGrokCliSession } from './grok-cli.js';
import { type ModelChoice, imageModelFor, languageModelFor } from './models.js';

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

/** Formats a reference image may plausibly be in. */
const REFERENCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export interface GenerateRequest {
  readonly prompt: string;
  readonly referenceImages?: readonly string[];
  readonly n: number;
  readonly size?: `${number}x${number}` | undefined;
  readonly aspectRatio?: `${number}:${number}` | undefined;
  readonly seed?: number | undefined;
  readonly outputDir: string;
  readonly basename?: string | undefined;
}

export interface GeneratedImage {
  readonly path: string;
  readonly bytes: number;
  readonly mediaType: string;
}

export interface GenerateOutcome {
  readonly images: GeneratedImage[];
  readonly choice: ModelChoice;
  readonly warnings: readonly string[];
}

/**
 * Read the caller's reference images.
 *
 * Refuses a path that is not obviously an image, and refuses anything it cannot
 * read, rather than silently generating without the reference. A generation
 * that quietly ignored the reference looks like the model disobeying, which
 * sends the caller rewriting a prompt that was never the problem.
 */
async function loadReferences(paths: readonly string[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const p of paths) {
    const ext = extname(p).toLowerCase();
    if (!REFERENCE_EXTENSIONS.has(ext)) {
      throw new GenerationError(
        `Reference image \`${p}\` does not look like an image (${ext || 'no extension'}). Expected one of ${[...REFERENCE_EXTENSIONS].join(', ')}.`,
      );
    }
    try {
      out.push(new Uint8Array(await readFile(p)));
    } catch (e: unknown) {
      throw new GenerationError(
        `Could not read reference image \`${p}\`: ${e instanceof Error ? e.message : String(e)}. ` +
          'Paths are read by this server, so they must be readable by it and absolute paths are safest.',
      );
    }
  }
  return out;
}

/**
 * The file extension a provider's bytes actually deserve.
 *
 * Not always `.png`. Gemini 3 Pro Image returns JPEG, and writing those bytes
 * to a `.png` name produces a file whose extension lies about its contents.
 * Browsers sniff and render it anyway, which is exactly why this is worth
 * fixing rather than shrugging at: the lie survives until something that does
 * NOT sniff, an image pipeline or a build step, rejects it far from here.
 */
function extensionFor(mediaType: string, bytes: Uint8Array): string {
  // Sniff before trusting the label. Arrow returns SVG source and the SDK
  // reports it as `image/png`, so a file written from the declared type alone
  // is an .svg's bytes under a .png name. Verified by calling it on 30 July
  // 2026: the response body begins `<svg xmlns=...`.
  const head = new TextDecoder().decode(bytes.slice(0, 200)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return '.svg';

  // Magic bytes beat the declared type for the raster formats too. Recraft
  // returns WebP through an endpoint whose response shape says nothing about
  // format, and Arrow's SVG arrives labelled `image/png`; a provider's label is
  // simply not evidence here. Checked 30 July 2026 on both.
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return '.webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return '.gif';

  const known: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
  };
  return known[mediaType.toLowerCase()] ?? '.bin';
}

/**
 * The SVG document inside a language model's answer, if there is one.
 *
 * Arrow 2 emits vector source as text, and a model asked for source tends to
 * wrap it in a fenced block or introduce it with a sentence. Slicing from the
 * first `<svg` to the last `</svg>` survives both without needing to know which
 * one happened. Returns undefined rather than a guess when there is no document
 * there, so the caller can still report a text-only answer as the failure it is.
 */
export function extractSvg(text: string): string | undefined {
  const start = text.indexOf('<svg');
  if (start === -1) return undefined;
  const close = text.lastIndexOf('</svg>');
  if (close === -1 || close < start) return undefined;
  return text.slice(start, close + '</svg>'.length);
}

/** A filename that is stable for the same prompt and unique across calls. */
function filenameFor(prompt: string, basename: string | undefined, index: number, ext: string): string {
  const stem =
    basename && basename.trim() !== ''
      ? basename.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60)
      : `img-${createHash('sha256').update(prompt).digest('hex').slice(0, 8)}`;
  // A short random tail, because generating twice from one prompt must not
  // overwrite the first result: a caller comparing two attempts would find one.
  return `${stem}-${randomUUID().slice(0, 6)}${index > 0 ? `-${String(index + 1)}` : ''}${ext}`;
}

export async function generate(
  req: GenerateRequest,
  choice: ModelChoice,
  config: Config,
): Promise<GenerateOutcome> {
  const model = imageModelFor(choice, config);
  const references = req.referenceImages?.length ? await loadReferences(req.referenceImages) : [];

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs);

  // The object form carries reference images; the string form is the plain text
  // case. Both are the SDK's own `GenerateImagePrompt`.
  const prompt = references.length > 0 ? { images: references, text: req.prompt } : req.prompt;
  const call = (n: number): ReturnType<typeof generateImage> =>
    generateImage({
      model,
      prompt,
      n,
      ...(req.size ? { size: req.size } : {}),
      ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      abortSignal: controller.signal,
    });

  /**
   * One image out of a multimodal language model.
   *
   * Gemini's image models are language models that emit images, which is why the
   * gateway types them `language` and the image API refuses them. `generateText`
   * reaches them on both routes; the images arrive as files on the response.
   */
  const viaLanguage = async (): Promise<{ uint8Array: Uint8Array; mediaType: string }[]> => {
    const r = await generateText({
      model: languageModelFor(choice, config),
      ...(references.length > 0
        ? {
            messages: [
              {
                role: 'user' as const,
                content: [
                  { type: 'text' as const, text: req.prompt },
                  ...references.map((image) => ({ type: 'image' as const, image })),
                ],
              },
            ],
          }
        : { prompt: req.prompt }),
      abortSignal: controller.signal,
    });
    const files = r.files.filter((f) => f.mediaType.startsWith('image/'));
    if (files.length > 0) {
      return files.map((f) => ({ uint8Array: f.uint8Array, mediaType: f.mediaType }));
    }

    // Arrow 2 is a language model that writes SVG SOURCE, so its answer can
    // arrive as text rather than as a file, sometimes inside a fenced block.
    // Treating that as "no image" would reject the one model here whose whole
    // point is that its output is source you can read. A raster model that
    // answers in words still fails below, which is the behaviour that matters:
    // this recovers a real result, it does not paper over a refusal.
    const markup = extractSvg(r.text);
    if (markup !== undefined) {
      return [{ uint8Array: new TextEncoder().encode(markup), mediaType: 'image/svg+xml' }];
    }

    // It answered in words instead of pictures. Saying so beats writing a
    // zero-image success, which reads as the model refusing silently.
    throw new GenerationError(
      `${choice.label} returned no image, only text: ${r.text.slice(0, 300)}`,
    );
  };

  /**
   * The gateway's OpenAI-compatible images endpoint.
   *
   * Used only where the SDK's own gateway image route is broken for a provider,
   * which is currently every Recraft model. Deliberately narrow: this is a
   * workaround for a specific upstream defect, not a second general path.
   */
  const viaOpenAiCompat = async (n: number): Promise<{ uint8Array: Uint8Array; mediaType: string }[]> => {
    const res = await fetch('https://ai-gateway.vercel.sh/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.gatewayKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: choice.modelId,
        prompt: req.prompt,
        n,
        // Recraft rejects most sizes with a bare 400 and an empty message.
        // 1024x1024, 1024x1707 and 1707x1024 all fail; 2048x2048 and `auto`
        // work. Checked 30 July 2026. Passing the caller's size straight
        // through turned a supported request into an unexplained failure, so
        // anything it has not been shown to accept becomes `auto`.
        size: req.size === '2048x2048' ? req.size : 'auto',
      }),
      signal: controller.signal,
    });
    const body: unknown = await res.json();
    const parsed = OpenAiImagesSchema.safeParse(body);
    if (!parsed.success || parsed.data.data === undefined) {
      const msg =
        typeof body === 'object' && body !== null && 'error' in body
          ? JSON.stringify((body).error).slice(0, 300)
          : `unrecognised response (HTTP ${String(res.status)})`;
      throw new GenerationError(`${choice.label} failed: ${msg}`);
    }
    return parsed.data.data.map((d) => ({
      uint8Array: Uint8Array.from(Buffer.from(d.b64_json, 'base64')),
      // The endpoint declares no format. Whatever is put here is a guess, and
      // the magic-byte sniff below overrides it; this is only the fallback for
      // a format the sniff does not recognise.
      mediaType: 'application/octet-stream',
    }));
  };

  let result: { images: { uint8Array: Uint8Array; mediaType: string }[]; warnings: unknown[] };
  try {
    if (choice.api === 'grok-cli') {
      const session = readGrokCliSession();
      if (!session) throw new GenerationError('The Grok CLI session vanished between routing and generating.');
      // One image per call, so several images is several calls, in parallel.
      const parts = await Promise.all(
        Array.from({ length: req.n }, () =>
          generateViaGrokCli({
            token: session.token,
            prompt: req.prompt,
            aspectRatio: req.aspectRatio,
            timeoutMs: config.timeoutMs,
          }),
        ),
      );
      result = { images: parts, warnings: [] };
    } else if (choice.api === 'openai-compat') {
      result = { images: await viaOpenAiCompat(req.n), warnings: [] };
    } else if (choice.api === 'language') {
      const parts = await Promise.all(Array.from({ length: req.n }, () => viaLanguage()));
      result = { images: parts.flat(), warnings: [] };
    } else if (choice.batches || req.n === 1) {
      const r = await call(req.n);
      result = { images: [...r.images], warnings: [...r.warnings] };
    } else {
      // Gemini refuses `n > 1` outright ("Gemini image models do not support
      // generating a set number of images per call"), verified by calling it.
      // Several images therefore means several calls, in parallel because they
      // are independent and serialising them would multiply an already slow
      // operation by n. The caller asked for images, not for a lecture about
      // which vendor batches.
      const parts = await Promise.all(Array.from({ length: req.n }, () => call(1)));
      result = {
        images: parts.flatMap((p) => [...p.images]),
        warnings: parts.flatMap((p) => [...p.warnings]),
      };
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new GenerationError(
        `${choice.label} did not return within ${String(Math.round(config.timeoutMs / 1000))}s. Image models are slow; raise IMAGE_GEN_TIMEOUT_MS or ask for fewer images.`,
      );
    }
    throw new GenerationError(
      `${choice.label} (${choice.route}) failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const dir = isAbsolute(req.outputDir) ? req.outputDir : resolve(req.outputDir);
  await mkdir(dir, { recursive: true });

  const images: GeneratedImage[] = [];
  for (const [i, image] of result.images.entries()) {
    const bytes = image.uint8Array;
    const ext = extensionFor(image.mediaType, bytes);
    const path = join(dir, filenameFor(req.prompt, req.basename, i, ext));
    await writeFile(path, bytes);
    // Report what the bytes ARE, not what the provider claimed, so a caller
    // deciding whether it has a vector does not have to open the file.
    // Report what the bytes ARE, never what the provider claimed.
    const sniffed: Record<string, string> = {
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    images.push({ path, bytes: bytes.byteLength, mediaType: sniffed[ext] ?? image.mediaType });
  }

  return {
    images,
    choice,
    warnings: result.warnings.map((w) =>
      // The SDK's warnings are the honest record of what a provider ignored:
      // an aspect ratio a model does not support is silently dropped otherwise,
      // and the caller sees a square image and blames the prompt.
      typeof w === 'object' && w !== null && 'message' in w && typeof w.message === 'string'
        ? w.message
        : JSON.stringify(w),
    ),
  };
}

/**
 * A rolling-hour ceiling on generated images.
 *
 * Image generation is billed per image and is the expensive kind. An agent in a
 * retry loop is exactly the shape that runs up a bill nobody authorised, and it
 * costs more here than it does on a text model.
 */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(private readonly maxPerHour: number) {}

  check(count: number, now: number = Date.now()): void {
    if (this.maxPerHour <= 0) return;
    const cutoff = now - 3_600_000;
    for (let head = this.hits[0]; head !== undefined && head < cutoff; head = this.hits[0]) this.hits.shift();
    if (this.hits.length + count > this.maxPerHour) {
      const oldest = this.hits[0];
      const waitMin = oldest === undefined ? 60 : Math.ceil((oldest + 3_600_000 - now) / 60_000);
      throw new GenerationError(
        `Rate limit: ${String(this.maxPerHour)} images per hour, ${String(this.hits.length)} already used and ${String(count)} requested. ` +
          `Capacity returns in about ${String(waitMin)} minute(s). Raise or disable it with IMAGE_GEN_MAX_PER_HOUR; every image is billed.`,
      );
    }
    for (let i = 0; i < count; i += 1) this.hits.push(now);
  }

  remaining(now: number = Date.now()): number {
    if (this.maxPerHour <= 0) return Number.POSITIVE_INFINITY;
    const cutoff = now - 3_600_000;
    return this.maxPerHour - this.hits.filter((h) => h >= cutoff).length;
  }
}
