import { describe, expect, it } from 'vitest';
import { REVEAL_KINDS } from '../shared/schema';
import {
  addPeople,
  createEmptyEvent,
  drawNames,
  firstNameSlug,
  isDrawn,
  lookupReveal,
  recordVisit,
  removePerson,
  setExclusions,
  setReveal,
  toAdminState,
  type StoredEvent,
} from './event';
import { ADJECTIVES, NOUNS } from './words';

const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus'];
const NO_TOKENS: ReadonlySet<string> = new Set();

function withPeople(names: readonly string[]): StoredEvent {
  return addPeople(createEmptyEvent(), names, NO_TOKENS);
}

function drawn(event: StoredEvent): StoredEvent {
  const result = drawNames(event);
  if (result.status !== 'ok') throw new Error(`Draw failed: ${result.status}`);
  return result.event;
}

function receiverOf(event: StoredEvent, name: string): string | undefined {
  const giver = event.people.find((person) => person.name === name);
  return event.people.find((person) => person.id === giver?.receiverId)?.name;
}

describe('word lists', () => {
  it('are large, lowercase and free of duplicates', () => {
    for (const list of [ADJECTIVES, NOUNS]) {
      expect(list.length).toBeGreaterThan(350);
      expect(new Set(list).size).toBe(list.length);
      for (const word of list) expect(word).toMatch(/^[a-z]+$/);
    }
  });
});

describe('addPeople', () => {
  it('gives each person a unique id and a passphrase link ending in their first name', () => {
    const event = withPeople([...NAMES, 'Nick Forbes']);
    expect(new Set(event.people.map((person) => person.id)).size).toBe(NAMES.length + 1);
    expect(new Set(event.people.map((person) => person.token)).size).toBe(NAMES.length + 1);
    const nick = event.people.find((person) => person.name === 'Nick Forbes');
    expect(nick?.token).toMatch(/^[a-z]+-[a-z]+-nick$/);
  });

  it('never reuses a link that is already taken', () => {
    const taken = new Set(withPeople(['Ada']).people.map((person) => person.token));
    const event = addPeople(createEmptyEvent(), Array(50).fill('Ada'), taken);
    const tokens = event.people.map((person) => person.token);
    expect(new Set(tokens).size).toBe(50);
    for (const token of tokens) expect(taken.has(token)).toBe(false);
  });

  it('keeps existing people and their links', () => {
    const before = withPeople(['Ada', 'Ben']);
    const after = addPeople(before, ['Cleo'], NO_TOKENS);
    expect(after.people.slice(0, 2).map((person) => person.token)).toEqual(
      before.people.map((person) => person.token),
    );
  });

  it('spreads reveal styles evenly', () => {
    const event = withPeople(NAMES.slice(0, REVEAL_KINDS.length));
    expect(new Set(event.people.map((person) => person.reveal)).size).toBe(REVEAL_KINDS.length);
  });

  it('clears an existing draw', () => {
    expect(isDrawn(addPeople(drawn(withPeople(NAMES)), ['Hana'], NO_TOKENS))).toBe(false);
  });
});

describe('firstNameSlug', () => {
  it('uses the first word, lowercased, without accents or symbols', () => {
    expect(firstNameSlug('Nick Forbes-Smith')).toBe('nick');
    expect(firstNameSlug('  Zoë ')).toBe('zoe');
    expect(firstNameSlug("O'Neil")).toBe('oneil');
    expect(firstNameSlug('李')).toBe('friend');
  });
});

