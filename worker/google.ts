import { z } from 'zod';
import { emailSchema } from '../shared/schema';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const KEYS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const KEY_CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  /** PKCE challenge: the SHA-256 of the verifier sent with the code. */
  challenge: string;
  redirectUri: string;
}

export interface CodeExchange {
  code: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
}

export interface IdentityProvider {
  authorizationUrl(request: AuthorizationRequest): string;
  /** The verified email of the account that signed in, or null if the sign-in cannot be trusted. */
  verifiedEmail(exchange: CodeExchange): Promise<string | null>;
}

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

const tokenResponseSchema = z.object({ id_token: z.string() });
const tokenHeaderSchema = z.object({ alg: z.literal('RS256'), kid: z.string() });
const claimsSchema = z.object({
  iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  aud: z.string(),
  /** Seconds since epoch. */
  exp: z.number(),
  nonce: z.string(),
  email: emailSchema,
  email_verified: z.literal(true),
});
const keySetSchema = z.object({
  keys: z.array(
    z.object({
      kid: z.string(),
      kty: z.string(),
      n: z.string().optional(),
      e: z.string().optional(),
    }),
  ),
});
type SigningKey = z.infer<typeof keySetSchema>['keys'][number];

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJson(part: string): unknown {
  const bytes = decodeBase64Url(part);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function signatureMatches(
  key: SigningKey,
  signed: string,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  if (key.kty !== 'RSA' || key.n === undefined || key.e === undefined) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      new TextEncoder().encode(signed),
    );
  } catch {
    return false;
  }
}

/**
 * Signs people in with Google using the authorization code flow with PKCE. Create one per Worker
 * instance so Google's signing keys are fetched at most once an hour.
 */
export function createGoogleIdentity(
  config: GoogleConfig,
  fetcher: HttpFetch = fetch,
  now: () => number = Date.now,
): IdentityProvider {
  let cache: { keys: SigningKey[]; fetchedAt: number } | null = null;

  async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    try {
      const response = await fetcher(url, init);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  /** Google rotates its keys, so an unknown key id triggers one fresh fetch. */
  async function signingKey(kid: string): Promise<SigningKey | null> {
    const cached = cache;
    if (cached && now() - cached.fetchedAt < KEY_CACHE_MS) {
      const key = cached.keys.find((candidate) => candidate.kid === kid);
      if (key) return key;
    }
    const keySet = keySetSchema.safeParse(await fetchJson(KEYS_ENDPOINT));
    if (!keySet.success) return null;
    cache = { keys: keySet.data.keys, fetchedAt: now() };
    return keySet.data.keys.find((candidate) => candidate.kid === kid) ?? null;
  }

  async function emailFromIdToken(idToken: string, nonce: string): Promise<string | null> {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, claimsPart, signaturePart] = parts;
    const header = tokenHeaderSchema.safeParse(decodeJson(headerPart));
    const signature = decodeBase64Url(signaturePart);
    if (!header.success || !signature) return null;
    const key = await signingKey(header.data.kid);
    if (!key || !(await signatureMatches(key, `${headerPart}.${claimsPart}`, signature))) {
      return null;
    }
    const claims = claimsSchema.safeParse(decodeJson(claimsPart));
    if (!claims.success) return null;
    if (claims.data.aud !== config.clientId || claims.data.nonce !== nonce) return null;
    if (claims.data.exp * 1000 + CLOCK_SKEW_MS <= now()) return null;
    return claims.data.email;
  }

  return {
    authorizationUrl({ state, nonce, challenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return `${AUTHORIZATION_ENDPOINT}?${params}`;
    },

    async verifiedEmail({ code, verifier, nonce, redirectUri }) {
      if (config.clientId.length === 0 || config.clientSecret.length === 0) return null;
      const body = new URLSearchParams({
        code,
        code_verifier: verifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      const tokens = tokenResponseSchema.safeParse(
        await fetchJson(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }),
      );
      return tokens.success ? emailFromIdToken(tokens.data.id_token, nonce) : null;
    },
  };
}
