import { describe, expect, it } from 'vitest';
import { REVEAL_KINDS } from '../shared/schema';
import {
  addPeople,
  createEmptyEvent,
  drawNames,
  isDrawn,
  lookupReveal,
  markOpened,
  removePerson,
  setReveal,
  toAdminState,
} from './event';

const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus'];

describe('addPeople', () => {
  it('gives each person a unique id and link token', () => {
    const event = addPeople(createEmptyEvent(), NAMES);
    expect(new Set(event.people.map((person) => person.id)).size).toBe(NAMES.length);
    expect(new Set(event.people.map((person) => person.token)).size).toBe(NAMES.length);
  });

  it('spreads reveal styles evenly', () => {
    const event = addPeople(createEmptyEvent(), NAMES.slice(0, REVEAL_KINDS.length));
    expect(new Set(event.people.map((person) => person.reveal)).size).toBe(REVEAL_KINDS.length);
  });

  it('clears an existing draw', () => {
    const drawn = drawNames(addPeople(createEmptyEvent(), NAMES));
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    expect(isDrawn(addPeople(drawn, ['Hana']))).toBe(false);
  });
});

describe('drawNames', () => {
  it('refuses to draw with fewer than two people', () => {
    expect(drawNames(addPeople(createEmptyEvent(), ['Ada']))).toBeNull();
  });

  it('gives everyone exactly one receiver and never themselves', () => {
    for (let run = 0; run < 200; run++) {
      const size = 2 + (run % (NAMES.length - 1));
      const event = drawNames(addPeople(createEmptyEvent(), NAMES.slice(0, size)));
      expect(event).not.toBeNull();
      if (!event) return;
      const receivers = event.people.map((person) => person.receiverId);
      expect(new Set(receivers).size).toBe(size);
      for (const person of event.people) {
        expect(person.receiverId).not.toBeNull();
        expect(person.receiverId).not.toBe(person.id);
      }
    }
  });
});

describe('reveal links', () => {
  it('returns the receiver for a valid token once drawn', () => {
    const undrawn = addPeople(createEmptyEvent(), NAMES);
    const token = undrawn.people[0].token;
    expect(lookupReveal(undrawn, token).status).toBe('not_drawn');
    expect(lookupReveal(undrawn, 'missing').status).toBe('not_found');

    const drawn = drawNames(undrawn);
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    const result = lookupReveal(drawn, token);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const receiver = drawn.people.find((person) => person.id === drawn.people[0].receiverId);
    expect(result.reveal.giverName).toBe('Ada');
    expect(result.reveal.receiverName).toBe(receiver?.name);
  });

  it('records that a link was opened', () => {
    const drawn = drawNames(addPeople(createEmptyEvent(), NAMES));
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    const opened = markOpened(drawn, drawn.people[2].token);
    expect(opened?.people[2].opened).toBe(true);
    expect(markOpened(drawn, 'missing')).toBeNull();
  });
});

describe('editing people', () => {
  it('removing a person clears the draw', () => {
    const drawn = drawNames(addPeople(createEmptyEvent(), NAMES));
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    const next = removePerson(drawn, drawn.people[0].id);
    expect(next?.people).toHaveLength(NAMES.length - 1);
    expect(next ? toAdminState(next).drawn : true).toBe(false);
    expect(removePerson(drawn, 'missing')).toBeNull();
  });

  it('changing a reveal style keeps the draw', () => {
    const drawn = drawNames(addPeople(createEmptyEvent(), NAMES));
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    const next = setReveal(drawn, drawn.people[0].id, 'globe');
    expect(next?.people[0].reveal).toBe('globe');
    expect(next ? isDrawn(next) : false).toBe(true);
  });
});
