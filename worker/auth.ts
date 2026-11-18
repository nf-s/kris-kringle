import { z } from 'zod';
import { MAX_ADMINS } from '../shared/schema';
import { toBase64Url } from './event';

/** Sent with the `__Host-` prefix, which ties each cookie to this exact origin over HTTPS. */
export const SESSION_COOKIE = 'kk-session';
export const LOGIN_COOKIE = 'kk-login';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_SECONDS = 10 * 60;

/** The Worker's sign-in settings. A missing one leaves sign-in closed rather than failing requests. */
export const authSettingsSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  ADMIN_EMAIL: z.string().default(''),
});

export const storedSessionSchema = z.object({
  email: z.string(),
  expiresAt: z.number(),
});
export type StoredSession = z.infer<typeof storedSessionSchema>;

export const storedAdminsSchema = z.array(z.string());

export interface SessionRecord {
  key: string;
  session: StoredSession;
}

export interface AuthRepository {
  /** Admins the owner has added, oldest first. The owner is not in this list. */
  admins(): Promise<string[]>;
  saveAdmins(emails: string[]): Promise<void>;
  /** Sessions are stored under `sessionKey` of their cookie, never the cookie itself. */
  loadSession(key: string): Promise<StoredSession | null>;
  saveSession(key: string, session: StoredSession): Promise<void>;
  removeSession(key: string): Promise<void>;
  listSessions(): Promise<SessionRecord[]>;
}

/** What a browser holds between leaving for Google and coming back. */
const loginStateSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  next: z.string(),
});
export type LoginState = z.infer<typeof loginStateSchema>;

export function parseLoginState(cookie: string | undefined): LoginState | null {
  if (cookie === undefined) return null;
  try {
    const parsed = loginStateSchema.safeParse(JSON.parse(cookie));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function sessionKey(token: string): Promise<string> {
  return toBase64Url(await sha256(token));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(verifier));
}

/** Where to go after signing in. Anything but a plain path on this site becomes `/`. */
export function safeReturnPath(value: string | undefined): string {
  if (value === undefined || value.length > 200) return '/';
  if (!/^\/[\x21-\x7e]*$/.test(value)) return '/';
  if (value.startsWith('//') || value.includes('\\') || value.startsWith('/auth/')) return '/';
  return value;
}

export function isAdmin(admins: readonly string[], owner: string, email: string): boolean {
  return (owner.length > 0 && email === owner) || admins.includes(email);
}

/** Returns the new list, or an error message. */
export function addAdmin(
  admins: readonly string[],
  owner: string,
  email: string,
): string[] | string {
  if (isAdmin(admins, owner, email)) return 'Already an admin';
  if (admins.length >= MAX_ADMINS) return `At most ${MAX_ADMINS} admins can be added`;
  return [...admins, email];
}

/** Returns the new list, or null if the email is not an added admin. */
export function removeAdmin(admins: readonly string[], email: string): string[] | null {
  if (!admins.includes(email)) return null;
  return admins.filter((admin) => admin !== email);
}
