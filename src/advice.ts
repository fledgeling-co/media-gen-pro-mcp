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
export function adviseFor(prompt: string, vendor: Vendor): Advice | undefined {
  const p = prompt.toLowerCase();

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
    /\b(exactly|precisely)\b/.test(p) &&
    /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\b/.test(p)
  ) {
    return {
      signal: 'an exact count',
      better: ['openai', 'googlepro'],
      note:
        'This prompt states an exact number. On the counting test in the README, only GPT Image 2 and Gemini 3 Pro Image got the count AND the arrangement right; Recraft drew six when asked for seven and Grok drew five. ' +
        'Try `style: "openai"` or `style: "gemini-pro"` if the number matters.',
    };
  }

  // Negation. Text encoders have no NOT operator, so a forbidden noun tends to
  // summon itself.
  if (
    vendor !== 'openai' &&
    has(p, ' no ', 'without', 'empty', 'nothing', 'none of', 'do not include', 'exclude')
  ) {
    return {
      signal: 'things that must NOT appear',
      better: ['openai'],
      note:
        'This prompt says what must NOT be in the image, which is the instruction models most often ignore: a forbidden object tends to summon itself. ' +
        'GPT Image 2 was the only model to honour every exclusion in the README test, so `style: "openai"` is the safer choice here.',
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
