import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sprite from '../characters/sprite';
import * as castModule from './cast';
import { placeCast, type CastArea, type Placement } from './cast';
import type { Shape, Stage } from './engine';
import type { MotionSensor } from './motion';
import { createSfx } from './sfx';
import { createStage } from './stage';

/** A phone held upright, with room for the heading above the band and the hint below it. */
function phone(object: Shape[]): CastArea {
  return { width: 375, height: 650, top: 116, bottom: 570, object };
}

const GLOBE: Shape[] = [
  { x: 187, y: 315, halfWidth: 105, halfHeight: 105, round: true },
  { x: 187, y: 430, halfWidth: 100, halfHeight: 33, round: false },
];
const CRACKER: Shape[] = [
  { x: 187, y: 338, halfWidth: 80, halfHeight: 30, round: false },
  { x: 74, y: 349, halfWidth: 33, halfHeight: 34, round: false },
  { x: 300, y: 327, halfWidth: 33, halfHeight: 34, round: false },
];

/** The middle of a figure's face. */
function face(spot: Placement): { x: number; y: number } {
  return { x: spot.x, y: spot.baseline - spot.height * 0.72 };
}

function inside(point: { x: number; y: number }, shape: Shape): boolean {
  const dx = (point.x - shape.x) / shape.halfWidth;
  const dy = (point.y - shape.y) / shape.halfHeight;
  return shape.round ? dx * dx + dy * dy < 1 : Math.abs(dx) < 1 && Math.abs(dy) < 1;
}

describe('placing the cast', () => {
  it('stands nobody where there is nobody to stand', () => {
    expect(placeCast(0, phone(GLOBE))).toEqual([]);
  });

  it('keeps every face out from behind the object on a phone', () => {
    for (const object of [GLOBE, CRACKER]) {
      const spots = placeCast(19, phone(object));
      expect(spots).toHaveLength(19);
      for (const spot of spots) {
        expect(object.some((shape) => inside(face(spot), shape))).toBe(false);
      }
    }
  });

  it('keeps every figure on the screen and inside the band', () => {
    const area = phone(GLOBE);
    for (const spot of placeCast(19, area)) {
      expect(spot.x - spot.height * 0.25).toBeGreaterThanOrEqual(0);
      expect(spot.x + spot.height * 0.25).toBeLessThanOrEqual(area.width);
      expect(spot.baseline).toBeLessThanOrEqual(area.bottom);
      expect(spot.baseline - spot.height).toBeGreaterThanOrEqual(area.top - 1);
    }
  });

  it('makes the figures larger when there are fewer of them', () => {
    const few = placeCast(6, phone(GLOBE));
    const many = placeCast(18, phone(GLOBE));
    expect(few[0].height).toBeGreaterThan(many[0].height);
  });

  it('does not let a wide object shrink the figures much below what a small one allows', () => {
    const open = Math.max(...placeCast(18, phone([])).map((spot) => spot.height));
    const round = Math.max(...placeCast(18, phone(GLOBE)).map((spot) => spot.height));
    expect(round).toBeGreaterThan(open * 0.75);
    expect(round).toBeGreaterThan(90);
  });

  it('stands the figures evenly either side of the middle when nothing is in the way', () => {
    const area = { width: 1200, height: 800, top: 120, bottom: 720, object: [] };
    const spots = placeCast(12, area);
    for (let index = 0; index < 6; index++) {
      const mirror = spots[11 - index];
      expect(Math.abs(spots[index].x + mirror.x - area.width)).toBeLessThan(12);
      expect(Math.abs(spots[index].baseline - mirror.baseline)).toBeLessThan(12);
    }
  });
});

/** Only the canvas operations these tests exercise; browser-facing calls retain their DOM types. */
class TestCanvas extends EventTarget {
  width = 0;
  height = 0;
  readonly context = {
    canvas: this,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    transform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  };
  setPointerCapture = vi.fn();
  getContext() {
    return this.context;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 375, height: 650 };
  }
}

class TestPointer extends Event {
  constructor(
    type: string,
    readonly pointerId: number,
    readonly clientX: number,
    readonly clientY: number,
  ) {
    super(type, { cancelable: true });
  }
}

