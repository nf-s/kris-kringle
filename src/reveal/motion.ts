import { clamp } from './draw';
import type { Point } from './engine';

/** How the phone itself is being moved. Every reading is at rest until `active`. */
export interface Motion {
  /** True while the phone is reporting its movement and the person has not turned it off. */
  readonly active: boolean;
  /**
   * Which way things on the screen would fall, as a share of gravity: x right, y down. A phone
   * held upright reads about (0, 1) and one lying flat about (0, 0).
   */
  readonly tilt: Point;
  /**
   * The pull felt from being moved, with gravity taken out, in m/s² along the screen. It points
   * the way loose things inside the phone are thrown, against the movement itself.
   */
  readonly push: Point;
  /** How hard the phone is being moved in any direction, in m/s². Fades over a moment. */
  readonly force: number;
  /** Radians the phone has turned, about any axis, since the last frame. */
  readonly turned: number;
  /**
   * Set for the one frame in which the phone is flicked: the direction along the screen, or
   * (0, 0) for a flick straight towards or away from the person.
   */
  readonly flick: Point | null;
}

/**
 * `unavailable` until the device reports movement or turns out to need the person's permission
 * first, which leaves it `off` until they give it.
 */
export type MotionState = 'unavailable' | 'off' | 'on';

export interface MotionSensor {
  readonly motion: Motion;
  readonly state: MotionState;
  /**
   * Turns movement on or off. Turning it on asks the person's permission where the device
   * needs it, which only works from inside a tap.
   */
  toggle(): void;
  /** Called whenever `state` changes. One listener at a time. */
  onChange: (() => void) | null;
  /** Starts a frame: `motion` then covers the `dt` seconds since the last call. */
  advance(dt: number): void;
}

interface Vector {
  x: number;
  y: number;
  z: number;
}

const GRAVITY = 9.81;
/** Seconds over which the steady pull of gravity is told apart from movement. */
const GRAVITY_SETTLE = 0.25;
/** How fast `force` fades once the phone is still, per second. */
const FORCE_FADE = 6;
/** Turning slower than this, in radians per second, is a hand holding the phone, not a twist. */
const TURN_FLOOR = 0.5;
/** A flick starts when the movement passes `FLICK_START` m/s² and can repeat once it has dropped
 *  below `FLICK_END` and `FLICK_GAP` seconds have gone by. */
const FLICK_START = 9;
const FLICK_END = 4;
const FLICK_GAP = 0.6;
/** A flick weaker than this along the screen has no direction worth reporting. */
const FLICK_AIM = 3;
/** Longest gap between two readings that still counts as continuous, in seconds. */
const MAX_STEP = 0.1;

const STILL: Point = { x: 0, y: 0 };

function reading(source: DeviceMotionEventAcceleration | null): Vector | null {
  if (!source) return null;
  const { x, y, z } = source;
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

/** Speed of rotation about any axis, in radians per second, where the phone has a gyroscope. */
function turnRate(source: DeviceMotionEventRotationRate | null): number | null {
  if (!source) return null;
  const { alpha, beta, gamma } = source;
  if (alpha === null || beta === null || gamma === null) return null;
  return (Math.hypot(alpha, beta, gamma) * Math.PI) / 180;
}

function angleBetween(a: Vector, b: Vector): number {
  const lengths = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (lengths === 0) return 0;
  return Math.acos(clamp((a.x * b.x + a.y * b.y + a.z * b.z) / lengths, -1, 1));
}

/**
 * A vector in the phone's own axes (x to its right, y to its top) as it lies along the screen
 * (x right, y down), whichever way up the page is being shown.
 */
function alongScreen(vector: Vector): Point {
  const angle = 'orientation' in screen ? screen.orientation.angle : 0;
  if (angle === 90) return { x: -vector.y, y: -vector.x };
  if (angle === 180) return { x: -vector.x, y: vector.y };
  if (angle === 270) return { x: vector.y, y: vector.x };
  return { x: vector.x, y: -vector.y };
}

/**
 * Asks for permission to read the phone's movement, where the browser has such a request, and
 * resolves to whether it was given. iOS only gives it from inside a tap and rejects otherwise;
 * browsers that need no permission answer yes straight away.
 */
function permissionRequest(): (() => Promise<boolean>) | null {
  if (!('DeviceMotionEvent' in window)) return null;
  const request: unknown = Reflect.get(DeviceMotionEvent, 'requestPermission');
  if (typeof request !== 'function') return null;
  return async () => {
    const answer: unknown = await request.call(DeviceMotionEvent);
    return answer === 'granted';
  };
}

/**
 * iOS reports the pull of gravity itself. Every other platform reports the force holding the
 * phone up against it, which points the opposite way. Nothing in the readings tells the two
 * apart, so this goes by the browser's name; an iPad may call itself a Mac with a touch screen.
 */
function reportsGravityItself(): boolean {
  const agent = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  );
}

