import { describe, expect, it } from 'vitest';
import { adviseForVideo } from '../src/advice.js';
import { KNOWN_VIDEO_STYLES, chooseVideoModel, resolveVideoVendor } from '../src/video.js';
import type { Config } from '../src/config.js';

const base: Config = {
  openaiKey: '', googleKey: '', gatewayKey: '', outputDir: '',
  defaultProvider: 'openai', preferGateway: false,
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
    expect(resolveVideoVendor('grok')).toBe('grok');
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
