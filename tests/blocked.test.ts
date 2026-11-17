import { describe, expect, it } from 'vitest';
import { adviseFor } from '../src/advice.js';
import { guidanceForBlock, isModerationBlock, renderBlock } from '../src/blocked.js';

describe('spotting a refusal', () => {
  it('recognises the shapes providers use', () => {
    for (const m of [
      'Your request was rejected by our safety system',
      'content_policy_violation',
      'Image generation blocked: prohibited content',
    ])
      expect(isModerationBlock(m)).toBe(true);
  });

  it('does not read an outage or a bad key as a refusal', () => {
    // Getting this wrong would answer a broken key with advice about rewording
    // the prompt, which sends someone the wrong way entirely.
    for (const m of ['429 rate limit exceeded', 'invalid_api_key', 'request timeout after 180000ms', 'model not found'])
      expect(isModerationBlock(m)).toBe(false);
  });
});

describe('what to suggest after a refusal', () => {
  it('turns a studio name into the properties that were actually wanted', () => {
    const g = guidanceForBlock('a brave little robot in Pixar style');
    expect(g?.why).toMatch(/animation studio/);
    expect(g?.instead).toMatch(/subsurface scattering/);
  });

  it('turns a borrowed character into a described one', () => {
    expect(guidanceForBlock('Batman on a rooftop')?.why).toMatch(/copyrighted character/);
  });

  it('offers no rewrite for sexual content, and says so', () => {
    // The rule that keeps this file honest: where there is no legitimate
    // version of the request, it must not invent a euphemism for the same one.
    const g = guidanceForBlock('a topless woman, photorealistic');
    expect(g?.instead).toMatch(/no rewrite for this one/);
  });

  it('keeps the narrow refusals above the broad person rule', () => {
    // "a topless woman" contains "woman". With the person rule first it offered
    // a rewrite for a request that has none.
    expect(guidanceForBlock('a topless woman')?.instead).toMatch(/no rewrite for this one/);
    expect(guidanceForBlock('a woman turning to the window')?.instead).toMatch(/obviously synthetic/);
  });

  it('reads a real-person refusal as a refusal, not a fault', () => {
    // Seedance's wording matches none of the usual moderation words.
    expect(isModerationBlock("The request failed because the input image 'content[1]' may contain real person")).toBe(true);
  });

  it('admits when it cannot tell what was wrong', () => {
    const out = renderBlock('a quiet harbour at dusk', 'GPT Image 2.6 Flare', 'blocked by safety system');
    expect(out).toMatch(/may be about a detail rather than the whole idea/);
  });

  it('always tells the caller not to reword its way past the filter', () => {
    for (const p of ['a brave little robot in Pixar style', 'a quiet harbour at dusk']) {
      const out = renderBlock(p, 'Grok Imagine', 'rejected');
      expect(out).toMatch(/Do NOT retry this with reworded phrasing/);
      expect(out).toMatch(/do not try another model hoping it is more permissive/);
    }
  });
});

describe('sending exact-data work away from image models entirely', () => {
  it('names code, not another model, for a chart', () => {
    const a = adviseFor('a bar chart of quarterly revenue', 'flare');
    expect(a?.better).toEqual([]);
    expect(a?.note).toMatch(/HTML and CSS/);
  });

  it('does not steal flowchart from the vector model', () => {
    // "chart" is a substring of "flowchart"; a flowchart is a diagram and Arrow
    // is right for it.
    expect(adviseFor('a flowchart with three boxes', 'flare')?.better).toContain('quiver');
  });

  it('points a recurring subject at referenceImages, but not once one is supplied', () => {
    expect(adviseFor('the same character again, from behind', 'flare', 0)?.note).toMatch(/referenceImages/);
    expect(adviseFor('the same character again, from behind', 'flare', 1)).toBeUndefined();
  });
});
