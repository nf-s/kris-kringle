import { describe, expect, it } from 'vitest';
import { toBase64Url } from './event';
import { createGoogleIdentity, type HttpFetch } from './google';

const CLIENT_ID = 'client-id.apps.googleusercontent.com';
const NOW = 1_700_000_000_000;
const EXCHANGE = {
  code: 'code',
  verifier: 'verifier',
  nonce: 'nonce',
  redirectUri: 'https://kk.example/auth/google/callback',
};
const RSA = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

function encode(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function generateKey(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  if (!('privateKey' in pair)) throw new Error('Expected a key pair');
  return pair;
}

const googleKey = await generateKey();
const otherKey = await generateKey();
const publicJwk = await crypto.subtle.exportKey('jwk', googleKey.publicKey);

async function idToken(claims: Record<string, unknown>, key = googleKey): Promise<string> {
  const signed = `${encode({ alg: 'RS256', kid: 'key-1' })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${toBase64Url(new Uint8Array(signature))}`;
}

function claims(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: NOW / 1000 + 3600,
    nonce: EXCHANGE.nonce,
    email: 'Ada@Example.com',
    email_verified: true,
    ...changes,
  };
}

/** Answers like Google's token and key endpoints, recording what was asked. */
function google(token: string) {
  const requests: { url: string; body: string }[] = [];
  const fetcher: HttpFetch = async (url, init) => {
    requests.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: token });
    return Response.json({ keys: [{ ...publicJwk, kid: 'key-1' }] });
  };
  const identity = createGoogleIdentity(
    { clientId: CLIENT_ID, clientSecret: 'secret' },
    fetcher,
    () => NOW,
  );
  return { identity, requests };
}

async function emailFor(token: string): Promise<string | null> {
  return google(token).identity.verifiedEmail(EXCHANGE);
}

describe('Google sign-in', () => {
  it('builds an authorization URL with PKCE', () => {
    const { identity } = google('');
    const url = new URL(
      identity.authorizationUrl({
        state: 'state',
        nonce: 'nonce',
        challenge: 'challenge',
        redirectUri: EXCHANGE.redirectUri,
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: EXCHANGE.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state: 'state',
      nonce: 'nonce',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code and returns the verified email in lower case', async () => {
    const { identity, requests } = google(await idToken(claims()));
    expect(await identity.verifiedEmail(EXCHANGE)).toBe('ada@example.com');
    expect(Object.fromEntries(new URLSearchParams(requests[0].body))).toEqual({
      code: 'code',
      code_verifier: 'verifier',
      client_id: CLIENT_ID,
      client_secret: 'secret',
      redirect_uri: EXCHANGE.redirectUri,
      grant_type: 'authorization_code',
    });
  });

  it('fetches the signing keys once for several sign-ins', async () => {
    const { identity, requests } = google(await idToken(claims()));
    await identity.verifiedEmail(EXCHANGE);
    await identity.verifiedEmail(EXCHANGE);
    expect(requests.filter((request) => request.url.endsWith('/certs'))).toHaveLength(1);
  });

  it('rejects a token signed by another key', async () => {
    expect(await emailFor(await idToken(claims(), otherKey))).toBeNull();
  });

  it('rejects a token whose claims were changed after signing', async () => {
    const [header, , signature] = (await idToken(claims())).split('.');
    const forged = `${header}.${encode(claims({ email: 'eve@example.com' }))}.${signature}`;
    expect(await emailFor(forged)).toBeNull();
  });

  it.each([
    ['another app', { aud: 'other.apps.googleusercontent.com' }],
    ['another issuer', { iss: 'https://accounts.example' }],
    ['another sign-in', { nonce: 'other' }],
    ['an expired token', { exp: NOW / 1000 - 3600 }],
    ['an unverified email', { email_verified: false }],
    ['a missing email', { email: undefined }],
  ])('rejects a token for %s', async (_name, changes) => {
    expect(await emailFor(await idToken(claims(changes)))).toBeNull();
  });

  it('rejects a response that is not a token', async () => {
    expect(await emailFor('not-a-token')).toBeNull();
  });

  it('rejects everything when Google refuses the code', async () => {
    const identity = createGoogleIdentity(
      { clientId: CLIENT_ID, clientSecret: 'secret' },
      async () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      () => NOW,
    );
    expect(await identity.verifiedEmail(EXCHANGE)).toBeNull();
  });

  it('rejects everything when the client is not configured', async () => {
    const identity = createGoogleIdentity({ clientId: '', clientSecret: '' }, async () =>
      Response.json({ id_token: await idToken(claims({ aud: '' })) }),
    );
    expect(await identity.verifiedEmail(EXCHANGE)).toBeNull();
  });
});
