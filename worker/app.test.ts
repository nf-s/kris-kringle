import { describe, expect, it } from 'vitest';
import { MAIN_EVENT_ID, adminStateSchema, eventListSchema } from '../shared/schema';
import { createApp, type EventRepository } from './app';
import { createEmptyEvent, storedEventSchema, type EventRecord, type StoredEvent } from './event';
import { MissLimiter } from './rate-limit';

const PASSWORD = 'test-password';

/** A stored event shaped like the one saved before multiple events existed. */
const LEGACY_EVENT = {
  title: 'Family',
  note: '$50',
  people: [
    {
      id: 'p1',
      name: 'Ada',
      token: 'legacyTokenAda0000000AA',
      reveal: 'egg',
      opened: true,
      receiverId: 'p2',
    },
    {
      id: 'p2',
      name: 'Ben',
      token: 'legacyTokenBen0000000BB',
      reveal: 'jack',
      opened: false,
      receiverId: 'p1',
    },
  ],
};

function memoryRepository(initial: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const parse = (value: unknown): StoredEvent => storedEventSchema.parse(value);
  const repository: EventRepository = {
    async list() {
      const records: EventRecord[] = [];
      for (const [id, value] of store) records.push({ id, event: parse(value) });
      if (!store.has(MAIN_EVENT_ID))
        records.unshift({ id: MAIN_EVENT_ID, event: createEmptyEvent() });
      return records;
    },
    async load(id) {
      const value = store.get(id);
      if (value === undefined) return id === MAIN_EVENT_ID ? createEmptyEvent() : null;
      return parse(value);
    },
    async save(id, event) {
      store.set(id, structuredClone(event));
    },
    async remove(id) {
      store.delete(id);
    },
  };
  return { store, repository };
}

function setup(initial: Record<string, unknown> = { [MAIN_EVENT_ID]: LEGACY_EVENT }) {
  const { store, repository } = memoryRepository(structuredClone(initial));
  const app = createApp({
    repository,
    adminPassword: PASSWORD,
    limiter: new MissLimiter(3, 60_000),
    now: () => 1_000,
  });
  async function call(method: string, path: string, body?: unknown, headers: HeadersInit = {}) {
    const init: RequestInit = {
      method,
      headers: { authorization: `Bearer ${PASSWORD}`, ...headers },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { ...init.headers, 'content-type': 'application/json' };
    }
    return app.request(path, init);
  }
  return { store, call };
}

describe('events API', () => {
  it('reading leaves the original event untouched and its links working', async () => {
    const { store, call } = setup();
    const list = eventListSchema.parse(await (await call('GET', '/api/admin/events')).json());
    expect(list.events).toEqual([
      { id: MAIN_EVENT_ID, title: 'Family', peopleCount: 2, drawn: true },
    ]);
    await call('GET', `/api/admin/events/${MAIN_EVENT_ID}`);
    expect(store.get(MAIN_EVENT_ID)).toEqual(LEGACY_EVENT);

    const reveal = await call('GET', '/api/reveal/legacyTokenAda0000000AA');
    expect(await reveal.json()).toMatchObject({ giverName: 'Ada', receiverName: 'Ben' });
    expect(store.get(MAIN_EVENT_ID)).toEqual(LEGACY_EVENT);
  });

  it('creates separate events whose links resolve to the right event', async () => {
    const { call } = setup();
    const created = adminStateSchema.parse(
      await (await call('POST', '/api/admin/events', { title: 'Work' })).json(),
    );
    const path = `/api/admin/events/${created.id}`;
    await call('POST', `${path}/people`, { names: ['Cleo', 'Dev', 'Esme'] });
    const state = adminStateSchema.parse(await (await call('POST', `${path}/draw`)).json());
    expect(state.drawn).toBe(true);

    const cleo = state.people[0];
    expect(cleo.token).toMatch(/-cleo$/);
    const reveal = await (await call('GET', `/api/reveal/${cleo.token}`)).json();
    expect(reveal).toMatchObject({ title: 'Work', giverName: 'Cleo' });

    const list = eventListSchema.parse(await (await call('GET', '/api/admin/events')).json());
    expect(list.events.map((event) => event.title)).toEqual(['Family', 'Work']);
  });

  it('logs views and reveals against the right person', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/reveal/legacyTokenBen0000000BB/viewed')).status).toBe(204);
    expect((await call('POST', '/api/reveal/legacyTokenBen0000000BB/opened')).status).toBe(204);
    const state = adminStateSchema.parse(
      await (await call('GET', `/api/admin/events/${MAIN_EVENT_ID}`)).json(),
    );
    expect(state.people[1]).toMatchObject({ opened: true, views: [1_000], completions: [1_000] });
  });

  it('will not delete the original event', async () => {
    const { call } = setup();
    expect((await call('DELETE', `/api/admin/events/${MAIN_EVENT_ID}`)).status).toBe(400);
  });

  it('saves exclusions and reports an impossible draw', async () => {
    const { call } = setup({});
    const path = `/api/admin/events/${MAIN_EVENT_ID}`;
    const added = adminStateSchema.parse(
      await (await call('POST', `${path}/people`, { names: ['Ada', 'Ben', 'Cleo'] })).json(),
    );
    const [ada, ben, cleo] = added.people;
    const saved = await call('PUT', `${path}/exclusions`, {
      exclusions: { [ada.id]: [ben.id, cleo.id] },
    });
    expect(adminStateSchema.parse(await saved.json()).people[0].exclusions).toEqual([
      ben.id,
      cleo.id,
    ]);
    const draw = await call('POST', `${path}/draw`);
    expect(draw.status).toBe(400);
  });

  it('blocks a client after repeated wrong links', async () => {
    const { call } = setup();
    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await call('GET', '/api/reveal/wrong-guess-ada', undefined, ip)).status).toBe(404);
    }
    expect((await call('GET', '/api/reveal/legacyTokenAda0000000AA', undefined, ip)).status).toBe(
      429,
    );
    expect((await call('GET', '/api/reveal/legacyTokenAda0000000AA')).status).toBe(200);
  });

  it('requires the admin password', async () => {
    const { call } = setup();
    const response = await call('GET', '/api/admin/events', undefined, {
      authorization: 'Bearer no',
    });
    expect(response.status).toBe(401);
  });
});
