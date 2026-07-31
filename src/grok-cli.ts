/**
 * Using a coding CLI's own subscription instead of a metered key.
 *
 * The mechanism, found by reading pi-grok-cli's `src/imagine/generate.ts` and
 * confirmed by calling it: xAI's CLI signs in with OIDC and leaves the access
 * token in `~/.grok/auth.json`. That token authenticates the ordinary
 * `api.x.ai/v1/images/generations` endpoint, so an image generated this way is
 * billed against an X Premium or SuperGrok subscription rather than against API
 * credit or the gateway.
 *
 * **Read-only, and never written back.** This file opens a credential the user
 * already has, for the request the user asked for, and does nothing else with
 * it. It does not refresh the token, because refreshing writes a new credential
 * into a file another program owns, and two writers on one auth file is how a
 * working login gets broken by a tool that was only meant to read it.
 *
 * A stale `expires_at` is therefore not treated as fatal: it was 4.5 hours past
 * on the machine this was built on and the token still worked. The expiry is
 * reported, the call is attempted, and a 401 is reported as "sign in again"
 * rather than being second-guessed here.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/** The client version pi-grok-cli sends. Not secret; the endpoint expects one. */
const GROK_CLI_VERSION = '0.2.91';

/** The model xAI's own CLI asks for. */
export const GROK_CLI_MODEL = 'grok-imagine-image-quality';

export function grokAuthPath(): string {
  return join(process.env['HOME'] || homedir(), '.grok', 'auth.json');
}

/**
 * Only the fields needed to make a call.
 *
 * Deliberately narrow: the file also holds an email, a name, a profile image id
 * and a refresh token, none of which this server has any business reading into
 * memory. `passthrough` is NOT used, so nothing else comes along.
 */
const EntrySchema = z.object({
  key: z.string().min(20),
  expires_at: z.string().optional(),
});

export interface GrokCliSession {
  readonly token: string;
  /** Epoch ms, when the file states one. */
  readonly expiresAt?: number;
  readonly expired: boolean;
}

/**
 * The signed-in session, if there is one.
 *
 * Returns undefined rather than throwing for every absence, because "the CLI is
 * not installed" and "the CLI is installed but signed out" are both ordinary
 * states for a machine that simply does not use it.
 */
export function readGrokCliSession(now: number = Date.now()): GrokCliSession | undefined {
  let raw: string;
  try {
    raw = readFileSync(grokAuthPath(), 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  // Keys are `<issuer>::<client-id>`, so the name cannot be hardcoded. The first
  // entry that parses is used; a machine with several is signed in to several,
  // and any of them authenticates the same endpoint.
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const entry = EntrySchema.safeParse(value);
    if (!entry.success) continue;
    const ms = entry.data.expires_at ? Date.parse(entry.data.expires_at) : NaN;
    return {
      token: entry.data.key,
      ...(Number.isNaN(ms) ? {} : { expiresAt: ms }),
      expired: !Number.isNaN(ms) && ms < now,
    };
  }
  return undefined;
}

export class GrokCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrokCliError';
  }
}

/** One image from Imagine, on the CLI's subscription. */
export async function generateViaGrokCli(opts: {
  readonly token: string;
  readonly prompt: string;
  readonly aspectRatio?: string | undefined;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ uint8Array: Uint8Array; mediaType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs);

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-grok-client-version': GROK_CLI_VERSION,
      },
      body: JSON.stringify({
        model: GROK_CLI_MODEL,
        prompt: opts.prompt,
        n: 1,
        aspect_ratio: opts.aspectRatio ?? 'auto',
        resolution: '1k',
        response_format: 'b64_json',
      }),
      signal: controller.signal,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new GrokCliError(`Imagine did not answer within ${String(Math.round(opts.timeoutMs / 1000))}s.`);
    }
    throw new GrokCliError(`Imagine request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    // The one case worth naming precisely, because the fix is a command rather
    // than a change to the request.
    throw new GrokCliError(
      `Imagine rejected the Grok CLI session (HTTP ${String(res.status)}). Run \`grok\` and sign in again, or drop \`style: "grok-cli"\` to use the gateway instead.`,
    );
  }
  if (!res.ok) {
    throw new GrokCliError(`Imagine returned HTTP ${String(res.status)}: ${(await res.text()).slice(0, 300)}`);
  }

  const body: unknown = await res.json();
  const shape = z.object({ data: z.array(z.object({ b64_json: z.string() })).min(1) }).safeParse(body);
  if (!shape.success) throw new GrokCliError('Imagine returned a response this server does not recognise.');
  const first = shape.data.data[0];
  if (!first) throw new GrokCliError('Imagine returned no image.');

  return {
    uint8Array: Uint8Array.from(Buffer.from(first.b64_json, 'base64')),
    // Declared rather than trusted: the endpoint states no format, and the
    // caller sniffs the bytes anyway.
    mediaType: 'application/octet-stream',
  };
}
