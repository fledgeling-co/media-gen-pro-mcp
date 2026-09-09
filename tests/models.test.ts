import { describe, expect, it } from 'vitest';
import { type Config, loadConfig } from '../src/config.js';
import { RateLimiter } from '../src/generate.js';
import { KNOWN_STYLES, RoutingError, availableRoutes, chooseModel, resolveVendor, supportsBatch } from '../src/models.js';

const base: Config = {
  openaiKey: '',
  googleKey: '',
  gatewayKey: '',
  outputDir: '',
  defaultProvider: 'openai',
  allowedVendors: [],
  preferGateway: false,
  maxPerHour: 60,
  maxPerCall: 4,
  timeoutMs: 180_000,
  videoTimeoutMs: 600_000,
  videoMaxPerHour: 20,
};
const with_ = (o: Partial<Config>): Config => ({ ...base, ...o });

describe('picking a vendor', () => {
  it('accepts the names people actually say', () => {
    for (const s of ['gemini', 'nanobanana', 'nano-banana', 'nano banana', 'google', 'GEMINI'])
      expect(resolveVendor(s, 'openai')).toBe('google');
    for (const s of ['gemini-pro', 'geminipro', 'gemini-3-pro']) expect(resolveVendor(s, 'openai')).toBe('googlepro');
    for (const s of ['openai', 'gpt-image-2', 'dalle']) expect(resolveVendor(s, 'google')).toBe('openai');
    for (const s of ['flare', 'gpt-image-2.5-flare', 'FLARE']) expect(resolveVendor(s, 'google')).toBe('flare');
    for (const s of ['sunburst', 'gpt-image-2.5-sunburst']) expect(resolveVendor(s, 'google')).toBe('sunburst');
    for (const s of ['seedream', 'bytedance']) expect(resolveVendor(s, 'openai')).toBe('bytedance');
    for (const s of ['svg', 'arrow', 'quiver', 'quiverai']) expect(resolveVendor(s, 'openai')).toBe('quiver');
    for (const s of ['grok', 'xai', 'imagine']) expect(resolveVendor(s, 'openai')).toBe('xai');
    for (const s of ['recraft', 'photo', 'photoreal']) expect(resolveVendor(s, 'openai')).toBe('recraft');
    for (const s of ['gemini-lite', 'flash-lite', 'geminilite']) expect(resolveVendor(s, 'openai')).toBe('googlelite');
    for (const s of ['muse', 'meta', 'muse-image']) expect(resolveVendor(s, 'openai')).toBe('muse');
    for (const s of ['utility', 'recraft-utility']) expect(resolveVendor(s, 'openai')).toBe('recraft-utility');
    for (const s of ['utility-pro', 'recraft-utility-pro']) expect(resolveVendor(s, 'openai')).toBe('recraft-utility-pro');
    expect(resolveVendor('recraft-v4.1', 'openai')).toBe('recraft-v4.1');
  });

  it('sends the current model id for each vendor', () => {
    // The ids that moved when the models were updated. `xai/grok-imagine-image`
    // and `bytedance/seedance-2.0-fast` are gone from the gateway's catalogue;
    // an id left behind here 404s at the vendor rather than failing here.
    const g = with_({ gatewayKey: 'g' });
    expect(chooseModel('xai', g).modelId).toBe('spacexai/grok-imagine-image-2.0');
    expect(chooseModel('googlelite', g).modelId).toBe('google/gemini-3.1-flash-lite-image');
    expect(chooseModel('muse', g).modelId).toBe('meta/muse-image-1.0');
    expect(chooseModel('recraft', g).modelId).toBe('recraft/recraft-v4.1-pro');
    expect(chooseModel('recraft-utility', g).modelId).toBe('recraft/recraft-v4.1-utility');
    expect(chooseModel('recraft-utility-pro', g).modelId).toBe('recraft/recraft-v4.1-utility-pro');
    expect(chooseModel('recraft-v4.1', g).modelId).toBe('recraft/recraft-v4.1');
    expect(chooseModel('bytedance', g).modelId).toBe('bytedance/seedream-5.0-pro');
    expect(chooseModel('flare', g).modelId).toBe('openai/gpt-image-2.5-flare');
    expect(chooseModel('sunburst', g).modelId).toBe('openai/gpt-image-2.5-sunburst');
  });

  it('reaches Flare and Sunburst through the image api, gateway-only', () => {
    // OpenAI's own /v1/models lists gpt-image-1 through gpt-image-2 only, so
    // there is no direct id for either; both answered n=2 in a single call on
    // 9 September 2026, so they batch like their GPT Image 2 sibling.
    const g = with_({ gatewayKey: 'g' });
    for (const v of ['flare', 'sunburst'] as const) {
      const c = chooseModel(v, g);
      expect(c.route).toBe('gateway');
      expect(c.api).toBe('image');
      expect(supportsBatch(v)).toBe(true);
    }
    expect(() => chooseModel('flare', base)).toThrow(/AI_GATEWAY_API_KEY/);
    expect(() => chooseModel('sunburst', base)).toThrow(/AI_GATEWAY_API_KEY/);
  });

  it('reaches Recraft through the image api, the workaround having been retired', () => {
    // Every Recraft model used to answer 200-with-an-error-body on the gateway's
    // image-model route, so they went through the OpenAI-compatible endpoint
    // instead. Re-checked 4 September 2026: all four V4.1 variants generate
    // correctly through the standard route, so the special case is gone.
    for (const v of ['recraft', 'recraft-utility', 'recraft-utility-pro', 'recraft-v4.1'] as const) {
      expect(chooseModel(v, with_({ gatewayKey: 'g' })).api).toBe('image');
    }
  });

  it('falls back when no style is named, and refuses one it does not know', () => {
    expect(resolveVendor(undefined, 'google')).toBe('google');
    expect(resolveVendor('  ', 'openai')).toBe('openai');
    // undefined, not a silent fallback: a typo'd vendor must not quietly bill
    // the default one.
    expect(resolveVendor('midjourney', 'openai')).toBeUndefined();
  });

  it('advertises every accepted spelling', () => {
    expect(KNOWN_STYLES).toContain('nanobanana');
    expect(KNOWN_STYLES).toContain('seedream');
  });
});

