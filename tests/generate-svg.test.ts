import { describe, expect, it } from 'vitest';
import { extractSvg } from '../src/generate.js';

/**
 * Arrow 2 is a language model, so its answer can be SVG SOURCE as text rather
 * than a file. Before this, `viaLanguage` rejected a text-only answer outright,
 * which would have turned every Arrow 2 generation into "returned no image".
 */
describe('pulling vector source out of a language model answer', () => {
  it('takes a bare document', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    expect(extractSvg(svg)).toBe(svg);
  });

  it('takes one wrapped in a fenced block, which is how a model usually sends source', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    expect(extractSvg('Here you go:\n\n```svg\n' + svg + '\n```\n')).toBe(svg);
  });

  it('keeps nested elements by slicing to the LAST close, not the first', () => {
    // An <svg> inside an <svg> is legal. Stopping at the first `</svg>` would
    // return a truncated document that no renderer accepts.
    const svg = '<svg><g><svg viewBox="0 0 2 2"><rect/></svg></g></svg>';
    expect(extractSvg('output: ' + svg)).toBe(svg);
  });

  it('returns nothing for prose, so a refusal is still reported as one', () => {
    expect(extractSvg("I can't help with that request.")).toBeUndefined();
    expect(extractSvg('')).toBeUndefined();
    // An opening tag with no close is not a document.
    expect(extractSvg('<svg viewBox="0 0 1 1">')).toBeUndefined();
  });
});