function browser(reducedMotion = false, imageHeight = 1440) {
  const page = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => new TestCanvas(),
  });
  vi.stubGlobal('document', page);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: reducedMotion }),
    }),
  );
  vi.stubGlobal('navigator', {});
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1152;
      naturalHeight = imageHeight;
      decode() {
        return Promise.resolve();
      }
    },
  );
  let callback: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
    callback = next;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return {
    visibility(hidden: boolean) {
      page.hidden = hidden;
      page.dispatchEvent(new Event('visibilitychange'));
    },
    frame(timestamp: number) {
      if (!callback) throw new Error('No frame was requested');
      callback(timestamp);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drawing sadness', () => {
  it('changes poses with reduced motion while keeping the head and body still', async () => {
    browser(true);
    const drawn = vi.spyOn(sprite, 'drawFigure');
    const cast = castModule.createCast(['/character.png']);
    await Promise.resolve();
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Test canvas is unavailable');
    cast.update(1, 0, false);
    cast.draw(ctx, phone([]), 10);
    expect(drawn.mock.calls.every((call) => call[2] === 'praying' && call[3] === 0)).toBe(true);

    drawn.mockClear();
    cast.activity();
    cast.update(4.01, 0, false);
    cast.draw(ctx, phone([]), 20);
    expect(drawn).toHaveBeenCalled();
    expect(drawn.mock.calls.every((call) => call[2] === 'sad' && call[3] === 0)).toBe(true);

    drawn.mockClear();
    cast.activity();
    cast.update(1, 0.8, false);
    cast.draw(ctx, phone([]), 30);
    expect(drawn.mock.calls.every((call) => call[2] === 'wailing' && call[3] === 0)).toBe(true);
    cast.update(1, 1, true);
    cast.draw(ctx, phone([]), 40);
    expect(vi.mocked(ctx.rotate).mock.calls.every((call) => call[0] === 0)).toBe(true);
    cast.destroy();
  });

  it('crossfades complete progress and sad figures during the gentle transition', async () => {
    browser();
    const drawn = vi.spyOn(sprite, 'drawFigure');
    const cast = castModule.createCast(['/character.png']);
    await Promise.resolve();
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Test canvas is unavailable');
    cast.activity();
    cast.update(4.45, 0.8, false);
    cast.draw(ctx, phone([]), 10);
    expect(drawn.mock.calls.map((call) => call[2])).toEqual(['wailing', 'wailing', 'sad', 'sad']);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    cast.destroy();
  });

  it('leaves out decoded images whose dimensions are not a supported sprite sheet', async () => {
    browser(false, 100);
    const drawn = vi.spyOn(sprite, 'drawFigure');
    const cast = castModule.createCast(['/invalid.png']);
    await Promise.resolve();
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Test canvas is unavailable');
    cast.update(1, 0.8, false);
    cast.draw(ctx, phone([]), 10);
    expect(drawn).not.toHaveBeenCalled();
    cast.destroy();
  });
});

function interactiveStage() {
  const device = browser();
  const activity = vi.fn();
  const update = vi.fn();
  vi.spyOn(castModule, 'createCast').mockReturnValue({
    activity,
    update,
    draw: vi.fn(),
    destroy: vi.fn(),
  });
  const canvas = document.createElement('canvas');
  const motion: MotionSensor = {
    motion: {
      active: true,
      tilt: { x: 0, y: 1 },
      push: { x: 0, y: 0 },
      force: 0,
      turned: 0,
      flick: null,
    },
    state: 'on',
    onChange: null,
    toggle: vi.fn(),
    advance: vi.fn(),
  };
  let revealStage: Stage | null = null;
  const handle = createStage({
    canvas,
    cast: {
      canvas: document.createElement('canvas'),
      images: [],
      band: () => ({ top: 0, bottom: 650 }),
    },
    receiverName: 'Receiver',
    sfx: createSfx(),
    motion,
    onHint: vi.fn(),
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    factory(stage) {
      revealStage = stage;
      return { footprint: () => [], update: vi.fn(), draw: vi.fn() };
    },
  });
  return {
    ...device,
    canvas,
    activity,
    update,
    handle,
    stage(): Stage {
      if (!revealStage) throw new Error('Reveal was not created');
      return revealStage;
    },
  };
}

describe('stage activity for the cast', () => {
  it('counts a press, held movement and progress increases but ignores hover and no-op input', () => {
    const test = interactiveStage();
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 10, 10));
    test.stage().setProgress(0);
    expect(test.activity).not.toHaveBeenCalled();
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 1, 10, 10));
    expect(test.activity).toHaveBeenCalledTimes(1);
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 10, 10));
    test.canvas.dispatchEvent(new TestPointer('pointermove', 2, 20, 20));
    test.frame(0);
    test.frame(5000);
    expect(test.activity).toHaveBeenCalledTimes(1);
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 20, 10));
    expect(test.activity).toHaveBeenCalledTimes(2);
    test.canvas.dispatchEvent(new TestPointer('pointerup', 1, 20, 10));
    test.stage().setProgress(0.2);
    expect(test.activity).toHaveBeenCalledTimes(3);
    test.stage().setProgress(0.2);
    test.stage().setProgress(0.1);
    expect(test.activity).toHaveBeenCalledTimes(3);
    test.handle.destroy();
  });

  it('excludes hidden time and hidden input, without losing visible elapsed time to the frame cap', () => {
    const test = interactiveStage();
    test.frame(0);
    test.frame(3000);
    expect(test.update).toHaveBeenLastCalledWith(0.033, 0, false, 3);
    test.visibility(true);
    test.stage().setProgress(0.2);
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 1, 10, 10));
    expect(test.activity).not.toHaveBeenCalled();
    test.frame(10000);
    test.frame(20000);
    expect(test.update).toHaveBeenLastCalledWith(0.033, 0.2, false, 0);
    test.visibility(false);
    test.frame(60000);
    expect(test.update).toHaveBeenLastCalledWith(0.016, 0.2, false, 0);
    test.frame(61000);
    expect(test.update).toHaveBeenLastCalledWith(0.033, 0.2, false, 1);
    test.handle.destroy();
  });

  it('does not apply a long frame gap to activity received just before that frame', () => {
    const test = interactiveStage();
    test.frame(0);
    test.stage().setProgress(0.2);
    test.frame(10000);
    expect(test.update).toHaveBeenLastCalledWith(0.033, 0.2, false, 0);
    test.frame(11000);
    expect(test.update).toHaveBeenLastCalledWith(0.033, 0.2, false, 1);
    test.handle.destroy();
  });

  it('does not register activity after completion and removes handlers when destroyed', () => {
    const test = interactiveStage();
    test.stage().complete({ x: 100, y: 100 });
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 1, 10, 10));
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 20, 10));
    test.stage().setProgress(0.8);
    test.stage().setProgress(0.9);
    expect(test.activity).not.toHaveBeenCalled();
    test.handle.destroy();
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 30, 10));
    expect(test.activity).not.toHaveBeenCalled();
  });
});