describe('routing to a key', () => {
  it('prefers the direct route when a first-party key exists', () => {
    const c = chooseModel('openai', with_({ openaiKey: 'k', gatewayKey: 'g' }));
    expect(c.route).toBe('direct');
    expect(c.modelId).toBe('gpt-image-2');
  });

  it('uses the gateway when only the gateway key exists', () => {
    const c = chooseModel('openai', with_({ gatewayKey: 'g' }));
    expect(c.route).toBe('gateway');
    expect(c.modelId).toBe('openai/gpt-image-2');
  });

  it('reaches Gemini through the LANGUAGE api, on either route', () => {
    // Gemini's image models are multimodal language models. The gateway types
    // them `language` and the image API refuses them outright, so the choice
    // carries which API to call rather than assuming every image comes from
    // generateImage.
    const gw = chooseModel('google', with_({ gatewayKey: 'g' }));
    expect(gw.route).toBe('gateway');
    expect(gw.api).toBe('language');
    expect(gw.modelId).toBe('google/gemini-3.1-flash-image');
    expect(chooseModel('google', with_({ googleKey: 'k' })).api).toBe('language');
    expect(chooseModel('openai', with_({ openaiKey: 'k' })).api).toBe('image');
  });

  it('sends a DIFFERENT model id on each route for the same model', () => {
    // The one that bites: Google's own API serves it as
    // `gemini-3-pro-image-preview`, the gateway as `google/gemini-3-pro-image`.
    // One id for both routes 404s on whichever was not tested.
    expect(chooseModel('google', with_({ googleKey: 'k' })).modelId).toBe('gemini-3.1-flash-image');
    expect(chooseModel('google', with_({ gatewayKey: 'g' })).modelId).toBe('google/gemini-3.1-flash-image');
  });

  it('honours preferGateway even when a direct key is present', () => {
    expect(chooseModel('openai', with_({ openaiKey: 'k', gatewayKey: 'g', preferGateway: true })).route).toBe('gateway');
    expect(chooseModel('google', with_({ googleKey: 'k', gatewayKey: 'g', preferGateway: true })).route).toBe('gateway');
  });

  it('says which key is missing rather than failing at the vendor', () => {
    expect(() => chooseModel('openai', base)).toThrow(RoutingError);
    expect(() => chooseModel('openai', base)).toThrow(/OPENAI_API_KEY/);
    expect(() => chooseModel('google', base)).toThrow(/GEMINI_API_KEY/);
  });

  it('routes a real SVG to the only model that writes vector source', () => {
    const c = chooseModel('quiver', with_({ gatewayKey: 'g' }));
    expect(c.modelId).toBe('quiverai/arrow-1.1');
    // Gateway-only, like Seedream: there is no first-party key to set.
    expect(() => chooseModel('quiver', with_({ openaiKey: 'k' }))).toThrow(/only reachable through/);
  });

  it('says Seedream has no first-party route at all', () => {
    // Not "set a key": there is no key to set. A message telling someone to get
    // a ByteDance key would send them somewhere that does not help.
    expect(() => chooseModel('bytedance', with_({ openaiKey: 'k', googleKey: 'k' }))).toThrow(/only reachable through/);
    expect(chooseModel('bytedance', with_({ gatewayKey: 'g' })).route).toBe('gateway');
  });

  it('lists only the routes that would actually work', () => {
    // `xaicli` is stripped throughout: it authenticates from a signed-in Grok
    // CLI rather than from any key, so whether it appears depends on the machine
    // the test runs on, and asserting on it would make this pass or fail by
    // accident of who is logged in.
    const keyed = (c: Config) => availableRoutes(c).map((r) => r.vendor).filter((v) => v !== 'xaicli');
    expect(keyed(base)).toEqual([]);
    expect(keyed(with_({ googleKey: 'k' }))).toEqual(['google', 'googlelite', 'googlepro']);
    expect(keyed(with_({ gatewayKey: 'g' }))).toEqual([
      'openai',
      'google',
      'googlelite',
      'googlepro',
      'bytedance',
      'recraft',
      'recraft-utility',
      'recraft-utility-pro',
      'recraft-v4.1',
      'muse',
      'xai',
      'quiver',
    ]);
    // xaicli is absent from every list above: it authenticates from a signed-in
    // CLI rather than from any key, so no key configuration can enable it.
  });
});

