import { describe, expect, it } from 'vitest';
import { adviseForVideo } from '../src/advice.js';
import { KNOWN_VIDEO_STYLES, chooseVideoModel, resolveVideoVendor } from '../src/video.js';
import type { Config } from '../src/config.js';

const base: Config = {
  googleKey: '', gatewayKey: '', outputDir: '',
  defaultProvider: 'flare',
  allowedVendors: [], preferGateway: false,
  maxPerHour: 60, maxPerCall: 4, timeoutMs: 180_000,
  videoTimeoutMs: 600_000, videoMaxPerHour: 20,
};

describe('picking a video model', () => {
  it('defaults to seedance when no style is named', () => {
    expect(resolveVideoVendor(undefined)).toBe('seedance');
    expect(resolveVideoVendor('  ')).toBe('seedance');
  });

  it('accepts the names for each vendor', () => {
    expect(resolveVideoVendor('minimax')).toBe('minimax');
    expect(resolveVideoVendor('minimax-max')).toBe('minimax-max');
    expect(resolveVideoVendor('wan')).toBe('wan');
    expect(resolveVideoVendor('wan-prime')).toBe('wan-prime');
    expect(resolveVideoVendor('flux')).toBe('flux');
    expect(resolveVideoVendor('grok')).toBe('grok');
    expect(resolveVideoVendor('gemini')).toBe('gemini');
    expect(resolveVideoVendor('veo')).toBe('veo');
    expect(resolveVideoVendor('seedance-mini')).toBe('seedance-mini');
    expect(resolveVideoVendor('grok-cli')).toBe('grokcli');
    expect(resolveVideoVendor('midjourney')).toBeUndefined();
  });

  it('advertises every accepted spelling', () => {
    expect(KNOWN_VIDEO_STYLES).toContain('grok-cli');
  });

  it('says the gateway key is the requirement, and names the one exception', () => {
    expect(() => chooseVideoModel('minimax', base)).toThrow(/AI_GATEWAY_API_KEY/);
    expect(() => chooseVideoModel('minimax', base)).toThrow(/grok-cli/);
    expect(chooseVideoModel('minimax', { ...base, gatewayKey: 'g' }).modelId).toBe('minimax/minimax-h3');
  });

  it('sends the current model id for each vendor', () => {
    const g = { ...base, gatewayKey: 'g' };
    expect(chooseVideoModel('seedance', g).modelId).toBe('bytedance/seedance-2.0');
    expect(chooseVideoModel('seedance-mini', g).modelId).toBe('bytedance/seedance-2.0-mini');
    expect(chooseVideoModel('minimax-max', g).modelId).toBe('minimax/minimax-h3-max');
    expect(chooseVideoModel('wan', g).modelId).toBe('alibaba/wan-v3.0-video');
    expect(chooseVideoModel('wan-prime', g).modelId).toBe('alibaba/wan-v3.0-video-prime');
    expect(chooseVideoModel('flux', g).modelId).toBe('bfl/flux-3-video');
    // xAI moved namespace: `xai/...` 404s, `spacexai/...` is the live id.
    expect(chooseVideoModel('grok', g).modelId).toBe('spacexai/grok-imagine-video-1.5');
    expect(chooseVideoModel('veo', g).modelId).toBe('google/veo-3.1-lite-generate-001');
  });

  it('carries the duration set for a model that only accepts certain lengths', () => {
    // Veo refuses anything outside [4, 6, 8] with "Unsupported output video
    // duration", so the choice has to carry the set for the caller's 5 to be
    // snapped rather than sent and rejected. Measured 4 September 2026.
    const g = { ...base, gatewayKey: 'g' };
    expect(chooseVideoModel('veo', g).supportedDurations).toEqual([4, 6, 8]);
    // Everything else takes the duration as given.
    expect(chooseVideoModel('minimax', g).supportedDurations).toBeUndefined();
  });

  it('reaches Gemini Omni through the LANGUAGE route, not the video api', () => {
    expect(chooseVideoModel('gemini', { ...base, gatewayKey: 'g' }).viaLanguage).toBe(true);
    expect(chooseVideoModel('veo', { ...base, gatewayKey: 'g' }).viaLanguage).toBe(false);
  });
});

describe('advice for a video prompt', () => {
  it('catches a prompt with nothing moving in it, which is the common failure', () => {
    // A video model given a static noun phrase invents the motion and the
    // camera, and invents both badly.
    expect(adviseForVideo('a chrome kettle on a table', true)).toMatch(/names no motion/);
  });

  it('catches two actions in sequence, which models teleport between', () => {
    expect(adviseForVideo('she turns to the window, then walks away', true)).toMatch(/more than one action/);
  });

  it('pushes toward a source image when there is none', () => {
    expect(adviseForVideo('the camera slowly pushes in', false)).toMatch(/sourceImage/);
  });

  it('stays quiet on a prompt that already names one motion and has a frame', () => {
    expect(adviseForVideo('the camera slowly pushes in', true)).toBeUndefined();
  });
});
