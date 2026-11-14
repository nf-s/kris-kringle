import { describe, expect, it } from 'vitest';
import { REVEAL_KINDS, type RevealKind } from '../../../shared/schema';
import type { Point, Stage } from '../engine';
import type { Flick, Motion } from '../motion';
import { createParticles } from '../particles';
import { REVEAL_FACTORIES } from '../registry';
import { createSfx } from '../sfx';

const FRAME = 1 / 60;

interface PhoneMotion {
  active: boolean;
  tilt: Point;
  push: Point;
  force: number;
  turned: number;
  flick: Flick | null;
}

function still(active: boolean): PhoneMotion {
  return { active, tilt: { x: 0, y: 1 }, push: { x: 0, y: 0 }, force: 0, turned: 0, flick: null };
}

/** Seconds the phone is held still before `move` starts, as it is while someone reads the hint. */
const SETTLE = 0.5;

/** Runs one reveal without a screen, moved only by what `move` reports of the phone. */
function play(
  kind: RevealKind,
  seconds: number,
  active: boolean,
  move: (time: number, frame: number) => Partial<PhoneMotion>,
  tap: (time: number, frame: number) => boolean = () => false,
): { completed: boolean; progress: number; hints: string[]; finishedAt: number } {
  let time = 0;
  let completed = false;
  let progress = 0;
  let phone = still(active);
  const hints: string[] = [];
  const motion: Motion = {
    get active() {
      return phone.active;
    },
    get tilt() {
      return phone.tilt;
    },
    get push() {
      return phone.push;
    },
    get force() {
      return phone.force;
    },
    get turned() {
      return phone.turned;
    },
    get flick() {
      return phone.flick;
    },
  };
  const stage: Stage = {
    width: 375,
    height: 700,
    get time() {
      return time;
    },
    get completed() {
      return completed;
    },
    receiverName: 'Sample',
    particles: createParticles(),
    sfx: createSfx(),
    motion,
    shake: () => undefined,
    haptic: () => undefined,
    setHint(text) {
      hints.push(text);
    },
    setProgress(value) {
      progress = value;
    },
    complete() {
      completed = true;
    },
  };
  const reveal = REVEAL_FACTORIES[kind](stage);
  for (let frame = 0; time < seconds && !completed; frame++) {
    phone = { ...still(active), ...(time < SETTLE ? {} : move(time - SETTLE, frame)) };
    if (time >= SETTLE && tap(time - SETTLE, frame)) {
      const point = { x: stage.width / 2, y: stage.height * 0.52 };
      reveal.onPointerDown?.(point);
      reveal.onPointerUp?.(point);
    }
    reveal.update(FRAME);
    time += FRAME;
  }
  return { completed, progress, hints, finishedAt: time };
}

/** One flick every `gap` seconds, in the direction and of the strength given. */
function flicks(gap: number, direction: Point, strength: number) {
  const every = Math.round(gap / FRAME);
  return (_time: number, frame: number): Partial<PhoneMotion> =>
    frame > 0 && frame % every === 0 ? { flick: { direction, strength } } : {};
}

/** The phone swung from side to side `swings` times a second, turning as it goes. */
function rocking(swings: number) {
  return (time: number): Partial<PhoneMotion> => ({
    tilt: { x: Math.sin(time * Math.PI * swings) * 0.4, y: 0.9 },
    turned: 0.8 * swings * FRAME,
  });
}

