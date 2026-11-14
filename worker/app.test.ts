import { describe, expect, it } from 'vitest';
import {
  MAIN_EVENT_ID,
  MAX_CHARACTERS,
  MAX_CHARACTER_IMAGE_BYTES,
  adminStateSchema,
  characterListSchema,
  eventListSchema,
  revealResponseSchema,
} from '../shared/schema';
import { createApp, type CharacterRepository, type EventRepository } from './app';
import type { CharacterImage, StoredCharacter } from './characters';
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

function memoryCharacters(initial: StoredCharacter[]) {
  const state = { library: structuredClone(initial) };
  const images = new Map<string, CharacterImage>();
  const characters: CharacterRepository = {
    async list() {
      return structuredClone(state.library);
    },
    async save(next) {
      state.library = structuredClone(next);
    },
    async loadImage(id) {
      return images.get(id) ?? null;
    },
    async saveImage(id, image) {
      images.set(id, image);
    },
    async removeImage(id) {
      images.delete(id);
    },
  };
  return { state, images, characters };
}

function setup(
  initial: Record<string, unknown> = { [MAIN_EVENT_ID]: LEGACY_EVENT },
  initialCharacters: StoredCharacter[] = [],
) {
  const { store, repository } = memoryRepository(structuredClone(initial));
  const library = memoryCharacters(initialCharacters);
  const app = createApp({
    repository,
    characters: library.characters,
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
  async function upload(method: string, path: string, fields: Record<string, string | Blob>) {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.set(name, value);
    return app.request(path, {
      method,
      headers: { authorization: `Bearer ${PASSWORD}` },
      body,
    });
  }
  return { store, library, call, upload };
}

function image(bytes: number[], type = 'image/webp'): File {
  return new File([new Uint8Array(bytes)], 'sprite', { type });
}

async function characterList(response: Response) {
  return characterListSchema.parse(await response.json()).characters;
}

/** Creates Alex and Sam in the library and returns their ids. */
async function createAlexAndSam(upload: ReturnType<typeof setup>['upload']) {
  await upload('POST', '/api/admin/characters', { name: 'Alex', image: image([1, 2, 3]) });
  const list = await characterList(
    await upload('POST', '/api/admin/characters', {
      name: 'Sam',
      image: image([4, 5], 'image/png'),
    }),
  );
  const [alex, sam] = list;
  return { alex: alex.id, sam: sam.id };
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

describe('characters API', () => {
  it('creates, lists, renames, replaces and deletes characters', async () => {
    const { call, upload } = setup();
    const { alex, sam } = await createAlexAndSam(upload);
    expect(await characterList(await call('GET', '/api/admin/characters'))).toEqual([
      { id: alex, name: 'Alex' },
      { id: sam, name: 'Sam' },
    ]);

    const picture = await call('GET', `/api/admin/characters/${alex}/image`);
    expect(picture.headers.get('content-type')).toBe('image/webp');
    expect(picture.headers.get('cache-control')).toBe('no-store');
    expect([...new Uint8Array(await picture.arrayBuffer())]).toEqual([1, 2, 3]);

    const renamed = await upload('PUT', `/api/admin/characters/${alex}`, { name: ' Alex B ' });
    expect((await characterList(renamed))[0]).toEqual({ id: alex, name: 'Alex B' });
    const kept = await call('GET', `/api/admin/characters/${alex}/image`);
    expect([...new Uint8Array(await kept.arrayBuffer())]).toEqual([1, 2, 3]);

    await upload('PUT', `/api/admin/characters/${sam}`, {
      name: 'Sam',
      image: image([9], 'image/webp'),
    });
    const replaced = await call('GET', `/api/admin/characters/${sam}/image`);
    expect(replaced.headers.get('content-type')).toBe('image/webp');
    expect([...new Uint8Array(await replaced.arrayBuffer())]).toEqual([9]);

    const deleted = await call('DELETE', `/api/admin/characters/${alex}`);
    expect(await characterList(deleted)).toEqual([{ id: sam, name: 'Sam' }]);
    expect((await call('GET', `/api/admin/characters/${alex}/image`)).status).toBe(404);
    expect((await call('DELETE', `/api/admin/characters/${alex}`)).status).toBe(404);
    expect((await upload('PUT', `/api/admin/characters/${alex}`, { name: 'Alex' })).status).toBe(
      404,
    );
  });

  it('rejects bad names and images', async () => {
    const { call, upload } = setup();
    const post = (fields: Record<string, string | Blob>) =>
      upload('POST', '/api/admin/characters', fields);
    expect((await post({ name: 'Alex', image: image([1], 'image/gif') })).status).toBe(400);
    expect((await post({ name: 'Alex', image: image([]) })).status).toBe(400);
    const tooLarge = new File([new Uint8Array(MAX_CHARACTER_IMAGE_BYTES + 1)], 'sprite', {
      type: 'image/png',
    });
    expect((await post({ name: 'Alex', image: tooLarge })).status).toBe(400);
    expect((await post({ name: '  ', image: image([1]) })).status).toBe(400);
    expect((await post({ name: 'A'.repeat(41), image: image([1]) })).status).toBe(400);
    expect((await post({ name: 'Alex' })).status).toBe(400);
    expect((await post({ name: 'Alex', image: 'not a file' })).status).toBe(400);
    expect((await call('POST', '/api/admin/characters', { name: 'Alex' })).status).toBe(400);
    expect(await characterList(await call('GET', '/api/admin/characters'))).toEqual([]);
  });

  it('caps the library size', async () => {
    const full = Array.from({ length: MAX_CHARACTERS }, (_, index) => ({
      id: `c${index}`,
      name: 'Sam',
      createdAt: index,
    }));
    const { upload } = setup(undefined, full);
    const response = await upload('POST', '/api/admin/characters', {
      name: 'Alex',
      image: image([1]),
    });
    expect(response.status).toBe(400);
  });

  it('requires the admin password', async () => {
    const { call } = setup();
    const response = await call('GET', '/api/admin/characters', undefined, {
      authorization: 'Bearer no',
    });
    expect(response.status).toBe(401);
  });
});

describe('event characters', () => {
  const mainPath = `/api/admin/events/${MAIN_EVENT_ID}`;

  it('old events have no characters', async () => {
    const { call } = setup();
    const state = adminStateSchema.parse(await (await call('GET', mainPath)).json());
    expect(state.characterIds).toEqual([]);
  });

  it('attaches library characters and rejects unknown or repeated ones', async () => {
    const { call, upload } = setup();
    const { alex, sam } = await createAlexAndSam(upload);
    const path = `${mainPath}/characters`;
    expect((await call('PUT', path, { characterIds: ['missing'] })).status).toBe(400);
    expect((await call('PUT', path, { characterIds: [alex, alex] })).status).toBe(400);
    expect((await call('PUT', path, { characterIds: 'nope' })).status).toBe(400);
    const saved = await call('PUT', path, { characterIds: [sam, alex] });
    const state = adminStateSchema.parse(await saved.json());
    expect(state.characterIds).toEqual([sam, alex]);
    expect(state.drawn).toBe(true);
    expect(
      (await call('PUT', '/api/admin/events/nope/characters', { characterIds: [] })).status,
    ).toBe(404);
  });

  it('deleting a character removes it from every event', async () => {
    const { call, upload } = setup();
    const { alex, sam } = await createAlexAndSam(upload);
    const other = adminStateSchema.parse(
      await (await call('POST', '/api/admin/events', { title: 'Work' })).json(),
    );
    const otherPath = `/api/admin/events/${other.id}`;
    await call('PUT', `${mainPath}/characters`, { characterIds: [alex, sam] });
    await call('PUT', `${otherPath}/characters`, { characterIds: [alex] });
    await call('DELETE', `/api/admin/characters/${alex}`);
    const characterIdsOf = async (path: string) =>
      adminStateSchema.parse(await (await call('GET', path)).json()).characterIds;
    expect(await characterIdsOf(mainPath)).toEqual([sam]);
    expect(await characterIdsOf(otherPath)).toEqual([]);
  });
});

describe('reveal cast', () => {
  async function castSetup() {
    const context = setup();
    const { call, upload } = context;
    const { alex, sam } = await createAlexAndSam(upload);
    const other = adminStateSchema.parse(
      await (await call('POST', '/api/admin/events', { title: 'Work' })).json(),
    );
    await call('POST', `/api/admin/events/${other.id}/people`, { names: ['Cleo', 'Dev'] });
    await call('POST', `/api/admin/events/${other.id}/draw`);
    await call('PUT', `/api/admin/events/${MAIN_EVENT_ID}/characters`, { characterIds: [alex] });
    await call('PUT', `/api/admin/events/${other.id}/characters`, { characterIds: [sam] });
    return { ...context, alex, sam };
  }

  it('lists only attached characters that still exist, without names', async () => {
    const { call, library, alex } = await castSetup();
    const response = await call('GET', '/api/reveal/legacyTokenAda0000000AA');
    const body: unknown = await response.json();
    expect(revealResponseSchema.parse(body).cast).toEqual([alex]);
    expect(JSON.stringify(body)).not.toContain('Alex');
    expect(JSON.stringify(body)).not.toContain('Sam');

    library.state.library = library.state.library.filter((character) => character.id !== alex);
    const after = await call('GET', '/api/reveal/legacyTokenAda0000000AA');
    expect(revealResponseSchema.parse(await after.json()).cast).toEqual([]);
  });

  it("serves images only for characters attached to the link's event", async () => {
    const { call, alex, sam } = await castSetup();
    const link = '/api/reveal/legacyTokenAda0000000AA/cast';
    const attached = await call('GET', `${link}/${alex}`);
    expect(attached.status).toBe(200);
    expect(attached.headers.get('content-type')).toBe('image/webp');
    expect(attached.headers.get('cache-control')).toBe('private, max-age=300');
    expect([...new Uint8Array(await attached.arrayBuffer())]).toEqual([1, 2, 3]);

    expect((await call('GET', `${link}/${sam}`)).status).toBe(404);
    expect((await call('GET', `${link}/missing`)).status).toBe(404);
    expect((await call('GET', `/api/reveal/wrong-guess-ada/cast/${alex}`)).status).toBe(404);
  });

  it('blocks a client after repeated wrong links', async () => {
    const { call, alex } = await castSetup();
    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    for (let attempt = 0; attempt < 3; attempt++) {
      const miss = await call('GET', `/api/reveal/wrong-guess-ada/cast/${alex}`, undefined, ip);
      expect(miss.status).toBe(404);
    }
    const blocked = await call(
      'GET',
      `/api/reveal/legacyTokenAda0000000AA/cast/${alex}`,
      undefined,
      ip,
    );
    expect(blocked.status).toBe(429);
  });
});
