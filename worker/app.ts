import { Hono, type Context } from 'hono';
import {
  MAIN_EVENT_ID,
  addPeopleRequestSchema,
  createEventRequestSchema,
  exclusionsRequestSchema,
  settingsRequestSchema,
  updatePersonRequestSchema,
} from '../shared/schema';
import {
  addPeople,
  allTokens,
  clearDraw,
  createEvent,
  drawNames,
  findByToken,
  lookupReveal,
  randomToken,
  recordVisit,
  removePerson,
  setExclusions,
  setReveal,
  toAdminState,
  toSummary,
  updateSettings,
  type EventRecord,
  type StoredEvent,
  type VisitKind,
} from './event';
import type { MissLimiter } from './rate-limit';

export interface EventRepository {
  /** Every event, the main event first and the rest oldest first. */
  list(): Promise<EventRecord[]>;
  load(id: string): Promise<StoredEvent | null>;
  save(id: string, event: StoredEvent): Promise<void>;
  remove(id: string): Promise<void>;
}

interface AppOptions {
  repository: EventRepository;
  adminPassword: string;
  limiter: MissLimiter;
  now?: () => number;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares digests rather than the raw strings so timing does not leak the password. */
async function passwordMatches(supplied: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function clientKey(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

export function createApp({
  repository,
  adminPassword,
  limiter,
  now = Date.now,
}: AppOptions): Hono {
  const app = new Hono();

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

  app.use('/api/admin/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!(await passwordMatches(supplied, adminPassword))) {
      return c.json({ error: 'Wrong password' }, 401);
    }
    await next();
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
    const result = lookupReveal(record.event, token);
    if (result.status !== 'ok') return c.json({ error: 'Names not drawn yet' }, 409);
    return c.json(result.reveal);
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
