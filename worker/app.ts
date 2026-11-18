import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import {
  MAIN_EVENT_ID,
  addAdminRequestSchema,
  addPeopleRequestSchema,
  createEventRequestSchema,
  emailSchema,
  eventCharactersRequestSchema,
  exclusionsRequestSchema,
  settingsRequestSchema,
  updatePersonRequestSchema,
} from '../shared/schema';
import {
  LOGIN_COOKIE,
  LOGIN_SECONDS,
  SESSION_COOKIE,
  SESSION_SECONDS,
  addAdmin,
  isAdmin,
  parseLoginState,
  pkceChallenge,
  removeAdmin,
  safeReturnPath,
  sessionKey,
  type AuthRepository,
  type LoginState,
  type StoredSession,
} from './auth';
import {
  addCharacter,
  characterIds,
  parseCharacterForm,
  removeCharacter,
  renameCharacter,
  toCharacterList,
  type CharacterImage,
  type StoredCharacter,
} from './characters';
import {
  addPeople,
  allTokens,
  clearDraw,
  createEvent,
  detachCharacter,
  drawNames,
  findByToken,
  hasCharacter,
  lookupReveal,
  randomToken,
  recordVisit,
  removePerson,
  setCharacters,
  setExclusions,
  setReveal,
  toAdminState,
  toSummary,
  updateSettings,
  type EventRecord,
  type StoredEvent,
  type VisitKind,
} from './event';
import type { IdentityProvider } from './google';
import type { MissLimiter } from './rate-limit';

export interface EventRepository {
  /** Every event, the main event first and the rest oldest first. */
  list(): Promise<EventRecord[]>;
  load(id: string): Promise<StoredEvent | null>;
  save(id: string, event: StoredEvent): Promise<void>;
  remove(id: string): Promise<void>;
}

/** The character library shared by every event. Each image is stored separately. */
export interface CharacterRepository {
  /** Every character, oldest first. */
  list(): Promise<StoredCharacter[]>;
  save(characters: StoredCharacter[]): Promise<void>;
  loadImage(id: string): Promise<CharacterImage | null>;
  saveImage(id: string, image: CharacterImage): Promise<void>;
  removeImage(id: string): Promise<void>;
}

interface AppOptions {
  repository: EventRepository;
  characters: CharacterRepository;
  auth: AuthRepository;
  identity: IdentityProvider;
  /** The admin who cannot be removed and who manages the other admins. */
  ownerEmail: string;
  limiter: MissLimiter;
  now?: () => number;
}

const CALLBACK_PATH = '/auth/google/callback';
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const COOKIE_OPTIONS: CookieOptions = {
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
  prefix: 'host',
};

/** Browsers send `Origin` with every request that changes data, so a missing one is refused. */
function sameOrigin(c: Context): boolean {
  return c.req.header('origin') === new URL(c.req.url).origin;
}

