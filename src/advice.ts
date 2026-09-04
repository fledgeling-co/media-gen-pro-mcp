/**
 * Telling the caller when a different model would serve them better.
 *
 * Built from one run of six prompts across seven models on 30 July 2026, the
 * same run published in the README. That is a small sample and the advice says
 * so, but the failures it found were not marginal: a model that draws six bolts
 * when asked for seven, or lights a subject from the wrong side, is wrong in a
 * way a reader spots instantly.
 *
 * **Advice, never routing.** Nothing here changes which model runs. A server
 * that silently substituted a model would make the caller's own logs lie, and
 * the caller often has a reason for its choice that this file cannot see. It
 * generates with what it was asked for and adds a line saying what else exists.
 *
 * The signals are deliberately crude keyword tests. A model call to classify the
 * prompt would cost money on every generation to produce a suggestion, and a
 * wrong suggestion is cheap while a wrong bill is not.
 */

import type { Vendor } from './models.js';

export interface Advice {
  /** What the prompt appears to need. */
  readonly signal: string;
  /** Vendors that handled it in the published run. */
  readonly better: readonly Vendor[];
  /** The line shown to the caller. */
  readonly note: string;
}

const has = (p: string, ...needles: string[]): boolean => needles.some((n) => p.includes(n));

/**
 * What the prompt is asking for, and who did it well.
 *
 * Each rule names the observation behind it, because advice with no evidence
 * behind it is just a preference, and the reader deserves to know which is
 * which.
 */
export function adviseFor(prompt: string, vendor: Vendor, referenceCount?: number): Advice | undefined {
  const p = prompt.toLowerCase();

  // Exact text, real numbers, or a structure that has to be correct. Borrowed
  // from Grok's `imagine` skill and confirmed by the README run: every raster
  // model's "straight" lines wobble, and a model asked for a labelled chart
  // invents the bars. No image model is the right tool for this, including the
  // vector one, because Arrow draws what it was told rather than what the data
  // says.
  // Note the specificity: "chart" alone would swallow "flowchart", which is a
  // diagram and belongs to the vector model below. The distinction is whether
  // the image has to carry DATA or exact copy, not whether it has boxes in it.
  if (
    has(p, 'bar chart', 'pie chart', 'line chart', 'graph of', 'table of', 'infographic', 'dashboard', 'screenshot', 'ui mockup', 'user interface', 'comic strip', 'storyboard', 'contact sheet') ||
    /\b(with|showing|displaying)\b[^.]{0,40}\b(real|actual|exact)\b[^.]{0,20}\b(data|numbers|figures|text|copy)\b/.test(p)
  ) {
    return {
      signal: 'exact text, real data, or a structure that must be correct',
      better: [],
      note:
        'Nothing here is the right tool for this. Image models garble words, invent numbers, and draw bars that match no data, and re-prompting garbles it again. ' +
        'Build it in code instead: HTML and CSS give exact text, real values and a layout you control, and screenshot it. ' +
        'Use this server for the parts where only the look matters.',
    };
  }

  // A subject that has to survive across several images.
  if (
    (referenceCount ?? 0) === 0 &&
    has(p, 'same character', 'same person', 'consistent', 'again', 'another view', 'from behind', 'second panel', 'series of')
  ) {
    return {
      signal: 'a subject that has to stay the same across images',
      better: [],
      note:
        'Nothing here remembers a subject between calls, so two generations of "the same" character always drift. ' +
        'Generate one canonical image first, then pass its path in `referenceImages` on every later call, and restate the fixed traits each time.',
    };
  }

  // Diagrams. The clearest result in the run: the vector model produced exact
  // geometry and editable labelled boxes, and every raster model produced lines
  // that wobble under magnification because a sampler hallucinates straightness
  // pixel by pixel.
  if (
    vendor !== 'quiver' &&
    has(p, 'flowchart', 'diagram', 'chart', 'schematic', 'wireframe', 'icon', 'logo', 'floor plan', 'org chart')
  ) {
    return {
      signal: 'a diagram, icon or logo',
      better: ['quiver'],
      note:
        'This reads like a diagram. `svg: true` routes to Arrow 1.1, which emits real vector source: exact right angles, uniform stroke, and a file you can edit afterwards. ' +
        'In the published comparison it was the only model to get the geometry exactly right, and the raster models\' "straight" lines wobble when you zoom in.',
    };
  }

  // Exact counts. Cardinality past about five is where samplers drift.
  if (
    vendor !== 'openai' &&
    vendor !== 'googlepro' &&
    vendor !== 'muse' &&
    /\b(exactly|precisely)\b/.test(p) &&
    /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\b/.test(p)
  ) {
    return {
      signal: 'an exact count',
      better: ['openai', 'googlepro', 'muse'],
      note:
        'This prompt states an exact number. On the counting test in the README, GPT Image 2, Gemini 3 Pro Image and Muse Image 1.0 got the count AND the arrangement right with nothing touching; Recraft drew six when asked for seven. ' +
        'Try `style: "openai"`, `style: "gemini-pro"` or `style: "muse"` if the number matters.',
    };
  }

  // Negation. Text encoders have no NOT operator, so a forbidden noun tends to
  // summon itself.
  if (
    vendor !== 'openai' &&
    vendor !== 'xai' &&
    has(p, ' no ', 'without', 'empty', 'nothing', 'none of', 'do not include', 'exclude')
  ) {
    return {
      signal: 'things that must NOT appear',
      better: ['openai', 'xai'],
      note:
        'This prompt says what must NOT be in the image, which is the instruction models most often ignore: a forbidden object tends to summon itself. ' +
        'GPT Image 2 and Grok Imagine 2.0 were the two models to honour every exclusion in the README test, so `style: "openai"` or `style: "grok"` is the safer choice here.',
    };
  }

  // Photorealism.
  if (
    vendor !== 'recraft' &&
    has(p, 'photorealistic', 'photograph', 'photo of', 'studio lighting', 'dslr', '85mm', '50mm', 'shallow depth of field', 'bokeh')
  ) {
    return {
      signal: 'a photograph',
      better: ['recraft'],
      note:
        'This asks for a photograph. Recraft V4.1 Pro produced the most convincing images by a clear margin in the README comparison, so `style: "photoreal"` is worth trying. ' +
        'Check the details yourself: it was also the model that miscounted, so it buys realism rather than obedience.',
    };
  }

  return undefined;
}

