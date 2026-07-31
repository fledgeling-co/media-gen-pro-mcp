import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrokCliError, generateViaGrokCli, readGrokCliSession } from '../src/grok-cli.js';

let dir: string;
let originalHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grokcli-'));
  originalHome = process.env['HOME'];
  process.env['HOME'] = dir;
});
afterEach(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  rmSync(dir, { recursive: true, force: true });
});

const writeAuth = (contents: unknown): void => {
  const d = join(dir, '.grok');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'auth.json'), JSON.stringify(contents));
};

const entry = (over: Record<string, unknown> = {}) => ({
  'https://auth.x.ai::abc-123': {
    key: 'x'.repeat(40),
    auth_mode: 'oidc',
    email: 'someone@example.com',
    refresh_token: 'r'.repeat(80),
    expires_at: '2099-01-01T00:00:00.000000Z',
    ...over,
  },
});

describe('reading the Grok CLI session', () => {
  it('finds the token under a key it cannot know in advance', () => {
    // The key is `<issuer>::<client-id>`, so it cannot be hardcoded.
    writeAuth(entry());
    expect(readGrokCliSession()?.token).toBe('x'.repeat(40));
  });

  it('reports an expired token without refusing it', () => {
    // Observed on a real machine: expires_at 4.5 hours past and the token still
    // authenticated. Refusing on the timestamp alone would have blocked a
    // working session.
    writeAuth(entry({ expires_at: '2020-01-01T00:00:00.000000Z' }));
    const s = readGrokCliSession();
    expect(s?.expired).toBe(true);
    expect(s?.token).toBe('x'.repeat(40));
  });

  it('treats a missing file, missing CLI or signed-out state as simply absent', () => {
    expect(readGrokCliSession()).toBeUndefined();
    writeAuth({});
    expect(readGrokCliSession()).toBeUndefined();
  });

  it('survives a file that is not what it expects', () => {
    const d = join(dir, '.grok');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'auth.json'), '{not json');
    expect(readGrokCliSession()).toBeUndefined();
  });

  it('skips an entry with no usable key rather than throwing', () => {
    writeAuth({ 'https://auth.x.ai::a': { auth_mode: 'oidc' }, 'https://auth.x.ai::b': entry()['https://auth.x.ai::abc-123'] });
    expect(readGrokCliSession()?.token).toBe('x'.repeat(40));
  });
});

describe('calling Imagine on the CLI session', () => {
  const ok = (body: unknown, status = 200): typeof fetch =>
    () => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('returns the decoded image', async () => {
    const b64 = Buffer.from('hello').toString('base64');
    const r = await generateViaGrokCli({
      token: 't', prompt: 'p', timeoutMs: 5000, fetchImpl: ok({ data: [{ b64_json: b64 }] }),
    });
    expect(Buffer.from(r.uint8Array).toString()).toBe('hello');
  });

  it('names the fix when the session is rejected, because it is a command not a prompt change', async () => {
    await expect(
      generateViaGrokCli({ token: 't', prompt: 'p', timeoutMs: 5000, fetchImpl: ok({}, 401) }),
    ).rejects.toThrow(/sign in again/);
  });

  it('refuses a response it does not recognise rather than returning empty bytes', async () => {
    await expect(
      generateViaGrokCli({ token: 't', prompt: 'p', timeoutMs: 5000, fetchImpl: ok({ data: [] }) }),
    ).rejects.toThrow(GrokCliError);
  });
});
