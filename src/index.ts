#!/usr/bin/env node
/**
 * Image generation as an MCP tool.
 *
 * Built for the job of putting real images on a website an LLM is writing: the
 * caller describes what it wants, optionally hands over reference images and
 * text context, and gets back file paths it can drop into an `<img src>`.
 *
 * Thirteen models behind one tool, because the right one differs by job and nobody
 * wants thirteen tools. GPT Image 2 is the default; Gemini answers to "gemini" or
 * "nanobanana", Recraft to "photoreal", and Arrow to "svg", which is the only
 * one here that writes real vector source rather than pixels.
 */

import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { adviseFor, adviseForVideo, warnAbout } from './advice.js';
import { isModerationBlock, renderBlock } from './blocked.js';
import { route } from './router.js';
import { GenerationError, RateLimiter, generate } from './generate.js';
import { KNOWN_STYLES, RoutingError, SVG_VENDOR, availableRoutes, chooseModel, nearestReachableVendor, resolveVendor, type Vendor } from './models.js';
import {
  KNOWN_VIDEO_STYLES,
  chooseVideoModel,
  generateVideoFile,
  resolveVideoVendor,
} from './video.js';
import { VERSION } from './version.js';

const config = loadConfig();
const limiter = new RateLimiter(config.maxPerHour);
const videoLimiter = new RateLimiter(config.videoMaxPerHour);

const server = new FastMCP({
  name: 'media-gen-pro',
  version: VERSION,
  instructions:
    'Generates images and writes them to disk, returning file paths rather than image bytes. Built for illustrating a ' +
    'site or document: point an `<img src>` at what it returns.\n\n' +
    'State-of-the-art models behind one tool. GPT Image 2.5 Flare by default; say "gemini"/"nanobanana" (Gemini 3.1 Flash Image), ' +
    '"gemini-lite" (Gemini 3.1 Flash Lite Image), "photoreal" for Recraft V4.1 Pro (also "utility", "utility-pro", "recraft-v4.1"), ' +
    '"seedream" (Seedream 5.0 Pro), "grok" (Grok Imagine 2.0), "muse" (Muse Image 1.0), "flare" (GPT Image 2.5 Flare), ' +
    '"sunburst" (GPT Image 2.5 Sunburst). Say "grok-cli" to use a signed-in Grok CLI ' +
    'subscription instead of any API key, which costs no credit. Set `svg: true` for a ' +
    'REAL SVG from Arrow, which no raster model can produce. Reference images and extra text context are accepted and ' +
    'change the result.\n\n' +
    'Leave `style` out and the server reads the prompt and picks the model, reporting the choice and why. Name one and it ' +
    'is obeyed exactly. Results also carry a note when a different model handled that kind of prompt better in the ' +
    'published comparison; relay it to the user when it is relevant.\n\n' +
    'PROMPT CRAFT: front-load the subject, then action or pose, setting, style, composition, lighting, key details. ' +
    'Natural prose, not keyword tags, 2-5 sentences. Say what to INCLUDE rather than what to leave out. One scene per prompt.\n\n' +
    'If a model declines a prompt, the result explains what to do instead. Do NOT reword it to get past the filter and do ' +
    'not try another model hoping it is more permissive.\n\n' +
    'Anything needing exact text, real numbers or a correct structure (charts from data, labelled diagrams, tables, UI, ' +
    'multi-panel grids) should be built in code and screenshotted, not generated. Image models garble words and invent ' +
    'numbers, and re-prompting garbles them again.\n\n' +
    'Every image is a billed API call, and image models cost more than text ones. There is an hourly ceiling, because ' +
    'an agent in a retry loop is the shape that runs up a bill nobody authorised.',
});

