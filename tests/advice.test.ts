import { describe, expect, it } from 'vitest';
import { adviseFor, warnAbout } from '../src/advice.js';

describe('suggesting a better model', () => {
  it('points a diagram at the vector model', () => {
    const a = adviseFor('a flowchart with three boxes', 'openai');
    expect(a?.better).toContain('quiver');
    expect(a?.note).toMatch(/svg: true/);
  });

  it('stays quiet when the caller already picked the right one', () => {
    expect(adviseFor('a flowchart with three boxes', 'quiver')).toBeUndefined();
    expect(adviseFor('exactly seven bolts', 'openai')).toBeUndefined();
    expect(adviseFor('a photorealistic portrait', 'recraft')).toBeUndefined();
  });

  it('names both models that passed the counting test, not just one', () => {
    const a = adviseFor('exactly seven brass bolts in a row', 'xai');
    expect(a?.better).toEqual(['openai', 'googlepro']);
  });

  it('needs a number as well as the word, so "exactly right" is not a count', () => {
    expect(adviseFor('get the mood exactly right', 'xai')).toBeUndefined();
  });

  it('catches exclusions, which are the instruction most often ignored', () => {
    expect(adviseFor('an empty room with no people', 'xai')?.better).toContain('openai');
    expect(adviseFor('a street scene without cars', 'google')?.better).toContain('openai');
  });

  it('points a photograph at the photorealism model', () => {
    expect(adviseFor('shot on 85mm with shallow depth of field', 'xai')?.better).toContain('recraft');
  });

  it('says nothing for an ordinary prompt', () => {
    expect(adviseFor('a watercolour of a harbour at dusk', 'google')).toBeUndefined();
  });
});

describe('warning about the model actually used', () => {
  it('flags the one lighting failure observed, and only for the model that made it', () => {
    const p = 'window light from the right, shadow falls to the left';
    expect(warnAbout(p, 'google')).toMatch(/inverted the lighting/);
    // Gemini 3 Pro got the same prompt right, so it must not inherit the warning.
    expect(warnAbout(p, 'googlepro')).toBeUndefined();
  });

  it('does not warn about lighting when the prompt says nothing about direction', () => {
    expect(warnAbout('a bowl of figs', 'google')).toBeUndefined();
  });

  it('always mentions the watermark, because it survives into whatever you publish', () => {
    expect(warnAbout('anything at all', 'bytedance')).toMatch(/watermarks/);
  });

  it('tells the vector model it cannot photograph', () => {
    expect(warnAbout('a photorealistic kettle', 'quiver')).toMatch(/cannot produce a photograph/);
    expect(warnAbout('a flat icon of a kettle', 'quiver')).toBeUndefined();
  });
});