/**
 * A warning about the model that was actually used.
 *
 * Separate from `adviseFor` because this fires on an observed failure rather
 * than on a better alternative, and the caller should hear it even when it has
 * chosen deliberately.
 */
export function warnAbout(prompt: string, vendor: Vendor): string | undefined {
  const p = prompt.toLowerCase();

  if (
    vendor === 'google' &&
    has(p, 'light from', 'lit from', 'window light', 'shadow falls', 'casting') &&
    has(p, 'left', 'right')
  ) {
    return (
      'Gemini 3.1 Flash inverted the lighting on the one directional-light prompt in the README comparison: asked for light from the right and a shadow to the left, it did the opposite. ' +
      'One sample, so not conclusive, but if the light direction matters, check it, or use `style: "gemini-pro"`, which got the same prompt right.'
    );
  }

  if (vendor === 'bytedance') {
    return (
      'Seedream watermarks its output with "AI generated" and was the slowest model in the comparison by a wide margin (83 to 114 seconds against 6 to 20 for the others). ' +
      'Worth knowing before you use it for anything you intend to publish.'
    );
  }

  if (vendor === 'quiver' && has(p, 'photo', 'realistic', 'photograph')) {
    return 'Arrow writes vector shapes, so it cannot produce a photograph. Expect a flat illustration; use `style: "photoreal"` if you wanted a photo.';
  }

  return undefined;
}

/**
 * Video-specific advice, when the caller has not said enough.
 *
 * The failure modes are different from images and they are mostly about the
 * prompt rather than the model. A video model given a static noun phrase has to
 * invent both the motion and the camera, and it invents badly; given two actions
 * it teleports between them. Neither is fixable by picking a different vendor,
 * so this suggests words rather than a model.
 */
export function adviseForVideo(prompt: string, hasSourceImage: boolean): string | undefined {
  const p = prompt.toLowerCase();

  // Nothing in the prompt moves. This is the single most common way a video
  // prompt disappoints: the model picks a motion at random.
  const MOTION =
    /\b(walk|run|turn|spin|rotat|pan|zoom|push|pull|dolly|track|orbit|tilt|fly|drift|fall|rise|open|close|pour|drip|blow|sway|flicker|ripple|steam|smoke|swirl|glid|approach|reced|shake|bounc|wave|slide|lean|reach|nod)/;
  if (!MOTION.test(p)) {
    return (
      'This prompt names no motion and no camera move, so the model will invent both, and it invents badly. ' +
      'Say what moves and how the camera behaves: "slow push-in", "the steam drifts left", "she turns to face the window". ' +
      'One subject and one simple movement beats a busy scene at every model here.'
    );
  }

  // Two or more actions in sequence. Models collapse these.
  if (/\b(then|after that|and then|followed by|before)\b/.test(p)) {
    return (
      'This asks for more than one action in sequence, which every model here handles poorly: the result teleports between them rather than moving through them. ' +
      'Split it into separate clips of one beat each, and seed the second from the last frame of the first.'
    );
  }

  if (!hasSourceImage) {
    return (
      'No `sourceImage`, so the model invents the first frame as well as the motion, and you get no control over the look. ' +
      'Generating a still first with `generate_image` and passing its path is the strongest lever available here, and the only way to keep a subject consistent across clips.'
    );
  }

  return undefined;
}
