import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { nearestReachableVendor } from '../src/models.js';

const base = {
  AI_GATEWAY_API_KEY: 'gw',
  IMAGE_GEN_OUTPUT_DIR: '/tmp',
};

describe('IMAGE_GEN_ALLOWED_STYLES', () => {
  it('reads style aliases, not internal vendor keys', () => {
    const config = loadConfig({ ...base, IMAGE_GEN_ALLOWED_STYLES: 'gemini-pro,gemini' });
    expect(config.allowedVendors).toEqual(['googlepro', 'google']);
  });

  it('is unrestricted when unset, which is the historical behaviour', () => {
    expect(loadConfig(base).allowedVendors).toEqual([]);
  });

  it('drops an unknown name rather than emptying the set', () => {
    const config = loadConfig({ ...base, IMAGE_GEN_ALLOWED_STYLES: 'gemini-pro,notavendor' });
    expect(config.allowedVendors).toEqual(['googlepro']);
  });

  it('does not let an unknown name resolve to the fallback vendor', () => {
    // resolveVendor returns its fallback for an EMPTY style, so a parser that passed
    // every name through without checking would silently admit google for a typo.
    const config = loadConfig({ ...base, IMAGE_GEN_ALLOWED_STYLES: 'wat' });
    expect(config.allowedVendors).toEqual([]);
  });

  it('de-duplicates aliases pointing at one vendor', () => {
    const config = loadConfig({ ...base, IMAGE_GEN_ALLOWED_STYLES: 'gemini,nanobanana,google' });
    expect(config.allowedVendors).toEqual(['google']);
  });
});

describe('nearestReachableVendor', () => {
  const allowed = ['googlepro', 'google'] as const;

  it('substitutes a photorealism request to the CAREFUL tier, not the cheapest', () => {
    // This is the case that cost a finished deck: the classifier correctly chose the
    // photorealism vendor and the gateway had no ZDR credential for it.
    expect(nearestReachableVendor('recraft', allowed)).toBe('googlepro');
    expect(nearestReachableVendor('flare', allowed)).toBe('googlepro');
    expect(nearestReachableVendor('sunburst', allowed)).toBe('googlepro');
  });

  it('keeps a cheap request cheap', () => {
    expect(nearestReachableVendor('xai', allowed)).toBe('google');
    expect(nearestReachableVendor('xaicli', allowed)).toBe('google');
  });

  it('leaves a reachable choice alone', () => {
    expect(nearestReachableVendor('google', allowed)).toBe('google');
    expect(nearestReachableVendor('googlepro', allowed)).toBe('googlepro');
  });

  it('changes nothing when no restriction is configured', () => {
    expect(nearestReachableVendor('recraft', [])).toBe('recraft');
    expect(nearestReachableVendor('quiver', [])).toBe('quiver');
  });

  it('substitutes one Arrow for the other, because only a vector answers a vector request', () => {
    // A deployment may allow one and not the other. Degrading to a raster model
    // would answer a different question, so the family substitutes internally.
    expect(nearestReachableVendor('quiver', ['quiver-telos'])).toBe('quiver-telos');
    expect(nearestReachableVendor('quiver-telos', ['quiver'])).toBe('quiver');
  });

  it('degrades to something reachable rather than throwing when no sibling is allowed', () => {
    // With neither Arrow permitted there is no vector answer to give, so the
    // request falls to the first allowed vendor rather than failing outright.
    expect(nearestReachableVendor('quiver', allowed)).toBe('googlepro');
    expect(nearestReachableVendor('quiver-telos', allowed)).toBe('googlepro');
  });
});
