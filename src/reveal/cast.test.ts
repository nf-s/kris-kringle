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

  it('keeps all nineteen full faces clear of the result panel in portrait and landscape', () => {
    const layouts: CastArea[] = [
      {
        width: 390,
        height: 844,
        top: 48,
        bottom: 697,
        object: [{ x: 195, y: 371.5, halfWidth: 119, halfHeight: 90, round: false }],
      },
      {
        width: 844,
        height: 390,
        top: 48,
        bottom: 295,
        object: [{ x: 422, y: 170.5, halfWidth: 156, halfHeight: 56.5, round: false }],
      },
    ];
    for (const area of layouts) {
      const spots = placeCast(19, area);
      expect(spots).toHaveLength(19);
      const panel = area.object[0];
      for (const spot of spots) {
        // The face extends from 5% down the sprite panel to the neck, not just its centre.
        const left = spot.x - spot.height * 0.17;
        const right = spot.x + spot.height * 0.17;
        const top = spot.baseline - spot.height * 0.9;
        const chin = spot.baseline - spot.height * 0.55;
        const overlapWidth =
          Math.min(right, panel.x + panel.halfWidth) - Math.max(left, panel.x - panel.halfWidth);
        const overlapHeight =
          Math.min(chin, panel.y + panel.halfHeight) - Math.max(top, panel.y - panel.halfHeight);
        expect(overlapWidth > 0 && overlapHeight > 0).toBe(false);
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
    cast.update(0.751, 0, false);
    cast.draw(ctx, phone([]), 20);
    expect(drawn).toHaveBeenCalled();
    expect(drawn.mock.calls.every((call) => call[2] === 'sad' && call[3] === 0)).toBe(true);

    drawn.mockClear();
    cast.activity();
    cast.update(0.1, 0.8, false);
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
    cast.update(0.875, 0.8, false);
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

describe('tapping characters', () => {
  it('toggles only the frontmost visible figure under a comfortable hit area', async () => {
    browser(true);
    const drawn = vi.spyOn(sprite, 'drawFigure');
    const cast = castModule.createCast(
      Array.from({ length: 19 }, (_, index) => `/character-${index}.png`),
    );
    const area = phone([]);
    const spots = placeCast(19, area).sort((a, b) => a.baseline - b.baseline);
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Test canvas is unavailable');
    cast.draw(ctx, area, 0);
    expect(cast.toggleAt({ x: spots[0].x, y: spots[0].baseline - spots[0].height * 0.5 })).toBe(
      false,
    );
    await Promise.resolve();
    cast.update(1, 0, false);
    cast.draw(ctx, area, 1);
    let target: { x: number; y: number; front: number } | null = null;
    for (let y = area.top; y < area.bottom && !target; y += 2) {
      for (let x = 0; x < area.width; x += 2) {
        const hits = spots.flatMap((spot, index) => {
          const within =
            Math.abs(x - spot.x) <= Math.max(22, spot.height * 0.25 + 6) &&
            y >= spot.baseline - spot.height * 0.9 - 6 &&
            y <= spot.baseline + 6;
          return within ? [index] : [];
        });
        if (hits.length > 1) {
          target = { x, y, front: hits[hits.length - 1] };
          break;
        }
      }
    }
    if (!target) throw new Error('Expected overlapping figure hit areas');
    expect(cast.toggleAt(target)).toBe(true);
    drawn.mockClear();
    cast.draw(ctx, area, 2);
    const poses = drawn.mock.calls.filter((call) => call[4] === undefined).map((call) => call[2]);
    expect(poses.filter((pose) => pose === 'sad')).toHaveLength(1);
    expect(poses[target.front]).toBe('sad');
    expect(cast.toggleAt(target)).toBe(true);
    drawn.mockClear();
    cast.draw(ctx, area, 3);
    expect(drawn.mock.calls.every((call) => call[2] === 'praying')).toBe(true);
    expect(cast.toggleAt({ x: -100, y: -100 })).toBe(false);
    cast.destroy();
    expect(cast.toggleAt(target)).toBe(false);
  });

  it('gives the foreground object priority over a figure behind it', async () => {
    browser(true);
    const cast = castModule.createCast(['/character.png']);
    await Promise.resolve();
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Test canvas is unavailable');
    for (const round of [false, true]) {
      const area = phone([{ x: 187, y: 340, halfWidth: 600, halfHeight: 600, round }]);
      const spot = placeCast(1, area)[0];
      cast.draw(ctx, area, 0);
      expect(cast.toggleAt(face(spot))).toBe(false);
    }
    cast.destroy();
  });
});

function interactiveStage() {
  const device = browser();
  const activity = vi.fn();
  const update = vi.fn();
  const toggleAt = vi.fn(() => false);
  const down = vi.fn();
  const move = vi.fn();
  const up = vi.fn();
  const draw = vi.fn<castModule.Cast['draw']>();
  const band = vi.fn(() => ({ top: 0, bottom: 650 }));
  const obstacles = vi.fn<() => readonly Shape[]>(() => []);
  const footprint = vi.fn<() => Shape[]>(() => []);
  vi.spyOn(castModule, 'createCast').mockReturnValue({
    activity,
    toggleAt,
    update,
    draw,
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
      band,
      obstacles,
    },
    receiverName: 'Receiver',
    sfx: createSfx(),
    motion,
    onHint: vi.fn(),
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    factory(stage) {
      revealStage = stage;
      return {
        footprint,
        update: vi.fn(),
        draw: vi.fn(),
        onPointerDown: down,
        onPointerMove: move,
        onPointerUp: up,
      };
    },
  });
  return {
    ...device,
    canvas,
    activity,
    update,
    toggleAt,
    down,
    move,
    up,
    draw,
    band,
    obstacles,
    footprint,
    handle,
    stage(): Stage {
      if (!revealStage) throw new Error('Reveal was not created');
      return revealStage;
    },
  };
}

describe('stage activity for the cast', () => {
  it('refreshes the cast band and interface obstacles while retaining the live object footprint', () => {
    const test = interactiveStage();
    const panel: Shape = { x: 187, y: 320, halfWidth: 150, halfHeight: 55, round: false };
    test.footprint.mockReturnValue(GLOBE);
    test.frame(0);
    expect(test.draw).toHaveBeenLastCalledWith(
      expect.anything(),
      { width: 375, height: 650, top: 0, bottom: 650, object: GLOBE },
      expect.any(Number),
    );

    test.band.mockReturnValue({ top: 80, bottom: 520 });
    test.obstacles.mockReturnValue([panel]);
    test.handle.refreshLayout();
    test.frame(16);
    expect(test.draw).toHaveBeenLastCalledWith(
      expect.anything(),
      { width: 375, height: 650, top: 80, bottom: 520, object: [...GLOBE, panel] },
      expect.any(Number),
    );

    test.footprint.mockReturnValue(CRACKER);
    test.frame(32);
    expect(test.draw).toHaveBeenLastCalledWith(
      expect.anything(),
      { width: 375, height: 650, top: 80, bottom: 520, object: [...CRACKER, panel] },
      expect.any(Number),
    );
    expect(test.band).toHaveBeenCalledTimes(2);
    expect(test.obstacles).toHaveBeenCalledTimes(2);
    test.handle.destroy();
  });

  it('consumes a character tap and its whole pointer sequence without touching the task', () => {
    const test = interactiveStage();
    test.toggleAt.mockReturnValue(true);
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 1, 10, 10));
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 100, 100));
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 2, 50, 50));
    test.canvas.dispatchEvent(new TestPointer('pointermove', 2, 60, 60));
    test.canvas.dispatchEvent(new TestPointer('pointerup', 1, 100, 100));
    expect(test.toggleAt).toHaveBeenCalledTimes(1);
    expect(test.activity).not.toHaveBeenCalled();
    expect(test.down).not.toHaveBeenCalled();
    expect(test.move).not.toHaveBeenCalled();
    expect(test.up).not.toHaveBeenCalled();
    test.toggleAt.mockReturnValue(false);
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 3, 20, 20));
    expect(test.activity).toHaveBeenCalledTimes(1);
    expect(test.down).toHaveBeenCalledTimes(1);
    test.handle.destroy();
  });

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
    expect(test.down).not.toHaveBeenCalled();
    expect(test.move).not.toHaveBeenCalled();
    test.canvas.dispatchEvent(new TestPointer('pointerup', 1, 20, 10));
    expect(test.up).not.toHaveBeenCalled();
    test.toggleAt.mockReturnValue(true);
    test.canvas.dispatchEvent(new TestPointer('pointerdown', 2, 30, 10));
    expect(test.toggleAt).toHaveBeenLastCalledWith({ x: 30, y: 10 });
    expect(test.activity).not.toHaveBeenCalled();
    test.handle.destroy();
    test.canvas.dispatchEvent(new TestPointer('pointermove', 1, 30, 10));
    expect(test.activity).not.toHaveBeenCalled();
  });
});
