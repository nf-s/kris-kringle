import { z } from 'zod';
import {
  REVEAL_KINDS,
  adminPersonSchema,
  type AdminState,
  type RevealKind,
  type RevealResponse,
  type SettingsRequest,
} from '../shared/schema';

export const storedEventSchema = z.object({
  title: z.string(),
  note: z.string(),
  people: z.array(adminPersonSchema),
});
export type StoredEvent = z.infer<typeof storedEventSchema>;
type StoredPerson = StoredEvent['people'][number];

export type RevealLookup =
  { status: 'not_found' } | { status: 'not_drawn' } | { status: 'ok'; reveal: RevealResponse };

export const MIN_PEOPLE_TO_DRAW = 2;

export function createEmptyEvent(): StoredEvent {
  return { title: '', note: '', people: [] };
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

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Picks the reveal used by the fewest people so far, so the styles stay evenly spread. */
function nextRevealKind(people: readonly StoredPerson[]): RevealKind {
  const counts = REVEAL_KINDS.map(
    (kind) => people.filter((person) => person.reveal === kind).length,
  );
  const fewest = Math.min(...counts);
  const candidates = REVEAL_KINDS.filter((_, index) => counts[index] === fewest);
  return candidates[randomInt(candidates.length)];
}

function withoutDraw(people: readonly StoredPerson[]): StoredPerson[] {
  return people.map((person) => ({ ...person, receiverId: null, opened: false }));
}

export function isDrawn(event: StoredEvent): boolean {
  return (
    event.people.length >= MIN_PEOPLE_TO_DRAW &&
    event.people.every((person) => person.receiverId !== null)
  );
}

export function updateSettings(event: StoredEvent, settings: SettingsRequest): StoredEvent {
  return { ...event, title: settings.title, note: settings.note };
}

/** Adding people invalidates any existing draw. */
export function addPeople(event: StoredEvent, names: readonly string[]): StoredEvent {
  const people = withoutDraw(event.people);
  for (const name of names) {
    people.push({
      id: randomToken(9),
      name,
      token: randomToken(16),
      reveal: nextRevealKind(people),
      opened: false,
      receiverId: null,
    });
  }
  return { ...event, people };
}

/** Removing a person invalidates any existing draw. Returns null if the person does not exist. */
export function removePerson(event: StoredEvent, id: string): StoredEvent | null {
  if (!event.people.some((person) => person.id === id)) return null;
  return { ...event, people: withoutDraw(event.people.filter((person) => person.id !== id)) };
}

export function setReveal(event: StoredEvent, id: string, reveal: RevealKind): StoredEvent | null {
  if (!event.people.some((person) => person.id === id)) return null;
  return {
    ...event,
    people: event.people.map((person) => (person.id === id ? { ...person, reveal } : person)),
  };
}

/**
 * Assigns everyone a receiver by arranging the group in one random loop, so nobody draws
 * themselves. Returns null if there are too few people.
 */
export function drawNames(event: StoredEvent): StoredEvent | null {
  if (event.people.length < MIN_PEOPLE_TO_DRAW) return null;
  const order = shuffled(event.people.map((person) => person.id));
  const receiverByGiver = new Map(
    order.map((giverId, index) => [giverId, order[(index + 1) % order.length]]),
  );
  return {
    ...event,
    people: event.people.map((person) => ({
      ...person,
      opened: false,
      receiverId: receiverByGiver.get(person.id) ?? null,
    })),
  };
}

export function clearDraw(event: StoredEvent): StoredEvent {
  return { ...event, people: withoutDraw(event.people) };
}

export function markOpened(event: StoredEvent, token: string): StoredEvent | null {
  if (!isDrawn(event) || !event.people.some((person) => person.token === token)) return null;
  return {
    ...event,
    people: event.people.map((person) =>
      person.token === token ? { ...person, opened: true } : person,
    ),
  };
}

export function toAdminState(event: StoredEvent): AdminState {
  return { title: event.title, note: event.note, drawn: isDrawn(event), people: event.people };
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
