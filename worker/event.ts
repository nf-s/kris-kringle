import { z } from 'zod';
import {
  REVEAL_KINDS,
  adminPersonSchema,
  type AdminState,
  type EventSummary,
  type ExclusionsRequest,
  type RevealKind,
  type RevealResponse,
  type SettingsRequest,
} from '../shared/schema';
import { ADJECTIVES, NOUNS } from './words';

/** Older stored events have no `createdAt`; they sort first. */
export const storedEventSchema = z.object({
  title: z.string(),
  note: z.string(),
  createdAt: z.number().default(0),
  people: z.array(adminPersonSchema),
});
export type StoredEvent = z.infer<typeof storedEventSchema>;
type StoredPerson = StoredEvent['people'][number];

export interface EventRecord {
  id: string;
  event: StoredEvent;
}

export type RevealLookup =
  { status: 'not_found' } | { status: 'not_drawn' } | { status: 'ok'; reveal: RevealResponse };

export type DrawResult =
  { status: 'ok'; event: StoredEvent } | { status: 'too_few' } | { status: 'impossible' };

export type VisitKind = 'view' | 'completion';

export const MIN_PEOPLE_TO_DRAW = 2;
/** Caps the visit log so a link opened over and over cannot grow storage without bound. */
const MAX_VISITS_PER_PERSON = 500;
/** Random single-loop draws to try before falling back to a matching search. */
const LOOP_ATTEMPTS = 2000;

export function createEmptyEvent(): StoredEvent {
  return { title: '', note: '', createdAt: 0, people: [] };
}

export function createEvent(title: string, now: number): StoredEvent {
  return { title, note: '', createdAt: now, people: [] };
}

/** Uniform integer in [0, max) from the platform CSPRNG. */
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

export function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Lowercase ASCII form of the first word of a name, for use in a link. */
export function firstNameSlug(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const slug = first
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return slug || 'friend';
}

