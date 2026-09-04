import { describe, expect, it } from 'vitest';
import { type Config, inferDefaultProvider, loadConfig } from '../src/config.js';
import { CHOICES, route } from '../src/router.js';
import { SVG_VENDOR, resolveVendor } from '../src/models.js';

const base: Config = {
  openaiKey: '', googleKey: '', gatewayKey: '', outputDir: '',
  defaultProvider: 'openai',
  allowedVendors: [], preferGateway: false,
  maxPerHour: 60, maxPerCall: 4, timeoutMs: 180_000,
  videoTimeoutMs: 1_500_000, videoMaxPerHour: 20,
};

describe('every answer the classifier may give reaches a real vendor', () => {
  it('resolves each choice, so the enum cannot drift from the alias table', () => {
    // `route` maps the classifier's answer through resolveVendor. A choice the
    // alias table does not know returns undefined and silently demotes every
    // request in that category to the configured default, which looks like the
    // classifier being wrong rather than a name having drifted. "svg" is the one
    // choice handled before the lookup, so it is checked against its own vendor.
    for (const choice of CHOICES) {
      if (choice === 'svg') {
        expect(SVG_VENDOR).toBe('quiver');
        continue;
      }
      expect(resolveVendor(choice, 'google'), `classifier choice "${choice}"`).toBeDefined();
    }
  });

  it('covers the models the README compares, not a subset of them', () => {
    for (const choice of ['openai', 'gemini', 'gemini-lite', 'gemini-pro', 'photoreal', 'seedream', 'grok', 'muse', 'svg'])
      expect(CHOICES).toContain(choice);
  });
});

describe('the default vendor follows the keys that exist', () => {
  it('picks the one the operator actually supplied', () => {
    // A server holding only a Gemini key was defaulting to OpenAI and failing
    // every unstyled request on a missing key, which reads as a broken install.
    expect(inferDefaultProvider('', 'g', '')).toBe('google');
    expect(inferDefaultProvider('o', '', '')).toBe('openai');
  });

  it('breaks a tie toward openai', () => {
    // With a gateway key everything is reachable and with both first-party keys
    // either would work, so the model best at following instructions wins.
    expect(inferDefaultProvider('o', 'g', '')).toBe('openai');
    expect(inferDefaultProvider('', 'g', 'gw')).toBe('openai');
    expect(inferDefaultProvider('', '', 'gw')).toBe('openai');
  });

  it('is overridable, and reads through loadConfig', () => {
    expect(loadConfig({ GEMINI_API_KEY: 'g' }).defaultProvider).toBe('google');
    expect(loadConfig({ GEMINI_API_KEY: 'g', IMAGE_GEN_DEFAULT_PROVIDER: 'bytedance' }).defaultProvider).toBe('bytedance');
  });
});

describe('routing falls back rather than failing the generation', () => {
  it('does not run without a gateway key, and says so', async () => {
    const r = await route('a cat', { ...base, googleKey: 'g', defaultProvider: 'google' });
    expect(r.vendor).toBe('google');
    expect(r.fallback).toMatch(/no gateway key/);
  });

  it('reports a classifier failure instead of throwing', async () => {
    // A classifier that is down must not take the whole generation with it.
    const r = await route('a cat', { ...base, gatewayKey: 'not-a-real-key' }, 1);
    expect(r.vendor).toBe('openai');
    expect(r.fallback).toBeDefined();
  });
});
