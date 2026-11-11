import { Hono, type Context } from 'hono';
import {
  addPeopleRequestSchema,
  settingsRequestSchema,
  updatePersonRequestSchema,
} from '../shared/schema';
import {
  addPeople,
  clearDraw,
  drawNames,
  lookupReveal,
  markOpened,
  removePerson,
  setReveal,
  toAdminState,
  updateSettings,
  type StoredEvent,
} from './event';

export interface EventRepository {
  load(): Promise<StoredEvent>;
  save(event: StoredEvent): Promise<void>;
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

export function createApp(repository: EventRepository, adminPassword: string): Hono {
  const app = new Hono();

  async function saveAndRespond(c: Context, event: StoredEvent | null, failure: string) {
    if (!event) return c.json({ error: failure }, 400);
    await repository.save(event);
    return c.json(toAdminState(event));
  }

  app.use('/api/admin/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!(await passwordMatches(supplied, adminPassword))) {
      return c.json({ error: 'Wrong password' }, 401);
    }
    await next();
  });

  app.get('/api/admin/state', async (c) => c.json(toAdminState(await repository.load())));

  app.put('/api/admin/settings', async (c) => {
    const body = settingsRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Invalid settings' }, 400);
    return saveAndRespond(c, updateSettings(await repository.load(), body.data), '');
  });

  app.post('/api/admin/people', async (c) => {
    const body = addPeopleRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Names must be 1 to 40 characters' }, 400);
    return saveAndRespond(c, addPeople(await repository.load(), body.data.names), '');
  });

  app.patch('/api/admin/people/:id', async (c) => {
    const body = updatePersonRequestSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: 'Invalid reveal' }, 400);
    const event = setReveal(await repository.load(), c.req.param('id'), body.data.reveal);
    return saveAndRespond(c, event, 'Person not found');
  });

  app.delete('/api/admin/people/:id', async (c) => {
    const event = removePerson(await repository.load(), c.req.param('id'));
    return saveAndRespond(c, event, 'Person not found');
  });

  app.post('/api/admin/draw', async (c) =>
    saveAndRespond(c, drawNames(await repository.load()), 'Add at least two people first'),
  );

  app.delete('/api/admin/draw', async (c) =>
    saveAndRespond(c, clearDraw(await repository.load()), ''),
  );

  app.get('/api/reveal/:token', async (c) => {
    const result = lookupReveal(await repository.load(), c.req.param('token'));
    if (result.status === 'not_found') return c.json({ error: 'Link not found' }, 404);
    if (result.status === 'not_drawn') return c.json({ error: 'Names not drawn yet' }, 409);
    return c.json(result.reveal);
  });

  app.post('/api/reveal/:token/opened', async (c) => {
    const event = markOpened(await repository.load(), c.req.param('token'));
    if (!event) return c.json({ error: 'Link not found' }, 404);
    await repository.save(event);
    return c.body(null, 204);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