describe('which vendors can return several images in one call', () => {
  it('records that Gemini cannot', () => {
    // Established by calling it: `n: 2` is refused outright. Recorded here so a
    // request for several images fans out instead of failing.
    expect(supportsBatch('google')).toBe(false);
    expect(supportsBatch('openai')).toBe(true);
    expect(supportsBatch('bytedance')).toBe(true);
  });
});

describe('the hourly ceiling', () => {
  it('counts images, not calls', () => {
    const l = new RateLimiter(5);
    l.check(3);
    expect(l.remaining()).toBe(2);
    // Asking for 3 more when 2 remain is refused BEFORE anything is billed.
    expect(() => { l.check(3); }).toThrow(/Rate limit/);
    expect(l.remaining()).toBe(2);
  });

  it('is unlimited at zero', () => {
    const l = new RateLimiter(0);
    l.check(1000);
    expect(l.remaining()).toBe(Number.POSITIVE_INFINITY);
  });

  it('frees capacity once the hour rolls past', () => {
    const l = new RateLimiter(2);
    const t0 = 1_000_000;
    l.check(2, t0);
    expect(() => { l.check(1, t0 + 60_000); }).toThrow();
    l.check(1, t0 + 3_600_001);
  });
});

describe('configuration', () => {
  it('reads GOOGLE_API_KEY as an alias, and prefers GEMINI_API_KEY', () => {
    expect(loadConfig({ GOOGLE_API_KEY: 'alias' }).googleKey).toBe('alias');
    expect(loadConfig({ GEMINI_API_KEY: 'primary', GOOGLE_API_KEY: 'alias' }).googleKey).toBe('primary');
  });

  it('falls through an empty key, which is what a committed .env leaves behind', () => {
    expect(loadConfig({ GEMINI_API_KEY: '', GOOGLE_API_KEY: 'alias' }).googleKey).toBe('alias');
  });

  it('refuses a boolean it cannot read instead of guessing false', () => {
    // A typo that silently flips a setting always flips it the permissive way.
    expect(() => loadConfig({ IMAGE_GEN_PREFER_GATEWAY: 'yep' })).toThrow(/expected one of/);
    expect(loadConfig({ IMAGE_GEN_PREFER_GATEWAY: 'yes' }).preferGateway).toBe(true);
  });

  it('defaults to openai with a real hourly cap', () => {
    const c = loadConfig({});
    expect(c.defaultProvider).toBe('openai');
    expect(c.maxPerHour).toBe(60);
  });
});
