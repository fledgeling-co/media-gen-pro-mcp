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
import { generateImage } from 'ai';
import type { Config } from './config.js';
import { type ModelChoice, imageModelFor } from './models.js';

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
function extensionFor(mediaType: string): string {
  const known: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return known[mediaType.toLowerCase()] ?? '.bin';
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

  let result: Awaited<ReturnType<typeof generateImage>>;
  try {
    if (choice.batches || req.n === 1) {
      result = await call(req.n);
    } else {
      // Gemini refuses `n > 1` outright ("Gemini image models do not support
      // generating a set number of images per call"), verified by calling it.
      // Several images therefore means several calls, in parallel because they
      // are independent and serialising them would multiply an already slow
      // operation by n. The caller asked for images, not for a lecture about
      // which vendor batches.
      const parts = await Promise.all(Array.from({ length: req.n }, () => call(1)));
      const first = parts[0];
      if (!first) throw new GenerationError('No images were returned.');
      result = {
        ...first,
        images: parts.flatMap((p) => p.images),
        warnings: parts.flatMap((p) => p.warnings),
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
    const path = join(dir, filenameFor(req.prompt, req.basename, i, extensionFor(image.mediaType)));
    await writeFile(path, bytes);
    images.push({ path, bytes: bytes.byteLength, mediaType: image.mediaType });
  }

  return {
    images,
    choice,
    warnings: result.warnings.map((w) =>
      // The SDK's warnings are the honest record of what a provider ignored:
      // an aspect ratio a model does not support is silently dropped otherwise,
      // and the caller sees a square image and blames the prompt.
      'message' in w && typeof w.message === 'string' ? w.message : JSON.stringify(w),
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
