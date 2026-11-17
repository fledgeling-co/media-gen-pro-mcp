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

import { isVectorVendor, type Vendor } from './models.js';

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
        'Nothing here is reliably the right tool for this. Image models garble words, invent numbers, and draw bars that match no data, and re-prompting garbles it again. ' +
        'Build it in code instead: HTML and CSS give exact text, real values and a layout you control, and screenshot it. ' +
        'Use this server for the parts where only the look matters. ' +
        'The one hedge worth knowing: Meta says Muse Image 1.0 writes and runs code to produce accurate plots and QR codes, and searches the web to ground an image in current fact. ' +
        'That is the vendor\'s claim, untested here, so `style: "muse"` is worth a try before you give up — but check the numbers against your own.',
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
    !isVectorVendor(vendor) &&
    has(p, 'flowchart', 'diagram', 'chart', 'schematic', 'wireframe', 'icon', 'logo', 'floor plan', 'org chart')
  ) {
    return {
      signal: 'a diagram, icon or logo',
      better: ['quiver', 'quiver-telos'],
      note:
        'This reads like a diagram. `svg: true` routes to Arrow 2, which emits real vector source: exact right angles, uniform stroke, and a file you can edit afterwards. ' +
        'In the published comparison the vector model was the only one to get the geometry exactly right, and the raster models\' "straight" lines wobble when you zoom in. ' +
        'For a dense or complex one, `style: "telos"` takes Arrow 2 Telos, which Quiver positions for harder briefs.',
    };
  }

  // Exact counts. Cardinality past about five is where samplers drift.
  if (
    vendor !== 'googlepro' &&
    vendor !== 'muse' &&
    vendor !== 'flare' &&
    vendor !== 'sunburst' &&
    /\b(exactly|precisely)\b/.test(p) &&
    /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\b/.test(p)
  ) {
    return {
      signal: 'an exact count',
      better: ['googlepro', 'muse', 'flare', 'sunburst'],
      note:
        'This prompt states an exact number. On the counting test in the README, Gemini 3 Pro Image, Muse Image 1.0, GPT Image 2.5 Flare and GPT Image 2.5 Sunburst got the count AND the arrangement right with nothing touching; Recraft drew six when asked for seven. ' +
        'Try `style: "gemini-pro"`, `style: "muse"`, `style: "flare"` or `style: "sunburst"` if the number matters.',
    };
  }

  // Negation. Text encoders have no NOT operator, so a forbidden noun tends to
  // summon itself.
  if (
    vendor !== 'xai' &&
    vendor !== 'flare' &&
    vendor !== 'sunburst' &&
    has(p, ' no ', 'without', 'empty', 'nothing', 'none of', 'do not include', 'exclude')
  ) {
    return {
      signal: 'things that must NOT appear',
      better: ['xai', 'flare', 'sunburst'],
      note:
        'This prompt says what must NOT be in the image, which is the instruction models most often ignore: a forbidden object tends to summon itself. ' +
        'Grok Imagine 2.0, GPT Image 2.5 Flare and GPT Image 2.5 Sunburst were the models to honour every exclusion in the README test, so `style: "grok"`, `style: "flare"` or `style: "sunburst"` is the safer choice here.',
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

  if (isVectorVendor(vendor) && has(p, 'photo', 'realistic', 'photograph')) {
    return 'Arrow writes vector shapes, so it cannot produce a photograph. Expect a flat illustration; use `style: "photoreal"` if you wanted a photo.';
  }

  // An invisible watermark is not a defect, but it IS a fact about the file
  // that someone publishing it should hear before they publish rather than
  // after. Meta says Content Seal survives cropping, compression, resizing and
  // screenshotting, which is the point of it and also the reason it cannot be
  // removed by the usual means.
  if (vendor === 'muse') {
    return (
      'Muse Image 1.0 embeds Content Seal, Meta\'s invisible watermark, which Meta says survives cropping, compression, resizing and screenshotting. ' +
      'Nothing is visible on the picture, but the provenance signal travels with it.'
    );
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

/**
 * A video request that is really a motion graphic.
 *
 * Video models invent the words, numbers and interface they are asked to show,
 * for the same reason image models do, and re-prompting invents them again. A
 * motion graphic built from code keeps the text exact and the screens real, and
 * the motion-craft skill builds exactly that: an HTML composition rendered
 * locally through HyperFrames. So this names the trait that gave the request
 * away and points at the skill.
 *
 * Advice, never a reroute, like every other note here: the clip was made with
 * what the caller asked for. Matched on the prompt's own words, because a
 * classifier call on every generation would cost money to produce a suggestion.
 */
const MOTION_GRAPHIC_TRAITS: readonly (readonly [string, RegExp])[] = [
  ['words on screen', /\b(kinetic (type|typography)|animated (text|type|title|titles|words|headline)|text animation|title (card|sequence)|lower[- ]thirds?|subtitles|on[- ]screen (text|captions?|words)|headline (appears|animates|types)|(text|words|letters) (type|types|typing) out|typewriter text)\b/],
  ['a logo animation', /\b(logo (animation|reveal|sting|intro|outro|build|animates)|animated logo|wordmark|intro sting|brand sting)\b/],
  ['a chart or numbers that animate', /\b((bar|line|pie|area|animated) (chart|graph)|(chart|graph) (animates|builds|grows|rises|appears)|data (viz|visuali[sz]ation|story)|infographic|numbers? (rise|rises|climb|climbs|tick|ticks|count|counts)|count(s|ing)? up to|kpis?)\b/],
  ['a product or interface demo', /\b(ui|user interface|(app|software|product) (interface|screen|demo|walkthrough)|screen ?(recording|cast)|screencast|(analytics|admin|sales|saas|product) dashboard|dashboard (ui|screen|view)|cursor (clicks|moves|hovers)|web ?page|website (demo|scroll|tour)|saas)\b/],
  ['an explainer or motion graphic', /\b(explainer|motion graphics?|(animated|labell?ed|technical) diagram|diagram (animates|builds)|flow ?chart|slide ?(deck|show)|presentation slides)\b/],
];

export function motionGraphicTrait(prompt: string): string | undefined {
  const p = prompt.toLowerCase();
  return MOTION_GRAPHIC_TRAITS.find(([, re]) => re.test(p))?.[0];
}

export function motionCraftNote(prompt: string): string | undefined {
  const trait = motionGraphicTrait(prompt);
  if (!trait) return undefined;
  return (
    `This reads as a motion graphic (${trait}), and a video model invents the words, numbers and screens it is asked to show. ` +
    'If the session has the motion-craft skill, `motion-craft:motion-craft` builds this from code instead: an HTML composition rendered on this machine through HyperFrames, ' +
    'with the exact text, the real interface and real numbers, editable after render and free to make. ' +
    'Keep generate_video for what code cannot draw, such as real-world footage, people, places and physical products; motion-craft can place those clips inside its film.'
  );
}
