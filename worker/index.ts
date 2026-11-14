import { DurableObject } from 'cloudflare:workers';
import { MAIN_EVENT_ID } from '../shared/schema';
import { createApp } from './app';
import {
  characterImageSchema,
  characterLibrarySchema,
  type CharacterImage,
  type StoredCharacter,
} from './characters';
import { createEmptyEvent, storedEventSchema, type EventRecord, type StoredEvent } from './event';
import { MissLimiter } from './rate-limit';

/** The main event keeps the key it had before multiple events existed. */
const MAIN_EVENT_KEY = 'event';
const EVENT_KEY_PREFIX = 'event:';
const CHARACTERS_KEY = 'characters';
const CHARACTER_IMAGE_KEY_PREFIX = 'character-image:';
const MAX_LINK_MISSES = 20;
const LINK_MISS_WINDOW_MS = 15 * 60 * 1000;

function storageKey(id: string): string {
  return id === MAIN_EVENT_ID ? MAIN_EVENT_KEY : `${EVENT_KEY_PREFIX}${id}`;
}

function imageKey(characterId: string): string {
  return `${CHARACTER_IMAGE_KEY_PREFIX}${characterId}`;
}

/**
 * Holds every Kris Kringle event. All API requests run inside this object so that reads and
 * writes of events never interleave.
 */
export class EventStore extends DurableObject<Env> {
  private readonly limiter = new MissLimiter(MAX_LINK_MISSES, LINK_MISS_WINDOW_MS);

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
      adminPassword: this.env.ADMIN_PASSWORD,
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