export function createMotionSensor(): MotionSensor {
  const request = permissionRequest();
  const sign = reportsGravityItself() ? 1 : -1;
  let enabled = true;
  /** True once a reading has arrived. */
  let live = false;
  /** True when the browser will only give permission from inside a tap. */
  let mustAsk = false;
  let lastEventAt: number | null = null;
  let gravity: Vector = { x: 0, y: 0, z: 0 };
  let peak = 0;
  let peakPush: Point = STILL;
  let turnedSoFar = 0;
  let flicked: Point | null = null;
  let flickArmed = true;
  let lastFlickAt = -Infinity;

  let tilt: Point = STILL;
  let push: Point = STILL;
  let force = 0;
  let turned = 0;
  let flick: Point | null = null;

  function state(): MotionState {
    if (live) return enabled ? 'on' : 'off';
    return mustAsk ? 'off' : 'unavailable';
  }

  function handle(event: DeviceMotionEvent): void {
    const raw = reading(event.accelerationIncludingGravity);
    if (!raw) return;
    const felt = { x: raw.x * sign, y: raw.y * sign, z: raw.z * sign };
    const seconds =
      lastEventAt === null ? 0 : clamp((event.timeStamp - lastEventAt) / 1000, 0, MAX_STEP);
    lastEventAt = event.timeStamp;
    if (!live) {
      live = true;
      gravity = felt;
      sensor.onChange?.();
    }

    const before = gravity;
    const blend = 1 - Math.exp(-seconds / GRAVITY_SETTLE);
    gravity = {
      x: gravity.x + (felt.x - gravity.x) * blend,
      y: gravity.y + (felt.y - gravity.y) * blend,
      z: gravity.z + (felt.z - gravity.z) * blend,
    };
    const moved = { x: felt.x - gravity.x, y: felt.y - gravity.y, z: felt.z - gravity.z };
    const strength = Math.hypot(moved.x, moved.y, moved.z);
    if (strength > peak) {
      peak = strength;
      peakPush = alongScreen(moved);
    }

    const rate =
      turnRate(event.rotationRate) ?? (seconds > 0 ? angleBetween(before, gravity) / seconds : 0);
    turnedSoFar += Math.max(0, rate - TURN_FLOOR) * seconds;

    if (strength < FLICK_END) flickArmed = true;
    const sinceFlick = (event.timeStamp - lastFlickAt) / 1000;
    if (flickArmed && strength > FLICK_START && sinceFlick > FLICK_GAP) {
      flickArmed = false;
      lastFlickAt = event.timeStamp;
      const aim = alongScreen(moved);
      const length = Math.hypot(aim.x, aim.y);
      flicked = length < FLICK_AIM ? STILL : { x: aim.x / length, y: aim.y / length };
    }
  }

  const sensor: MotionSensor = {
    motion: {
      get active() {
        return live && enabled;
      },
      get tilt() {
        return tilt;
      },
      get push() {
        return push;
      },
      get force() {
        return force;
      },
      get turned() {
        return turned;
      },
      get flick() {
        return flick;
      },
    },
    get state() {
      return state();
    },
    toggle() {
      if (live) {
        enabled = !enabled;
        sensor.onChange?.();
        return;
      }
      if (!request || !mustAsk) return;
      // A refusal cannot be asked again, so the control goes. The pointer still does everything.
      const refused = (): void => {
        mustAsk = false;
        sensor.onChange?.();
      };
      request().then((granted) => {
        if (!granted) refused();
      }, refused);
    },
    onChange: null,
    advance(dt) {
      const moving = live && enabled;
      const along = alongScreen(gravity);
      tilt = moving
        ? { x: clamp(along.x / GRAVITY, -1, 1), y: clamp(along.y / GRAVITY, -1, 1) }
        : STILL;
      push = moving ? peakPush : STILL;
      force = moving ? Math.max(peak, force * Math.exp(-dt * FORCE_FADE)) : 0;
      turned = moving ? turnedSoFar : 0;
      flick = moving ? flicked : null;
      peak = 0;
      peakPush = STILL;
      turnedSoFar = 0;
      flicked = null;
    },
  };

  if ('DeviceMotionEvent' in window) window.addEventListener('devicemotion', handle);
  // Outside a tap this only succeeds where no permission is needed, so a rejection means the
  // person has to be asked, and an answer of no means they already refused.
  request?.().then(
    () => undefined,
    () => {
      mustAsk = true;
      sensor.onChange?.();
    },
  );
  return sensor;
}
