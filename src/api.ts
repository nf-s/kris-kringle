import type { z } from 'zod';
import {
  adminStateSchema,
  errorResponseSchema,
  eventListSchema,
  revealResponseSchema,
  type AddPeopleRequest,
  type AdminState,
  type CreateEventRequest,
  type EventList,
  type ExclusionsRequest,
  type RevealKind,
  type RevealResponse,
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
  password?: string;
  body?: unknown;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers();
  if (options.password !== undefined) headers.set('Authorization', `Bearer ${options.password}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

function admin(
  path: string,
  password: string,
  method = 'GET',
  body?: unknown,
): Promise<AdminState> {
  return request(adminStateSchema, path, { method, password, body });
}

export const adminApi = {
  events: (password: string): Promise<EventList> =>
    request(eventListSchema, '/api/admin/events', { password }),
  createEvent: (password: string, body: CreateEventRequest) =>
    admin('/api/admin/events', password, 'POST', body),
  deleteEvent: (password: string, eventId: string): Promise<EventList> =>
    request(eventListSchema, eventPath(eventId), { method: 'DELETE', password }),
  event: (password: string, eventId: string) => admin(eventPath(eventId), password),
  saveSettings: (password: string, eventId: string, body: SettingsRequest) =>
    admin(eventPath(eventId, '/settings'), password, 'PUT', body),
  addPeople: (password: string, eventId: string, body: AddPeopleRequest) =>
    admin(eventPath(eventId, '/people'), password, 'POST', body),
  setReveal: (password: string, eventId: string, id: string, reveal: RevealKind) => {
    const body: UpdatePersonRequest = { reveal };
    return admin(eventPath(eventId, `/people/${encodeURIComponent(id)}`), password, 'PATCH', body);
  },
  removePerson: (password: string, eventId: string, id: string) =>
    admin(eventPath(eventId, `/people/${encodeURIComponent(id)}`), password, 'DELETE'),
  saveExclusions: (password: string, eventId: string, body: ExclusionsRequest) =>
    admin(eventPath(eventId, '/exclusions'), password, 'PUT', body),
  draw: (password: string, eventId: string) => admin(eventPath(eventId, '/draw'), password, 'POST'),
  clearDraw: (password: string, eventId: string) =>
    admin(eventPath(eventId, '/draw'), password, 'DELETE'),
};

export function fetchReveal(token: string): Promise<RevealResponse> {
  return request(revealResponseSchema, `/api/reveal/${encodeURIComponent(token)}`, {});
}

export async function markViewed(token: string): Promise<void> {
  await send(`/api/reveal/${encodeURIComponent(token)}/viewed`, { method: 'POST' });
}

export async function markOpened(token: string): Promise<void> {
  await send(`/api/reveal/${encodeURIComponent(token)}/opened`, { method: 'POST' });
}