function redirectUri(c: Context): string {
  return `${new URL(c.req.url).origin}${CALLBACK_PATH}`;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

async function readForm(c: Context): Promise<unknown> {
  try {
    return await c.req.parseBody();
  } catch {
    return null;
  }
}

function imageResponse(c: Context, image: CharacterImage, cacheControl: string) {
  return c.body(image.bytes, 200, { 'Content-Type': image.type, 'Cache-Control': cacheControl });
}

function clientKey(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

export function createApp({
  repository,
  characters,
  auth,
  identity,
  ownerEmail,
  limiter,
  now = Date.now,
}: AppOptions): Hono {
  const app = new Hono();
  const owner = ownerEmail.trim().toLowerCase();

  /** Loads an event, applies a change and saves it. `change` returns an error message on failure. */
  async function changeEvent(
    c: Context,
    id: string,
    change: (event: StoredEvent) => StoredEvent | string,
  ) {
    const event = await repository.load(id);
    if (!event) return c.json({ error: 'Event not found' }, 404);
    const next = change(event);
    if (typeof next === 'string') return c.json({ error: next }, 400);
    await repository.save(id, next);
    return c.json(toAdminState(id, next));
  }

  async function eventList(c: Context) {
    return c.json({ events: (await repository.list()).map(toSummary) });
  }

  async function characterList(c: Context) {
    return c.json(toCharacterList(await characters.list()));
  }

  /** The signed-in admin's email. Checked against the admin list on every request. */
  async function signedInAdmin(c: Context): Promise<string | null> {
    const token = getCookie(c, SESSION_COOKIE, 'host');
    if (!token) return null;
    const session = await auth.loadSession(await sessionKey(token));
    if (!session || session.expiresAt <= now()) return null;
    return isAdmin(await auth.admins(), owner, session.email) ? session.email : null;
  }

  async function removeSessions(stale: (session: StoredSession) => boolean): Promise<void> {
    for (const record of await auth.listSessions()) {
      if (stale(record.session)) await auth.removeSession(record.key);
    }
  }

  async function adminList(c: Context) {
    return c.json({ owner, admins: await auth.admins() });
  }

  app.get('/auth/google/start', async (c) => {
    const login: LoginState = {
      state: randomToken(32),
      nonce: randomToken(32),
      verifier: randomToken(32),
      next: safeReturnPath(c.req.query('next')),
    };
    setCookie(c, LOGIN_COOKIE, JSON.stringify(login), { ...COOKIE_OPTIONS, maxAge: LOGIN_SECONDS });
    return c.redirect(
      identity.authorizationUrl({
        state: login.state,
        nonce: login.nonce,
        challenge: await pkceChallenge(login.verifier),
        redirectUri: redirectUri(c),
      }),
    );
  });

  app.get(CALLBACK_PATH, async (c) => {
    const login = parseLoginState(getCookie(c, LOGIN_COOKIE, 'host'));
    deleteCookie(c, LOGIN_COOKIE, COOKIE_OPTIONS);
    const code = c.req.query('code');
    if (!login || !code || c.req.query('state') !== login.state) {
      return c.redirect('/?signin=failed');
    }
    const email = await identity.verifiedEmail({
      code,
      verifier: login.verifier,
      nonce: login.nonce,
      redirectUri: redirectUri(c),
    });
    if (!email) return c.redirect('/?signin=failed');
    const admins = await auth.admins();
    if (!isAdmin(admins, owner, email)) return c.redirect('/?signin=denied');
    await removeSessions(
      (session) => session.expiresAt <= now() || !isAdmin(admins, owner, session.email),
    );
    const token = randomToken(32);
    await auth.saveSession(await sessionKey(token), {
      email,
      expiresAt: now() + SESSION_SECONDS * 1000,
    });
    setCookie(c, SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_SECONDS });
    return c.redirect(safeReturnPath(login.next));
  });

  app.post('/auth/logout', async (c) => {
    if (!sameOrigin(c)) return c.json({ error: 'Cross-site request refused' }, 403);
    const token = getCookie(c, SESSION_COOKIE, 'host');
    if (token) await auth.removeSession(await sessionKey(token));
    deleteCookie(c, SESSION_COOKIE, COOKIE_OPTIONS);
    return c.body(null, 204);
  });

  app.all('/auth/*', (c) => c.json({ error: 'Not found' }, 404));

  app.get('/api/session', async (c) => {
    const email = await signedInAdmin(c);
    return c.json({ email, owner: email !== null && email === owner });
  });

  app.use('/api/admin/*', async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && !sameOrigin(c)) {
      return c.json({ error: 'Cross-site request refused' }, 403);
    }
    if (!(await signedInAdmin(c))) return c.json({ error: 'Sign in required' }, 401);
    await next();
  });

  app.use('/api/admin/admins/*', async (c, next) => {
    if ((await signedInAdmin(c)) !== owner) {
      return c.json({ error: 'Only the owner can manage admins' }, 403);
    }
    await next();
  });

  app.get('/api/admin/admins', (c) => adminList(c));

  app.post('/api/admin/admins', async (c) => {
    const body = addAdminRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Enter a valid email address' }, 400);
    const admins = addAdmin(await auth.admins(), owner, body.data.email);
    if (typeof admins === 'string') return c.json({ error: admins }, 400);
    await auth.saveAdmins(admins);
    return adminList(c);
  });

  app.delete('/api/admin/admins/:email', async (c) => {
    const email = emailSchema.safeParse(c.req.param('email'));
    const admins = email.success ? removeAdmin(await auth.admins(), email.data) : null;
    if (!email.success || !admins) return c.json({ error: 'Admin not found' }, 404);
    await auth.saveAdmins(admins);
    await removeSessions((session) => session.email === email.data);
    return adminList(c);
  });

  app.get('/api/admin/events', (c) => eventList(c));

  app.post('/api/admin/events', async (c) => {
    const body = createEventRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Name must be 1 to 80 characters' }, 400);
    const id = randomToken(9);
    const event = createEvent(body.data.title, now());
    await repository.save(id, event);
    return c.json(toAdminState(id, event));
  });

  app.get('/api/admin/events/:eventId', async (c) => {
    const id = c.req.param('eventId');
    const event = await repository.load(id);
    if (!event) return c.json({ error: 'Event not found' }, 404);
    return c.json(toAdminState(id, event));
  });

  app.delete('/api/admin/events/:eventId', async (c) => {
    const id = c.req.param('eventId');
    if (id === MAIN_EVENT_ID) return c.json({ error: 'The original event cannot be deleted' }, 400);
    if (!(await repository.load(id))) return c.json({ error: 'Event not found' }, 404);
    await repository.remove(id);
    return eventList(c);
  });

  app.put('/api/admin/events/:eventId/settings', async (c) => {
    const body = settingsRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Invalid settings' }, 400);
    return changeEvent(c, c.req.param('eventId'), (event) => updateSettings(event, body.data));
  });

  app.post('/api/admin/events/:eventId/people', async (c) => {
    const body = addPeopleRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Names must be 1 to 40 characters' }, 400);
    const taken = allTokens(await repository.list());
    return changeEvent(c, c.req.param('eventId'), (event) =>
      addPeople(event, body.data.names, taken),
    );
  });

  app.patch('/api/admin/events/:eventId/people/:id', async (c) => {
    const body = updatePersonRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Invalid reveal' }, 400);
    return changeEvent(
      c,
      c.req.param('eventId'),
      (event) => setReveal(event, c.req.param('id'), body.data.reveal) ?? 'Person not found',
    );
  });

  app.delete('/api/admin/events/:eventId/people/:id', async (c) =>
    changeEvent(
      c,
      c.req.param('eventId'),
      (event) => removePerson(event, c.req.param('id')) ?? 'Person not found',
    ),
  );

  app.put('/api/admin/events/:eventId/exclusions', async (c) => {
    const body = exclusionsRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Invalid exclusions' }, 400);
    return changeEvent(
      c,
      c.req.param('eventId'),
      (event) => setExclusions(event, body.data.exclusions) ?? 'Invalid exclusions',
    );
  });

  app.post('/api/admin/events/:eventId/draw', async (c) =>
    changeEvent(c, c.req.param('eventId'), (event) => {
      const result = drawNames(event);
      if (result.status === 'too_few') return 'Add at least two people first';
      if (result.status === 'impossible') {
        return 'No draw fits these exclusions. Remove some and try again.';
      }
      return result.event;
    }),
  );

  app.delete('/api/admin/events/:eventId/draw', async (c) =>
    changeEvent(c, c.req.param('eventId'), clearDraw),
  );

  app.put('/api/admin/events/:eventId/characters', async (c) => {
    const body = eventCharactersRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Invalid characters' }, 400);
    const libraryIds = characterIds(await characters.list());
    return changeEvent(
      c,
      c.req.param('eventId'),
      (event) =>
        setCharacters(event, body.data.characterIds, libraryIds) ?? 'Unknown or repeated character',
    );
  });

  app.get('/api/admin/characters', (c) => characterList(c));

  app.post('/api/admin/characters', async (c) => {
    const form = parseCharacterForm(await readForm(c), true);
    if (typeof form === 'string') return c.json({ error: form }, 400);
    if (!form.image) return c.json({ error: 'Choose an image' }, 400);
    const id = randomToken(9);
    const library = addCharacter(await characters.list(), {
      id,
      name: form.name,
      createdAt: now(),
    });
    if (typeof library === 'string') return c.json({ error: library }, 400);
    const bytes = await form.image.file.arrayBuffer();
    await characters.saveImage(id, { type: form.image.type, bytes });
    await characters.save(library);
    return characterList(c);
  });

  app.put('/api/admin/characters/:id', async (c) => {
    const id = c.req.param('id');
    const form = parseCharacterForm(await readForm(c), false);
    if (typeof form === 'string') return c.json({ error: form }, 400);
    const library = renameCharacter(await characters.list(), id, form.name);
    if (!library) return c.json({ error: 'Character not found' }, 404);
    if (form.image) {
      const bytes = await form.image.file.arrayBuffer();
      await characters.saveImage(id, { type: form.image.type, bytes });
    }
    await characters.save(library);
    return characterList(c);
  });

  app.delete('/api/admin/characters/:id', async (c) => {
    const id = c.req.param('id');
    const library = removeCharacter(await characters.list(), id);
    if (!library) return c.json({ error: 'Character not found' }, 404);
    for (const record of await repository.list()) {
      if (hasCharacter(record.event, id)) {
        await repository.save(record.id, detachCharacter(record.event, id));
      }
    }
    await characters.save(library);
    await characters.removeImage(id);
    return characterList(c);
  });

  app.get('/api/admin/characters/:id/image', async (c) => {
    const image = await characters.loadImage(c.req.param('id'));
    if (!image) return c.json({ error: 'Character not found' }, 404);
    return imageResponse(c, image, 'no-store');
  });

  /** Finds the event holding a link, counting misses against the client. */
  async function findLink(c: Context, token: string): Promise<EventRecord | 'blocked' | null> {
    const client = clientKey(c);
    if (limiter.isBlocked(client, now())) return 'blocked';
    const record = findByToken(await repository.list(), token);
    if (!record) limiter.recordMiss(client, now());
    return record;
  }

  app.get('/api/reveal/:token', async (c) => {
    const token = c.req.param('token');
    const record = await findLink(c, token);
    if (record === 'blocked') return c.json({ error: 'Too many attempts' }, 429);
    if (!record) return c.json({ error: 'Link not found' }, 404);
    const result = lookupReveal(record.event, token, characterIds(await characters.list()));
    if (result.status !== 'ok') return c.json({ error: 'Names not drawn yet' }, 409);
    return c.json(result.reveal);
  });

  app.get('/api/reveal/:token/cast/:characterId', async (c) => {
    const characterId = c.req.param('characterId');
    const record = await findLink(c, c.req.param('token'));
    if (record === 'blocked') return c.json({ error: 'Too many attempts' }, 429);
    const image =
      record && hasCharacter(record.event, characterId)
        ? await characters.loadImage(characterId)
        : null;
    if (!image) return c.json({ error: 'Not found' }, 404);
    return imageResponse(c, image, 'private, max-age=300');
  });

  async function logVisit(c: Context, token: string, kind: VisitKind) {
    const record = await findLink(c, token);
    if (record === 'blocked') return c.json({ error: 'Too many attempts' }, 429);
    const event = record && recordVisit(record.event, token, kind, now());
    if (!record || !event) return c.json({ error: 'Link not found' }, 404);
    await repository.save(record.id, event);
    return c.body(null, 204);
  }

  app.post('/api/reveal/:token/viewed', (c) => logVisit(c, c.req.param('token'), 'view'));
  app.post('/api/reveal/:token/opened', (c) => logVisit(c, c.req.param('token'), 'completion'));

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
