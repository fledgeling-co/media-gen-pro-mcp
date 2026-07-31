#!/usr/bin/env node
/**
 * Image generation as an MCP tool.
 *
 * Built for the job of putting real images on a website an LLM is writing: the
 * caller describes what it wants, optionally hands over reference images and
 * text context, and gets back file paths it can drop into an `<img src>`.
 *
 * Seven models behind one tool, because the right one differs by job and nobody
 * wants seven tools. GPT Image 2 is the default; Gemini answers to "gemini" or
 * "nanobanana", Recraft to "photoreal", and Arrow to "svg", which is the only
 * one here that writes real vector source rather than pixels.
 */

import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { adviseFor, warnAbout } from './advice.js';
import { isModerationBlock, renderBlock } from './blocked.js';
import { GenerationError, RateLimiter, generate } from './generate.js';
import { KNOWN_STYLES, RoutingError, SVG_VENDOR, availableRoutes, chooseModel, resolveVendor } from './models.js';
import { VERSION } from './version.js';

const config = loadConfig();
const limiter = new RateLimiter(config.maxPerHour);

const server = new FastMCP({
  name: 'image-gen-pro',
  version: VERSION,
  instructions:
    'Generates images and writes them to disk, returning file paths rather than image bytes. Built for illustrating a ' +
    'site or document: point an `<img src>` at what it returns.\n\n' +
    'Seven models behind one tool. GPT Image 2 by default; say "gemini"/"nanobanana" (fast), "gemini-pro" (slower, ' +
    'more obedient), "photoreal" for Recraft, "seedream", or "grok". Set `svg: true` for a REAL SVG from Arrow, which ' +
    'no raster model can produce. Reference images and extra text context are accepted and change the result.\n\n' +
    'Results carry a note when a different model handled the same kind of prompt better in the published comparison. ' +
    'It is advice, not a reroute: relay it to the user when it is relevant to what they asked for.\n\n' +
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
    'an existing style, keep a character or product consistent, or edit an image you already have. Defaults to OpenAI ' +
    'GPT Image 2; pass `style` as gemini/nanobanana, gemini-pro, photoreal (Recraft), seedream, or grok. For a REAL editable SVG ' +
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
        `Which model. Omit for the default (${config.defaultProvider}). Accepted: ${KNOWN_STYLES.join(', ')}. "seedream" and "svg"/"arrow" need the gateway key.`,
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
    const vendor = args.svg === true ? SVG_VENDOR : resolveVendor(args.style, config.defaultProvider);
    if (vendor === undefined) {
      throw new GenerationError(
        `Unknown style "${args.style ?? ''}". Accepted: ${KNOWN_STYLES.join(', ')}.`,
      );
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
      `Generated ${String(outcome.images.length)} image(s) with **${choice.label}** via the ${choice.route} route.`,
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

const routes = availableRoutes(config);
process.stderr.write(
  `image-gen-pro-mcp ${VERSION} · ` +
    (routes.length === 0
      ? 'NO KEYS — set OPENAI_API_KEY, GEMINI_API_KEY, or AI_GATEWAY_API_KEY'
      : routes.map((r) => `${r.label} (${r.route})`).join(' · ')) +
    ` · cap: ${config.maxPerHour === 0 ? 'none' : `${String(config.maxPerHour)}/hour`}\n`,
);

await server.start({ transportType: 'stdio' });