server.addTool({
  name: 'generate_image',
  description:
    'Generate one or more images from a description and write them to disk, returning their paths. Optionally takes ' +
    'REFERENCE IMAGES (paths on this machine) and extra text context, both of which steer the result: use them to match ' +
    'an existing style, keep a character or product consistent, or edit an image you already have. Defaults to ' +
    'GPT Image 2.5 Flare; pass `style` as gemini/nanobanana (Gemini 3.1 Flash Image), gemini-lite (Gemini 3.1 Flash Lite Image), ' +
    'photoreal (Recraft V4.1 Pro), utility (Recraft V4.1 Utility), utility-pro (Recraft V4.1 Utility Pro), recraft-v4.1, ' +
    'seedream (Seedream 5.0 Pro), grok (Grok Imagine 2.0), muse (Muse Image 1.0), flare (GPT Image 2.5 Flare), ' +
    'sunburst (GPT Image 2.5 Sunburst), or grok-cli (a ' +
    'signed-in Grok CLI subscription, no API key and no credit). For a REAL editable SVG ' +
    'set `svg: true`, which routes to Arrow; the raster models can only imitate one. A billed call per image.',
  annotations: {
    title: 'Generate images',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  parameters: z.object({
    prompt: z
      .string()
      .min(3)
      .max(4000)
      .describe('What to generate. Detail helps: subject, composition, lighting, style, and what to leave out.'),
    style: z
      .string()
      .max(40)
      .optional()
      .describe(
        `Which model. OMIT IT unless the user named one: the server reads the prompt and picks, and reports what it chose. Naming one here overrides that and is obeyed exactly. Accepted: ${KNOWN_STYLES.join(', ')}. "seedream" and "svg"/"arrow" need the gateway key.`,
      ),
    svg: z
      .boolean()
      .optional()
      .describe(
        'Generate a REAL SVG: vector source you can open, edit and scale, from Arrow 1.1. Set this whenever the user asked for an SVG, a logo, an icon, or a diagram. Overrides `style`. Note that the raster models cannot produce an SVG; they can only produce a picture that looks like one.',
      ),
    referenceImages: z
      .array(z.string().min(1).max(1000))
      .max(4)
      .optional()
      .describe(
        'Paths to images on THIS machine to use as visual context: a style to match, a product to keep consistent, or an image to edit. Read by the server, so absolute paths are safest. Not URLs, and not base64.',
      ),
    context: z
      .string()
      .max(4000)
      .optional()
      .describe(
        'Extra text context appended to the prompt: brand rules, a palette, what the surrounding page says, things to avoid. Kept separate from `prompt` so the subject stays legible.',
      ),
    n: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe(`How many images. Defaults to 1, capped at ${String(config.maxPerCall)} by this server. Each one is billed.`),
    size: z
      .string()
      .regex(/^\d{2,5}x\d{2,5}$/)
      .optional()
      .describe('Exact pixel size, e.g. 1024x1024. Provider support varies; unsupported values come back as a warning.'),
    aspectRatio: z
      .string()
      .regex(/^\d{1,2}:\d{1,2}$/)
      .optional()
      .describe('Aspect ratio, e.g. 16:9. Use instead of `size` when the exact pixels do not matter.'),
    seed: z.number().int().optional().describe('Seed, where the provider supports one, for a repeatable result.'),
    outputDir: z
      .string()
      .max(1000)
      .optional()
      .describe('Where to write the images. Defaults to IMAGE_GEN_OUTPUT_DIR, or the current working directory.'),
    basename: z
      .string()
      .max(60)
      .optional()
      .describe('Filename stem, e.g. "hero". A short random suffix is always added so a second call cannot overwrite the first.'),
  }),
  execute: async (args) => {
    // An explicit SVG request outranks `style`, because the raster models cannot
    // satisfy it at all: asking gpt-image for an SVG gets a PNG that looks like
    // one, which is the exact failure this flag exists to prevent.
    //
    // Inference only fills the gap where the caller named nothing. An explicit
    // `style` is obeyed exactly and never second-guessed, because silent
    // substitution makes a caller's own logs lie about what it asked for.
    let vendor;
    let routed;
    let substitutedFrom: Vendor | undefined;
    if (args.svg === true) {
      vendor = SVG_VENDOR;
    } else if (args.style === undefined || args.style.trim() === '') {
      routed = await route(args.prompt, config);
      vendor = routed.vendor;
      if (routed.substituted) substitutedFrom = routed.substituted.from;
    } else {
      vendor = resolveVendor(args.style, config.defaultProvider);
      if (vendor === undefined) {
        throw new GenerationError(
          `Unknown style "${args.style}". Accepted: ${KNOWN_STYLES.join(', ')}.`,
        );
      }
      // An explicitly named style is obeyed exactly WHERE IT CAN BE. A deployment that cannot reach
      // the named vendor has two options and refusing is the worse one -- the caller wanted a
      // picture, and a substitution they can see beats an error they cannot act on. The swap is
      // reported in the response so "obeyed exactly" stays true or is visibly not.
      const reachable = nearestReachableVendor(vendor, config.allowedVendors);
      if (reachable !== vendor) {
        substitutedFrom = vendor;
        vendor = reachable;
      }
    }

    let choice;
    try {
      choice = chooseModel(vendor, config);
    } catch (e: unknown) {
      // A routing failure is a configuration problem with a specific fix, so it
      // is reported as itself rather than as a generic generation failure.
      if (e instanceof RoutingError) throw new GenerationError(e.message);
      throw e;
    }

    const n = Math.min(args.n ?? 1, config.maxPerCall);
    limiter.check(n);

    const prompt = args.context ? `${args.prompt}\n\nContext:\n${args.context}` : args.prompt;
    let outcome;
    try {
      outcome = await generate(
      {
        prompt,
        ...(args.referenceImages ? { referenceImages: args.referenceImages } : {}),
        n,
        ...(args.size ? { size: args.size as `${number}x${number}` } : {}),
        ...(args.aspectRatio ? { aspectRatio: args.aspectRatio as `${number}:${number}` } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        outputDir: args.outputDir || config.outputDir || process.cwd(),
        ...(args.basename ? { basename: args.basename } : {}),
      },
        choice,
        config,
      );
    } catch (e: unknown) {
      // A refusal is not a fault, and it must not be retried with reworded
      // phrasing. Answered with what the caller can legitimately do instead.
      const msg = e instanceof Error ? e.message : String(e);
      if (isModerationBlock(msg)) return renderBlock(prompt, choice.label, msg);
      throw e;
    }

    const left = limiter.remaining();
    const madeSvg = outcome.images.some((i) => i.mediaType === 'image/svg+xml');
    return [
      // The substitution rides the FIRST line, not a note below it. Consumers log this text and
      // truncate: the caller that prompted this feature stores 200 characters of it, which is
      // enough for the sentence below and not enough for anything after a blank line. A
      // substitution recorded nowhere turns a loud failure into a silent change of vendor, which
      // is the worse of the two, so the fact that explains the image cannot be the first thing cut.
      `Generated ${String(outcome.images.length)} image(s) with **${choice.label}** via the ${choice.route} route` +
        (substitutedFrom
          ? ` — substituted for \`${substitutedFrom}\`, which this deployment cannot reach.`
          : '.'),
      ...(substitutedFrom
        ? [
            '',
            `_Set \`IMAGE_GEN_ALLOWED_STYLES\` to change which models are reachable here._`,
          ]
        : []),
      // Always said out loud. A model the caller did not name must never be a
      // silent choice, or nobody can tell why two identical-looking requests
      // produced different results.
      ...(routed
        ? [
            '',
            routed.fallback === undefined
              ? `_Model chosen from your prompt: ${routed.reason} Pass \`style\` to override._`
              : `_No model named and routing did not run (${routed.fallback}), so this ${routed.reason}._`,
          ]
        : []),
      '',
      ...outcome.images.map(
        (i) => `- \`${i.path}\` (${String(Math.round(i.bytes / 1024))} KB, ${i.mediaType})`,
      ),
      ...(madeSvg
        ? [
            '',
            '**Ask the user whether they also want a raster version.** This is real vector source, editable and scalable. ' +
              'A raster model (openai or gemini) can produce a richer picture in an SVG-ish flat style, but it will be pixels, ' +
              'not vector, so it cannot be edited as shapes or scaled without loss. Offer it; do not generate one unasked, ' +
              'because it is a second billed call for something they may not want.',
          ]
        : []),
      ...(args.referenceImages?.length
        ? ['', `_Used ${String(args.referenceImages.length)} reference image(s)._`]
        : []),
      // Advice, never a reroute. The image above was made with what the caller
      // asked for; this only says what else exists.
      ...(() => {
        const warn = warnAbout(prompt, vendor);
        const advice = adviseFor(prompt, vendor, args.referenceImages?.length ?? 0);
        if (!warn && !advice) return [];
        return [
          '',
          ...(warn ? [`> [!WARNING]`, `> ${warn}`, ''] : []),
          ...(advice ? [`> [!TIP]`, `> **Tell the user this if it is relevant to what they asked for.** ${advice.note}`, ''] : []),
        ];
      })(),
      ...(outcome.warnings.length > 0
        ? ['', '**The provider ignored something you asked for:**', ...outcome.warnings.map((w) => `- ${w}`)]
        : []),
      ...(Number.isFinite(left) ? ['', `_${String(left)} image(s) left this hour._`] : []),
    ].join('\n');
  },
});


server.addTool({
  name: 'generate_video',
  description:
    'Generate a short video from a description, optionally starting from an image you already have, and write it to disk. ' +
    'Image-to-video is the stronger path: pass `sourceImage` and the still becomes the first frame, which is how you keep a ' +
    'character or product consistent. Models: seedance (Seedance 2.0, default), seedance-mini, minimax (H3), minimax-max (H3 Max), wan (Wan 3.0), wan-prime (Wan 3.0 Prime), flux (FLUX.3 Video), grok (Grok Imagine Video 1.5), gemini (Gemini Omni Flash), or veo (Veo 3.1 Lite). A billed call per video, and MUCH more expensive and slower than an image; expect tens of seconds to minutes.',
  annotations: {
    title: 'Generate video',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  parameters: z.object({
    prompt: z
      .string()
      .min(3)
      .max(4000)
      .describe(
        'One short vivid moment in present tense, with a clear camera movement. One subject, one simple motion. ' +
        'Complex multi-action animation is handled poorly by every model; make it interesting through composition and light, not busy movement.',
      ),
    sourceImage: z
      .string()
      .max(1000)
      .optional()
      .describe(
        'Path to an image on THIS machine to use as the first frame. The strongest way to control the result, and the only way to keep a subject consistent across clips. Not a URL, not base64, and not an SVG.',
      ),
    style: z
      .string()
      .max(40)
      .optional()
      .describe(`Which model. Defaults to seedance. Accepted: ${KNOWN_VIDEO_STYLES.join(', ')}.`),
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Clip length. Defaults to 5. Short clips are what these models are good at; prefer several short ones over one long one.'),
    n: z.number().int().min(1).max(4).optional().describe('How many videos. Defaults to 1. Each one is billed.'),
    aspectRatio: z
      .string()
      .regex(/^\d{1,2}:\d{1,2}$/)
      .optional()
      .describe('Aspect ratio, e.g. 16:9 or 9:16. Ignored when `sourceImage` is given, since the still sets the frame.'),
    outputDir: z.string().max(1000).optional().describe('Where to write. Defaults to IMAGE_GEN_OUTPUT_DIR, or the working directory.'),
    basename: z.string().max(60).optional().describe('Filename stem. A short random suffix is always added.'),
  }),
  execute: async (args) => {
    const vendor = resolveVideoVendor(args.style);
    if (vendor === undefined) {
      throw new GenerationError(`Unknown video style "${args.style ?? ''}". Accepted: ${KNOWN_VIDEO_STYLES.join(', ')}.`);
    }
    const choice = chooseVideoModel(vendor, config);
    const n = args.n ?? 1;
    videoLimiter.check(n);

    let out;
    try {
      out = await generateVideoFile(
        {
          prompt: args.prompt,
          ...(args.sourceImage ? { sourceImage: args.sourceImage } : {}),
          n,
          durationSeconds: args.durationSeconds ?? 5,
          ...(args.aspectRatio ? { aspectRatio: args.aspectRatio as `${number}:${number}` } : {}),
          outputDir: args.outputDir || config.outputDir || process.cwd(),
          ...(args.basename ? { basename: args.basename } : {}),
        },
        choice,
        config,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isModerationBlock(msg)) return renderBlock(args.prompt, choice.label, msg);
      throw e;
    }

    const left = videoLimiter.remaining();
    return [
      `Generated ${String(out.videos.length)} video(s) with **${choice.label}**${args.sourceImage ? ', starting from your image' : ''}.`,
      '',
      ...out.videos.map((v) => `- \`${v.path}\` (${String(Math.round(v.bytes / 1024))} KB, ${v.mediaType})`),
      ...(out.warnings.length > 0
        ? ['', '**The provider ignored something you asked for:**', ...out.warnings.map((w) => `- ${w}`)]
        : []),
      ...(() => {
        const a = adviseForVideo(args.prompt, Boolean(args.sourceImage));
        return a ? ['', '> [!TIP]', `> **Tell the user this if it is relevant.** ${a}`] : [];
      })(),
      ...(Number.isFinite(left) ? ['', `_${String(left)} video(s) left this hour._`] : []),
    ].join('\n');
  },
});

const routes = availableRoutes(config);
process.stderr.write(
  `media-gen-pro-mcp ${VERSION} · ` +
    (routes.length === 0
      ? 'NO KEYS — set GEMINI_API_KEY or AI_GATEWAY_API_KEY'
      : routes.map((r) => `${r.label} (${r.route})`).join(' · ')) +
    ` · cap: ${config.maxPerHour === 0 ? 'none' : `${String(config.maxPerHour)}/hour`}\n`,
);

await server.start({ transportType: 'stdio' });
