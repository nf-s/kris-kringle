import type { z } from 'zod';
import {
  CHARACTER_POSES,
  adminListSchema,
  adminStateSchema,
  characterListSchema,
  errorResponseSchema,
  eventListSchema,
  revealResponseSchema,
  sessionSchema,
  type AddAdminRequest,
  type AddPeopleRequest,
  type AdminList,
  type AdminState,
  type CharacterList,
  type CreateEventRequest,
  type EventCharactersRequest,
  type EventList,
  type ExclusionsRequest,
  type RevealKind,
  type RevealResponse,
  type Session,
  type SettingsRequest,
  type UpdatePersonRequest,
} from '../shared/schema';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Sent as multipart/form-data instead of a JSON body. */
  form?: FormData;
}

function requestBody(options: RequestOptions): BodyInit | undefined {
  if (options.form !== undefined) return options.form;
  return options.body === undefined ? undefined : JSON.stringify(options.body);
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: requestBody(options),
  });
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(response.status, parsed.success ? parsed.data.error : 'Request failed');
  }
  return response;
}

async function request<T>(schema: z.ZodType<T>, path: string, options: RequestOptions): Promise<T> {
  const response = await send(path, options);
  return schema.parse(await response.json());
}

function eventPath(eventId: string, path = ''): string {
  return `/api/admin/events/${encodeURIComponent(eventId)}${path}`;
}

function characterPath(id: string, path = ''): string {
  return `/api/admin/characters/${encodeURIComponent(id)}${path}`;
}

function characterForm(name: string, image?: Blob): FormData {
  const form = new FormData();
  form.set('name', name);
  if (image) form.set('image', image);
  return form;
}

function admin(path: string, method = 'GET', body?: unknown): Promise<AdminState> {
  return request(adminStateSchema, path, { method, body });
}

function adminPath(email = ''): string {
  return `/api/admin/admins${email ? `/${encodeURIComponent(email)}` : ''}`;
}

export function fetchSession(): Promise<Session> {
  return request(sessionSchema, '/api/session', {});
}

/** Where to send the browser to sign in. `next` is the path to come back to. */
export function signInPath(next: string): string {
  return `/auth/google/start?next=${encodeURIComponent(next)}`;
}

export async function signOut(): Promise<void> {
  await send('/auth/logout', { method: 'POST' });
}

export const adminApi = {
  events: (): Promise<EventList> => request(eventListSchema, '/api/admin/events', {}),
  createEvent: (body: CreateEventRequest) => admin('/api/admin/events', 'POST', body),
  deleteEvent: (eventId: string): Promise<EventList> =>
    request(eventListSchema, eventPath(eventId), { method: 'DELETE' }),
  event: (eventId: string) => admin(eventPath(eventId)),
  saveSettings: (eventId: string, body: SettingsRequest) =>
    admin(eventPath(eventId, '/settings'), 'PUT', body),
  addPeople: (eventId: string, body: AddPeopleRequest) =>
    admin(eventPath(eventId, '/people'), 'POST', body),
  setReveal: (eventId: string, id: string, reveal: RevealKind) => {
    const body: UpdatePersonRequest = { reveal };
    return admin(eventPath(eventId, `/people/${encodeURIComponent(id)}`), 'PATCH', body);
  },
  removePerson: (eventId: string, id: string) =>
    admin(eventPath(eventId, `/people/${encodeURIComponent(id)}`), 'DELETE'),
  saveExclusions: (eventId: string, body: ExclusionsRequest) =>
    admin(eventPath(eventId, '/exclusions'), 'PUT', body),
  draw: (eventId: string) => admin(eventPath(eventId, '/draw'), 'POST'),
  clearDraw: (eventId: string) => admin(eventPath(eventId, '/draw'), 'DELETE'),
  saveEventCharacters: (eventId: string, body: EventCharactersRequest) =>
    admin(eventPath(eventId, '/characters'), 'PUT', body),
  characters: (): Promise<CharacterList> =>
    request(characterListSchema, '/api/admin/characters', {}),
  createCharacter: (name: string, image: Blob): Promise<CharacterList> =>
    request(characterListSchema, '/api/admin/characters', {
      method: 'POST',
      form: characterForm(name, image),
    }),
  updateCharacter: (id: string, name: string, image?: Blob): Promise<CharacterList> =>
    request(characterListSchema, characterPath(id), {
      method: 'PUT',
      form: characterForm(name, image),
    }),
  deleteCharacter: (id: string): Promise<CharacterList> =>
    request(characterListSchema, characterPath(id), { method: 'DELETE' }),
  characterImage: async (id: string): Promise<Blob> =>
    (await send(characterPath(id, '/image'), {})).blob(),
  admins: (): Promise<AdminList> => request(adminListSchema, adminPath(), {}),
  addAdmin: (body: AddAdminRequest): Promise<AdminList> =>
    request(adminListSchema, adminPath(), { method: 'POST', body }),
  removeAdmin: (email: string): Promise<AdminList> =>
    request(adminListSchema, adminPath(email), { method: 'DELETE' }),
};

export function fetchReveal(token: string): Promise<RevealResponse> {
  return request(revealResponseSchema, `/api/reveal/${encodeURIComponent(token)}`, {});
}

export function castImagePath(token: string, characterId: string): string {
  return `/api/reveal/${encodeURIComponent(token)}/cast/${encodeURIComponent(characterId)}?poses=${CHARACTER_POSES.length}`;
}

export async function markViewed(token: string): Promise<void> {
  await send(`/api/reveal/${encodeURIComponent(token)}/viewed`, { method: 'POST' });
}

export async function markOpened(token: string): Promise<void> {
  await send(`/api/reveal/${encodeURIComponent(token)}/opened`, { method: 'POST' });
}