describe('drawNames', () => {
  it('refuses to draw with fewer than two people', () => {
    expect(drawNames(withPeople(['Ada'])).status).toBe('too_few');
  });

  it('gives everyone exactly one receiver and never themselves', () => {
    for (let run = 0; run < 200; run++) {
      const size = 2 + (run % (NAMES.length - 1));
      const event = drawn(withPeople(NAMES.slice(0, size)));
      const receivers = event.people.map((person) => person.receiverId);
      expect(new Set(receivers).size).toBe(size);
      for (const person of event.people) {
        expect(person.receiverId).not.toBeNull();
        expect(person.receiverId).not.toBe(person.id);
      }
    }
  });

  it('respects exclusions', () => {
    const base = withPeople(NAMES);
    const [ada, ben, cleo] = base.people;
    const event = setExclusions(base, {
      [ada.id]: [ben.id, cleo.id],
      [ben.id]: [ada.id],
      [cleo.id]: [ada.id],
    });
    expect(event).not.toBeNull();
    if (!event) return;
    for (let run = 0; run < 200; run++) {
      const result = drawn(event);
      expect(['Ben', 'Cleo']).not.toContain(receiverOf(result, 'Ada'));
      expect(receiverOf(result, 'Ben')).not.toBe('Ada');
      expect(receiverOf(result, 'Cleo')).not.toBe('Ada');
    }
  });

  it('falls back to smaller loops when a single loop is impossible', () => {
    // Ada and Ben may only give to each other, so the draw must split into separate loops.
    const base = withPeople(['Ada', 'Ben', 'Cleo', 'Dev']);
    const [ada, ben, cleo, dev] = base.people;
    const event = setExclusions(base, {
      [ada.id]: [cleo.id, dev.id],
      [ben.id]: [cleo.id, dev.id],
      [cleo.id]: [ada.id, ben.id],
      [dev.id]: [ada.id, ben.id],
    });
    expect(event).not.toBeNull();
    if (!event) return;
    const result = drawn(event);
    expect(receiverOf(result, 'Ada')).toBe('Ben');
    expect(receiverOf(result, 'Cleo')).toBe('Dev');
  });

  it('reports when exclusions leave no valid draw', () => {
    const base = withPeople(['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = base.people;
    const event = setExclusions(base, { [ada.id]: [ben.id, cleo.id] });
    expect(event && drawNames(event).status).toBe('impossible');
  });
});

describe('setExclusions', () => {
  it('rejects unknown people and self-exclusion', () => {
    const event = withPeople(['Ada', 'Ben']);
    const [ada] = event.people;
    expect(setExclusions(event, { missing: [ada.id] })).toBeNull();
    expect(setExclusions(event, { [ada.id]: ['missing'] })).toBeNull();
    expect(setExclusions(event, { [ada.id]: [ada.id] })).toBeNull();
  });

  it('keeps a draw that still fits and clears one that does not', () => {
    const event = drawn(withPeople(NAMES));
    const ada = event.people[0];
    const other = event.people.find((person) => person.id !== ada.receiverId && person !== ada);
    if (!other || !ada.receiverId) throw new Error('setup');
    expect(isDrawn(setExclusions(event, { [ada.id]: [other.id] }) ?? createEmptyEvent())).toBe(
      true,
    );
    expect(
      isDrawn(setExclusions(event, { [ada.id]: [ada.receiverId] }) ?? createEmptyEvent()),
    ).toBe(false);
  });
});

describe('reveal links', () => {
  it('returns the receiver for a valid token once drawn', () => {
    const undrawn = withPeople(NAMES);
    const token = undrawn.people[0].token;
    expect(lookupReveal(undrawn, token).status).toBe('not_drawn');
    expect(lookupReveal(undrawn, 'missing').status).toBe('not_found');

    const event = drawn(undrawn);
    const result = lookupReveal(event, token);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.reveal.giverName).toBe('Ada');
    expect(result.reveal.receiverName).toBe(receiverOf(event, 'Ada'));
  });

  it('logs views and finished reveals with their times', () => {
    const event = drawn(withPeople(NAMES));
    const token = event.people[2].token;
    const viewed = recordVisit(event, token, 'view', 1000);
    expect(viewed?.people[2].views).toEqual([1000]);
    expect(viewed?.people[2].opened).toBe(false);
    const opened = viewed && recordVisit(viewed, token, 'completion', 2000);
    expect(opened?.people[2].completions).toEqual([2000]);
    expect(opened?.people[2].opened).toBe(true);
    expect(recordVisit(event, 'missing', 'view', 0)).toBeNull();
    expect(recordVisit(withPeople(NAMES), token, 'view', 0)).toBeNull();
  });

  it('a redraw clears what was logged', () => {
    const event = drawn(withPeople(NAMES));
    const opened = recordVisit(event, event.people[0].token, 'completion', 1);
    if (!opened) throw new Error('setup');
    const redrawn = drawn(opened);
    expect(redrawn.people[0].opened).toBe(false);
    expect(redrawn.people[0].completions).toEqual([]);
  });
});

describe('editing people', () => {
  it('removing a person clears the draw and their exclusions', () => {
    const base = withPeople(NAMES);
    const [ada, ben] = base.people;
    const excluded = setExclusions(base, { [ada.id]: [ben.id] });
    if (!excluded) throw new Error('setup');
    const next = removePerson(drawn(excluded), ben.id);
    expect(next?.people).toHaveLength(NAMES.length - 1);
    expect(next?.people[0].exclusions).toEqual([]);
    expect(next ? toAdminState('x', next).drawn : true).toBe(false);
    expect(removePerson(base, 'missing')).toBeNull();
  });

  it('changing a reveal style keeps the draw', () => {
    const event = drawn(withPeople(NAMES));
    const next = setReveal(event, event.people[0].id, 'globe');
    expect(next?.people[0].reveal).toBe('globe');
    expect(next ? isDrawn(next) : false).toBe(true);
  });
});
