import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app';
import { createEmptyEvent, storedEventSchema, type StoredEvent } from './event';

const STORAGE_KEY = 'event';

/**
 * Holds the single Kris Kringle event. All API requests run inside this object so that reads and
 * writes of the event never interleave.
 */
export class EventStore extends DurableObject<Env> {
  private async load(): Promise<StoredEvent> {
    const stored = await this.ctx.storage.get(STORAGE_KEY);
    if (stored === undefined) return createEmptyEvent();
    return storedEventSchema.parse(stored);
  }

  private async save(event: StoredEvent): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, event);
  }

  override async fetch(request: Request): Promise<Response> {
    const app = createApp(
      { load: () => this.load(), save: (event) => this.save(event) },
      this.env.ADMIN_PASSWORD,
    );
    return app.fetch(request);
  }
}

export default {
  async fetch(request, env) {
    return env.EVENT.get(env.EVENT.idFromName('default')).fetch(request);
  },
} satisfies ExportedHandler<Env>;