describe('moving the phone', () => {
  it('fills the snow globe when shaken', () => {
    const result = play('globe', 20, true, () => ({ force: 18 }));
    expect(result.completed).toBe(true);
    expect(result.hints[0]).toBe('Shake your phone or the globe');
  });

  it('leaves the snow globe alone when only carried about', () => {
    const result = play('globe', 5, true, () => ({ force: 2.5 }));
    expect(result.progress).toBe(0);
  });

  it('winds the jack-in-the-box when twisted', () => {
    const result = play('jack', 30, true, () => ({ turned: 8 * FRAME }));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(10);
    expect(result.hints[0]).toBe('Twist your phone or turn the handle');
  });

  it('winds the jack-in-the-box no faster than a finger however hard it is twisted', () => {
    const result = play('jack', 30, true, () => ({ turned: 40 * FRAME }));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(8);
  });

  it('leaves the jack-in-the-box alone when the phone only turns slowly', () => {
    const result = play('jack', 5, true, () => ({ turned: 0.8 * FRAME }));
    expect(result.progress).toBe(0);
  });

  it('credits five taps per impact and cracks the egg with four sharp jolts', () => {
    for (const direction of [
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ]) {
      for (const strength of [0, 1]) {
        const impacts = flicks(0.8, direction, strength);
        const first = play('egg', 1.2, true, impacts);
        expect(first.progress).toBe(0.25);
        expect(first.completed).toBe(false);
        const three = play('egg', 2.8, true, impacts);
        expect(three.progress).toBe(0.75);
        expect(three.completed).toBe(false);
        const four = play('egg', 4, true, impacts);
        expect(four.completed).toBe(true);
        expect(four.finishedAt).toBeLessThan(3.7);
        expect(four.hints[0]).toBe('Jolt your phone or tap the egg');
      }
    }
  });

  it('keeps screen tapping at twenty hits and combines taps with motion', () => {
    function taps(limit: number) {
      let count = 0;
      return (_time: number, frame: number) => frame % 6 === 0 && count++ < limit;
    }
    const nineteen = play('egg', 2.5, false, () => ({}), taps(19));
    expect(nineteen.progress).toBe(0.95);
    expect(nineteen.completed).toBe(false);
    expect(play('egg', 3, false, () => ({}), taps(20)).completed).toBe(true);
    const mixed = play('egg', 2.2, true, flicks(0.8, { x: 0, y: 0 }, 1), taps(10));
    expect(mixed.progress).toBe(1);
    expect(mixed.completed).toBe(true);
  });

  it('does not count impacts when motion is off', () => {
    const result = play('egg', 5, false, flicks(0.8, { x: 0, y: 1 }, 1));
    expect(result.progress).toBe(0);
    expect(result.completed).toBe(false);
  });

  it('seals impact damage one crack at a time after the existing idle delay', () => {
    const once = (_time: number, frame: number): Partial<PhoneMotion> =>
      frame === 48 ? { flick: { direction: { x: 0, y: 0 }, strength: 1 } } : {};
    expect(play('egg', 2.4, true, once).progress).toBe(0.25);
    expect(play('egg', 2.7, true, once).progress).toBe(0.2);
    expect(play('egg', 5.6, true, once).progress).toBe(0);
  });

  it('does not crack the egg when held at a steady lean', () => {
    const result = play('egg', 5, true, () => ({ tilt: { x: 0.5, y: 0.8 } }));
    expect(result.progress).toBe(0);
  });

  it('does not crack the egg from rocking or sustained force without an impact', () => {
    const shaken = play('egg', 5, true, (time) => ({ ...rocking(8)(time), force: 20 }));
    expect(shaken.progress).toBe(0);
    const jiggled = play('egg', 5, true, (time) => ({ ...rocking(3)(time), turned: 0 }));
    expect(jiggled.progress).toBe(0);
  });

  it('opens the present after two sharp flicks for each notch', () => {
    const result = play('present', 10, true, flicks(0.8, { x: 0.6, y: -0.8 }, 1));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(5);
    expect(result.hints[0]).toBe('Flick your phone or pull the ribbon');
    expect(result.hints).toContain('Nearly there');
  });

  it('takes more flicks to open the present when they are gentle', () => {
    const result = play('present', 10, true, flicks(0.8, { x: 0.6, y: -0.8 }, 0));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(7.5);
  });

  it('lets the ribbon work back when the flicks come too slowly', () => {
    const result = play('present', 10, true, flicks(2.5, { x: 0.6, y: -0.8 }, 0));
    expect(result.completed).toBe(false);
    expect(result.progress).toBeLessThan(1 / 3);
  });

  it('snaps the cracker after six sharp flicks, with or without a direction', () => {
    for (const direction of [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]) {
      const result = play('cracker', 10, true, flicks(0.8, direction, 1));
      expect(result.completed).toBe(true);
      expect(result.finishedAt).toBeGreaterThan(5);
    }
  });

  it('takes twice as many flicks to snap the cracker when they are gentle', () => {
    const result = play('cracker', 15, true, flicks(0.8, { x: 1, y: 0 }, 0));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(9.5);
  });

  it('keeps the on-screen wording while the phone reports nothing', () => {
    const expected: Record<RevealKind, string> = {
      egg: 'Tap the egg',
      jack: 'Turn the handle',
      present: 'Pull the ribbon',
      cracker: 'Pull one end',
      globe: 'Shake the snow globe',
    };
    for (const kind of REVEAL_KINDS) {
      const result = play(kind, 3, false, () => ({}));
      expect(new Set(result.hints)).toEqual(new Set([expected[kind]]));
      expect(result.progress).toBe(0);
    }
  });
});
