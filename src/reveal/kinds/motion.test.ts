import { describe, expect, it } from 'vitest';
import { REVEAL_KINDS, type RevealKind } from '../../../shared/schema';
import type { Point, Stage } from '../engine';
import type { Motion } from '../motion';
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
  flick: Point | null;
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
    reveal.update(FRAME);
    time += FRAME;
  }
  return { completed, progress, hints, finishedAt: time };
}

/** One flick every `gap` seconds, in the direction given. */
function flicks(gap: number, direction: Point) {
  const every = Math.round(gap / FRAME);
  return (_time: number, frame: number): Partial<PhoneMotion> =>
    frame > 0 && frame % every === 0 ? { flick: direction } : {};
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
    const result = play('jack', 20, true, () => ({ turned: 8 * FRAME }));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(4);
    expect(result.hints[0]).toBe('Twist your phone or turn the handle');
  });

  it('cracks the egg when rocked from side to side', () => {
    const result = play('egg', 20, true, (time) => ({
      tilt: { x: Math.sin(time * 9) * 0.4, y: 0.9 },
    }));
    expect(result.completed).toBe(true);
    expect(result.hints[0]).toBe('Rock your phone or tap the egg');
  });

  it('does not crack the egg when held at a steady lean', () => {
    const result = play('egg', 5, true, () => ({ tilt: { x: 0.5, y: 0.8 } }));
    expect(result.progress).toBe(0);
  });

  it('opens the present after three flicks', () => {
    const result = play('present', 10, true, flicks(0.8, { x: 0.6, y: -0.8 }));
    expect(result.completed).toBe(true);
    expect(result.finishedAt).toBeGreaterThan(2.3);
    expect(result.hints[0]).toBe('Flick your phone or pull the ribbon');
    expect(result.hints).toContain('One more flick or pull');
  });

  it('snaps the cracker after four flicks, with or without a direction', () => {
    for (const direction of [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]) {
      const result = play('cracker', 10, true, flicks(0.8, direction));
      expect(result.completed).toBe(true);
      expect(result.finishedAt).toBeGreaterThan(3.1);
    }
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