/** `<adjective>-<noun>-<first name>`, unique against `taken` (which it updates). */
function passphraseToken(name: string, taken: Set<string>): string {
  const slug = firstNameSlug(name);
  let token: string;
  do {
    token = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${slug}`;
  } while (taken.has(token));
  taken.add(token);
  return token;
}

/** Picks the reveal used by the fewest people so far, so the styles stay evenly spread. */
function nextRevealKind(people: readonly StoredPerson[]): RevealKind {
  const counts = REVEAL_KINDS.map(
    (kind) => people.filter((person) => person.reveal === kind).length,
  );
  const fewest = Math.min(...counts);
  const candidates = REVEAL_KINDS.filter((_, index) => counts[index] === fewest);
  return pick(candidates);
}

/** Clears assignments and everything recorded against them. */
function withoutDraw(people: readonly StoredPerson[]): StoredPerson[] {
  return people.map((person) => ({
    ...person,
    receiverId: null,
    opened: false,
    views: [],
    completions: [],
  }));
}

function canGive(giver: StoredPerson, receiverId: string): boolean {
  return giver.id !== receiverId && !giver.exclusions.includes(receiverId);
}

function drawBreaksExclusions(people: readonly StoredPerson[]): boolean {
  return people.some(
    (person) => person.receiverId !== null && person.exclusions.includes(person.receiverId),
  );
}

export function isDrawn(event: StoredEvent): boolean {
  return (
    event.people.length >= MIN_PEOPLE_TO_DRAW &&
    event.people.every((person) => person.receiverId !== null)
  );
}

export function allTokens(records: readonly EventRecord[]): Set<string> {
  return new Set(records.flatMap((record) => record.event.people.map((person) => person.token)));
}

export function updateSettings(event: StoredEvent, settings: SettingsRequest): StoredEvent {
  return { ...event, title: settings.title, note: settings.note };
}

/**
 * Adding people invalidates any existing draw. New links are unique against `takenTokens`, which
 * should hold every link in every event.
 */
export function addPeople(
  event: StoredEvent,
  names: readonly string[],
  takenTokens: ReadonlySet<string>,
): StoredEvent {
  const taken = new Set(takenTokens);
  const people = withoutDraw(event.people);
  for (const name of names) {
    people.push({
      id: randomToken(9),
      name,
      token: passphraseToken(name, taken),
      reveal: nextRevealKind(people),
      opened: false,
      receiverId: null,
      exclusions: [],
      views: [],
      completions: [],
    });
  }
  return { ...event, people };
}

/** Removing a person invalidates any existing draw. Returns null if the person does not exist. */
export function removePerson(event: StoredEvent, id: string): StoredEvent | null {
  if (!event.people.some((person) => person.id === id)) return null;
  const remaining = event.people
    .filter((person) => person.id !== id)
    .map((person) => ({
      ...person,
      exclusions: person.exclusions.filter((excludedId) => excludedId !== id),
    }));
  return { ...event, people: withoutDraw(remaining) };
}

export function setReveal(event: StoredEvent, id: string, reveal: RevealKind): StoredEvent | null {
  if (!event.people.some((person) => person.id === id)) return null;
  return {
    ...event,
    people: event.people.map((person) => (person.id === id ? { ...person, reveal } : person)),
  };
}

/**
 * Replaces every person's exclusions. Clears the draw only if it gives someone a person they are
 * now excluded from. Returns null if an id is unknown or a person excludes themselves.
 */
export function setExclusions(
  event: StoredEvent,
  exclusions: ExclusionsRequest['exclusions'],
): StoredEvent | null {
  const ids = new Set(event.people.map((person) => person.id));
  for (const [giverId, excludedIds] of Object.entries(exclusions)) {
    if (!ids.has(giverId)) return null;
    if (excludedIds.some((excludedId) => excludedId === giverId || !ids.has(excludedId))) {
      return null;
    }
  }
  const people = event.people.map((person) => ({
    ...person,
    exclusions: [...new Set(exclusions[person.id] ?? [])],
  }));
  return { ...event, people: drawBreaksExclusions(people) ? withoutDraw(people) : people };
}

/** One random loop through everyone that respects exclusions, or null if none was found. */
function randomLoop(people: readonly StoredPerson[]): Map<string, string> | null {
  for (let attempt = 0; attempt < LOOP_ATTEMPTS; attempt++) {
    const order = shuffled(people);
    const valid = order.every((giver, index) =>
      canGive(giver, order[(index + 1) % order.length].id),
    );
    if (valid) {
      return new Map(order.map((giver, index) => [giver.id, order[(index + 1) % order.length].id]));
    }
  }
  return null;
}

/**
 * Any valid assignment (possibly several smaller loops), found with augmenting paths over a random
 * order. Returns null only if no assignment satisfies the exclusions.
 */
function randomMatching(people: readonly StoredPerson[]): Map<string, string> | null {
  const giverByReceiver = new Map<string, StoredPerson>();

  function assign(giver: StoredPerson, visited: Set<string>): boolean {
    for (const receiver of shuffled(people)) {
      if (visited.has(receiver.id) || !canGive(giver, receiver.id)) continue;
      visited.add(receiver.id);
      const current = giverByReceiver.get(receiver.id);
      if (!current || assign(current, visited)) {
        giverByReceiver.set(receiver.id, giver);
        return true;
      }
    }
    return false;
  }

  for (const giver of shuffled(people)) {
    if (!assign(giver, new Set())) return null;
  }
  return new Map([...giverByReceiver].map(([receiverId, giver]) => [giver.id, receiverId]));
}

/**
 * Assigns everyone a receiver, nobody themselves and nobody they are excluded from. Prefers one
 * loop through the whole group; falls back to smaller loops when exclusions rule a single loop out.
 */
export function drawNames(event: StoredEvent): DrawResult {
  if (event.people.length < MIN_PEOPLE_TO_DRAW) return { status: 'too_few' };
  const receiverByGiver = randomLoop(event.people) ?? randomMatching(event.people);
  if (!receiverByGiver) return { status: 'impossible' };
  return {
    status: 'ok',
    event: {
      ...event,
      people: withoutDraw(event.people).map((person) => ({
        ...person,
        receiverId: receiverByGiver.get(person.id) ?? null,
      })),
    },
  };
}

export function clearDraw(event: StoredEvent): StoredEvent {
  return { ...event, people: withoutDraw(event.people) };
}

/** Logs a link load or a finished reveal. Returns null if the link is unknown or not drawn yet. */
export function recordVisit(
  event: StoredEvent,
  token: string,
  kind: VisitKind,
  now: number,
): StoredEvent | null {
  if (!isDrawn(event) || !event.people.some((person) => person.token === token)) return null;
  return {
    ...event,
    people: event.people.map((person) => {
      if (person.token !== token) return person;
      if (kind === 'view') {
        return { ...person, views: [...person.views, now].slice(-MAX_VISITS_PER_PERSON) };
      }
      return {
        ...person,
        opened: true,
        completions: [...person.completions, now].slice(-MAX_VISITS_PER_PERSON),
      };
    }),
  };
}

export function toAdminState(id: string, event: StoredEvent): AdminState {
  return {
    id,
    title: event.title,
    note: event.note,
    drawn: isDrawn(event),
    people: event.people,
  };
}

export function toSummary(record: EventRecord): EventSummary {
  return {
    id: record.id,
    title: record.event.title,
    peopleCount: record.event.people.length,
    drawn: isDrawn(record.event),
  };
}

export function findByToken(records: readonly EventRecord[], token: string): EventRecord | null {
  return (
    records.find((record) => record.event.people.some((person) => person.token === token)) ?? null
  );
}

export function lookupReveal(event: StoredEvent, token: string): RevealLookup {
  const giver = event.people.find((person) => person.token === token);
  if (!giver) return { status: 'not_found' };
  const receiver = event.people.find((person) => person.id === giver.receiverId);
  if (!isDrawn(event) || !receiver) return { status: 'not_drawn' };
  return {
    status: 'ok',
    reveal: {
      title: event.title,
      note: event.note,
      giverName: giver.name,
      receiverName: receiver.name,
      reveal: giver.reveal,
    },
  };
}
