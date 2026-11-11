import type { z } from 'zod';
import {
  adminStateSchema,
  errorResponseSchema,
  revealResponseSchema,
  type AddPeopleRequest,
  type AdminState,
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

function admin(
  path: string,
  password: string,
  method = 'GET',
  body?: unknown,
): Promise<AdminState> {
  return request(adminStateSchema, `/api/admin${path}`, { method, password, body });
}

export const adminApi = {
  state: (password: string) => admin('/state', password),
  saveSettings: (password: string, body: SettingsRequest) =>
    admin('/settings', password, 'PUT', body),
  addPeople: (password: string, body: AddPeopleRequest) => admin('/people', password, 'POST', body),
  setReveal: (password: string, id: string, reveal: RevealKind) => {
    const body: UpdatePersonRequest = { reveal };
    return admin(`/people/${encodeURIComponent(id)}`, password, 'PATCH', body);
  },
  removePerson: (password: string, id: string) =>
    admin(`/people/${encodeURIComponent(id)}`, password, 'DELETE'),
  draw: (password: string) => admin('/draw', password, 'POST'),
  clearDraw: (password: string) => admin('/draw', password, 'DELETE'),
};

export function fetchReveal(token: string): Promise<RevealResponse> {
  return request(revealResponseSchema, `/api/reveal/${encodeURIComponent(token)}`, {});
}

export async function markOpened(token: string): Promise<void> {
  await send(`/api/reveal/${encodeURIComponent(token)}/opened`, { method: 'POST' });
}
