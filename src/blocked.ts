/**
 * What to say when a provider refuses.
 *
 * The distinction this file exists to hold: helping someone describe what they
 * actually want is not helping them get past a filter. A request for "Buzz
 * Lightyear in Pixar style" is usually not a request for that character at all;
 * it is a request for stylised 3D animation, and naming the properties gets a
 * better image than naming the studio would have. A request that genuinely is
 * for the protected thing gets no rewrite, because there is nothing to rewrite
 * it into.
 *
 * So the suggestions here only ever move in one direction: from naming an entity
 * toward describing an aesthetic. None of them is a paraphrase intended to slip
 * the same content past a classifier, and the guidance says so out loud, because
 * an agent handed a refusal will otherwise try synonyms on its own.
 *
 * Borrowed from Grok's `imagine` skill, which is right about the failure mode:
 * on a block, stop, do not retry, do not paraphrase to evade. Offer a different
 * direction.
 */

/** Whether a provider error looks like a content refusal rather than a fault. */
export function isModerationBlock(message: string): boolean {
  const m = message.toLowerCase();
  return (
    // `may contain real person` is Seedance's refusal for an image-to-video
    // seed, observed 31 July 2026. It matches none of the usual words, so a
    // refusal read as a fault and the caller was told to check its network.
    /\b(moderation|content[_ ]policy|safety[_ ]system|blocked|rejected|violat|not allowed|disallowed|prohibited|refus|may contain real person|real person)/.test(
      m,
    ) && !/\b(rate limit|timeout|unauthor|not found|invalid[_ ]api|quota)\b/.test(m)
  );
}

interface Rewrite {
  readonly trigger: RegExp;
  readonly why: string;
  readonly instead: string;
}

/**
 * Each rule names a thing people ask for by proper noun when what they want is
 * an aesthetic. The rewrite is not a euphemism for the same request; it is the
 * request they meant, and it usually produces a better image because a model
 * given attributes has more to work with than a model given a trademark.
 */
// ORDER MATTERS. Rules are tried top to bottom and the first match wins, so the
// narrow refusals come before the broad ones. The person rule below matches
// "woman", which also appears in every sexual-content prompt; above the nude
// rule it offered a rewrite for a request that has none.
const REWRITES: Rewrite[] = [
  {
    trigger: /\b(pixar|disney|dreamworks|studio ghibli|ghibli|illumination|aardman)\b/i,
    why: 'it names an animation studio, which is a request for their house style rather than for a look you have described',
    instead:
      'Describe the look instead of the studio: "stylised 3D character animation, oversized eyes with visible catchlights, soft subsurface scattering on the skin, rounded simplified forms, warm key light with cool bounce, shallow depth of field". ' +
      'That is usually what was wanted anyway, and a model given those attributes has far more to work with than one given a trademark.',
  },
  {
    trigger: /\b(marvel|dc comics|star wars|pokemon|nintendo|mario|batman|spider[- ]?man|mickey mouse|hello kitty)\b/i,
    why: 'it names a copyrighted character or franchise',
    instead:
      'Describe the character you want rather than borrowing one: species or build, costume shapes and colours, silhouette, expression, era. ' +
      'A described character is also reusable, since you can feed the result back as a `referenceImages` entry to keep it consistent across a set.',
  },
  {
    trigger: /\b(in the style of|style of)\s+[A-Z]/,
    why: 'it asks for a named artist\'s style as the primary anchor',
    instead:
      'Name the visual properties you are after: medium, brushwork or line quality, palette, contrast, level of abstraction, era. ' +
      'One influence among several is ordinary; a single living artist as the whole brief is the part that gets refused.',
  },
  {
    trigger: /\b(nude|naked|topless|nsfw|erotic|explicit)\b/i,
    why: 'it asks for sexual content, which every model here declines',
    instead:
      'There is no rewrite for this one. If the underlying brief is a clothed figure study, life-drawing reference, or anatomy for illustration, ask for that directly and say what the figure is wearing.',
  },
  {
    // Not a rewrite toward a different subject: the same subject, generated
    // rather than photographed, is what the model will actually accept.
    trigger: /\b(person|woman|man|face|portrait|she|he|her|his)\b/i,
    why: 'a video model refused the source image for showing what it took to be a real person, which several apply to any photographic face',
    instead:
      'Seed the clip from an image you generated rather than a photograph, and say so in the prompt ("illustrated character", "stylised figure"). ' +
      'The same shot usually passes when the first frame is obviously synthetic. If the subject must be a real person, that is a consent question rather than a prompt problem, and no rewording fixes it.',
  },
];

export interface BlockGuidance {
  readonly why: string;
  readonly instead: string;
}

/** What, if anything, is worth suggesting about a refused prompt. */
export function guidanceForBlock(prompt: string): BlockGuidance | undefined {
  for (const r of REWRITES) {
    if (r.trigger.test(prompt)) return { why: r.why, instead: r.instead };
  }
  return undefined;
}

/** The text returned to the caller when a generation is refused. */
export function renderBlock(prompt: string, label: string, message: string): string {
  const g = guidanceForBlock(prompt);
  return [
    `**${label} declined this prompt.** Its words: ${message.slice(0, 300)}`,
    '',
    '> [!IMPORTANT]',
    '> Do NOT retry this with reworded phrasing to get past the filter, and do not try another model hoping it is more permissive. Tell the user it was declined and what they can do instead.',
    '',
    ...(g
      ? [
          `This prompt was probably refused because ${g.why}.`,
          '',
          g.instead,
        ]
      : [
          'Nothing in the prompt obviously names a protected subject, so the refusal may be about a detail rather than the whole idea. ' +
            'Ask the user which part matters, and describe the subject by its visible properties rather than by naming a person, character, studio or brand.',
        ]),
  ].join('\n');
}
