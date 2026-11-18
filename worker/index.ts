import { DurableObject } from 'cloudflare:workers';
import { MAIN_EVENT_ID } from '../shared/schema';
import { createApp } from './app';
import {
  authSettingsSchema,
  storedAdminsSchema,
  storedSessionSchema,
  type SessionRecord,
  type StoredSession,
} from './auth';
import {
  characterImageSchema,
  characterLibrarySchema,
  type CharacterImage,
  type StoredCharacter,
} from './characters';
import { createEmptyEvent, storedEventSchema, type EventRecord, type StoredEvent } from './event';
import { createGoogleIdentity } from './google';
import { MissLimiter } from './rate-limit';

/** The main event keeps the key it had before multiple events existed. */
const MAIN_EVENT_KEY = 'event';
const EVENT_KEY_PREFIX = 'event:';
const CHARACTERS_KEY = 'characters';
const CHARACTER_IMAGE_KEY_PREFIX = 'character-image:';
const ADMINS_KEY = 'admins';
const SESSION_KEY_PREFIX = 'session:';
const MAX_LINK_MISSES = 20;
const LINK_MISS_WINDOW_MS = 15 * 60 * 1000;

function storageKey(id: string): string {
  return id === MAIN_EVENT_ID ? MAIN_EVENT_KEY : `${EVENT_KEY_PREFIX}${id}`;
}

function imageKey(characterId: string): string {
  return `${CHARACTER_IMAGE_KEY_PREFIX}${characterId}`;
}

function sessionStorageKey(key: string): string {
  return `${SESSION_KEY_PREFIX}${key}`;
}

/**
 * Holds every Kris Kringle event. All API requests run inside this object so that reads and
 * writes of events never interleave.
 */
export class EventStore extends DurableObject<Env> {
  private readonly limiter = new MissLimiter(MAX_LINK_MISSES, LINK_MISS_WINDOW_MS);
  private readonly settings = authSettingsSchema.parse(this.env);
  private readonly identity = createGoogleIdentity({
    clientId: this.settings.GOOGLE_CLIENT_ID,
    clientSecret: this.settings.GOOGLE_CLIENT_SECRET,
  });

  private async load(id: string): Promise<StoredEvent | null> {
    const stored = await this.ctx.storage.get(storageKey(id));
    if (stored === undefined) return id === MAIN_EVENT_ID ? createEmptyEvent() : null;
    return storedEventSchema.parse(stored);
  }

  private async list(): Promise<EventRecord[]> {
    const main = await this.load(MAIN_EVENT_ID);
    const records: EventRecord[] = main ? [{ id: MAIN_EVENT_ID, event: main }] : [];
    const others = await this.ctx.storage.list({ prefix: EVENT_KEY_PREFIX });
    const rest = [...others].map(([key, value]) => ({
      id: key.slice(EVENT_KEY_PREFIX.length),
      event: storedEventSchema.parse(value),
    }));
    rest.sort((a, b) => a.event.createdAt - b.event.createdAt);
    return [...records, ...rest];
  }

  private async listCharacters(): Promise<StoredCharacter[]> {
    return characterLibrarySchema.parse((await this.ctx.storage.get(CHARACTERS_KEY)) ?? []);
  }

  private async loadImage(id: string): Promise<CharacterImage | null> {
    const stored = await this.ctx.storage.get(imageKey(id));
    return stored === undefined ? null : characterImageSchema.parse(stored);
  }

  private async loadSession(key: string): Promise<StoredSession | null> {
    const stored = await this.ctx.storage.get(sessionStorageKey(key));
    return stored === undefined ? null : storedSessionSchema.parse(stored);
  }

  private async listSessions(): Promise<SessionRecord[]> {
    const stored = await this.ctx.storage.list({ prefix: SESSION_KEY_PREFIX });
    return [...stored].map(([key, value]) => ({
      key: key.slice(SESSION_KEY_PREFIX.length),
      session: storedSessionSchema.parse(value),
    }));
  }

  override async fetch(request: Request): Promise<Response> {
    const app = createApp({
      repository: {
        list: () => this.list(),
        load: (id) => this.load(id),
        save: (id, event) => this.ctx.storage.put(storageKey(id), event),
        remove: async (id) => {
          await this.ctx.storage.delete(storageKey(id));
        },
      },
      characters: {
        list: () => this.listCharacters(),
        save: (characters) => this.ctx.storage.put(CHARACTERS_KEY, characters),
        loadImage: (id) => this.loadImage(id),
        saveImage: (id, image) => this.ctx.storage.put(imageKey(id), image),
        removeImage: async (id) => {
          await this.ctx.storage.delete(imageKey(id));
        },
      },
      auth: {
        admins: async () =>
          storedAdminsSchema.parse((await this.ctx.storage.get(ADMINS_KEY)) ?? []),
        saveAdmins: (emails) => this.ctx.storage.put(ADMINS_KEY, emails),
        loadSession: (key) => this.loadSession(key),
        saveSession: (key, session) => this.ctx.storage.put(sessionStorageKey(key), session),
        removeSession: async (key) => {
          await this.ctx.storage.delete(sessionStorageKey(key));
        },
        listSessions: () => this.listSessions(),
      },
      identity: this.identity,
      ownerEmail: this.settings.ADMIN_EMAIL,
      limiter: this.limiter,
    });
    return app.fetch(request);
  }
}

export default {
  async fetch(request, env) {
    return env.EVENT.get(env.EVENT.idFromName('default')).fetch(request);
  },
} satisfies ExportedHandler<Env>;
