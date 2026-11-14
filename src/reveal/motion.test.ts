import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionSensor, type Flick, type MotionSensor } from './motion';

interface Reading {
  x: number;
  y: number;
  z: number;
}

interface Rate {
  alpha: number;
  beta: number;
  gamma: number;
}

type Listener = (event: object) => void;

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Version/19.0 Mobile Safari';
/** Milliseconds between readings, as a phone sends them. */
const STEP = 16;

/** Stands in for the browser of a phone. `permission` is its answer each time it is asked. */
function phone(agent: string, permission?: () => Promise<string>) {
  const listeners: Listener[] = [];
  const motionEvent = permission ? { requestPermission: permission } : {};
  vi.stubGlobal('DeviceMotionEvent', motionEvent);
  vi.stubGlobal('window', {
    DeviceMotionEvent: motionEvent,
    addEventListener(_type: string, listener: Listener) {
      listeners.push(listener);
    },
  });
  vi.stubGlobal('navigator', { userAgent: agent, maxTouchPoints: 5 });
  vi.stubGlobal('screen', {});
  let now = 0;
  return {
    send(acceleration: Reading, rate: Rate | null = { alpha: 0, beta: 0, gamma: 0 }): void {
      now += STEP;
      for (const listener of listeners) {
        listener({
          accelerationIncludingGravity: acceleration,
          rotationRate: rate,
          timeStamp: now,
        });
      }
    },
  };
}

/** Lets the sensor hear back from a permission request. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Sends `seconds` of readings, a frame at a time, and returns the sum of `sensor.motion.turned`. */
function hold(
  device: ReturnType<typeof phone>,
  sensor: MotionSensor,
  seconds: number,
  at: (time: number) => { acceleration: Reading; rate?: Rate | null },
): number {
  let turned = 0;
  for (let time = 0; time < seconds; time += STEP / 1000) {
    const { acceleration, rate } = at(time);
    device.send(acceleration, rate);
    sensor.advance(STEP / 1000);
    turned += sensor.motion.turned;
  }
  return turned;
}

const UPRIGHT_ANDROID = { x: 0, y: 9.81, z: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('motion sensor', () => {
  it('is unavailable until the phone reports a reading', () => {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    const changes: string[] = [];
    sensor.onChange = () => changes.push(sensor.state);
    expect(sensor.state).toBe('unavailable');
    sensor.advance(0.016);
    expect(sensor.motion.active).toBe(false);
    device.send(UPRIGHT_ANDROID);
    expect(sensor.state).toBe('on');
    expect(changes).toEqual(['on']);
  });

  it('ignores readings with nothing in them', () => {
    const listeners: Listener[] = [];
    vi.stubGlobal('DeviceMotionEvent', {});
    vi.stubGlobal('window', {
      DeviceMotionEvent: {},
      addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 });
    vi.stubGlobal('screen', {});
    const sensor = createMotionSensor();
    for (const listener of listeners) {
      listener({ accelerationIncludingGravity: null, rotationRate: null, timeStamp: 1 });
      listener({
        accelerationIncludingGravity: { x: null, y: null, z: null },
        rotationRate: null,
        timeStamp: 2,
      });
    }
    expect(sensor.state).toBe('unavailable');
  });

  it('reads which way is down on Android and on iOS', () => {
    const android = phone(ANDROID);
    const onAndroid = createMotionSensor();
    hold(android, onAndroid, 1, () => ({ acceleration: { x: -4.9, y: 8.5, z: 0 } }));
    expect(onAndroid.motion.tilt.x).toBeCloseTo(0.5, 1);
    expect(onAndroid.motion.tilt.y).toBeCloseTo(0.87, 1);
    vi.unstubAllGlobals();

    const iphone = phone(IPHONE);
    const onIphone = createMotionSensor();
    hold(iphone, onIphone, 1, () => ({ acceleration: { x: 4.9, y: -8.5, z: 0 } }));
    expect(onIphone.motion.tilt.x).toBeCloseTo(0.5, 1);
    expect(onIphone.motion.tilt.y).toBeCloseTo(0.87, 1);
  });

  it('reports shaking as force and lets it fade', () => {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    hold(device, sensor, 0.5, () => ({ acceleration: UPRIGHT_ANDROID }));
    expect(sensor.motion.force).toBeLessThan(0.5);
    hold(device, sensor, 1, (time) => ({
      acceleration: { x: Math.sin(time * 30) * 22, y: 9.81, z: 0 },
    }));
    expect(sensor.motion.force).toBeGreaterThan(10);
    hold(device, sensor, 1, () => ({ acceleration: UPRIGHT_ANDROID }));
    expect(sensor.motion.force).toBeLessThan(0.5);
  });

  /** Every flick reported over two seconds in which the phone is jolted sideways once. */
  function jolted(size: number): Flick[] {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    hold(device, sensor, 0.5, () => ({ acceleration: UPRIGHT_ANDROID }));
    const flicks: Flick[] = [];
    for (let time = 0; time < 2; time += STEP / 1000) {
      const jolt = time > 0.5 && time < 0.6 ? -size : 0;
      device.send({ x: jolt, y: 9.81, z: 0 });
      sensor.advance(STEP / 1000);
      if (sensor.motion.flick) flicks.push(sensor.motion.flick);
    }
    return flicks;
  }

  it('reports one flick for one sharp movement', () => {
    const flicks = jolted(22);
    expect(flicks).toHaveLength(1);
    expect(flicks[0].direction.x).toBeCloseTo(1, 1);
    expect(flicks[0].strength).toBeGreaterThan(0.3);
    expect(flicks[0].strength).toBeLessThan(0.6);
  });

  it('reports one flick per brief impact and rearms between vertical and screen-normal pulses', () => {
    for (const direction of [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]) {
      const device = phone(ANDROID);
      const sensor = createMotionSensor();
      hold(device, sensor, 0.5, () => ({ acceleration: UPRIGHT_ANDROID }));
      const flicks: Flick[] = [];
      const pulse = [30, 18, -5];
      for (let impact = 0; impact < 4; impact++) {
        // A sharp onset, a small rebound, then stillness before the next tap-like movement.
        for (let frame = 0; frame < 50; frame++) {
          const acceleration = pulse[frame] ?? 0;
          device.send({
            x: direction.x * acceleration,
            y: 9.81 + direction.y * acceleration,
            z: direction.z * acceleration,
          });
          sensor.advance(STEP / 1000);
          if (sensor.motion.flick) flicks.push(sensor.motion.flick);
        }
        expect(flicks).toHaveLength(impact + 1);
      }
      if (direction.z !== 0) {
        expect(flicks.every((flick) => flick.direction.x === 0 && flick.direction.y === 0)).toBe(
          true,
        );
      }
    }
  });

  it('reports a sharper flick as stronger, up to a limit', () => {
    expect(jolted(60)[0].strength).toBe(1);
  });

  it('does not count a nudge as a flick', () => {
    expect(jolted(10)).toHaveLength(0);
  });

  it('does not count carrying the phone about as a flick', () => {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    let flicks = 0;
    for (let time = 0; time < 3; time += STEP / 1000) {
      device.send({ x: Math.sin(time * 8) * 3, y: 9.81 + Math.sin(time * 5) * 2, z: 1 });
      sensor.advance(STEP / 1000);
      if (sensor.motion.flick) flicks += 1;
    }
    expect(flicks).toBe(0);
  });

  it('adds up how far the phone is twisted, about any axis', () => {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    const turned = hold(device, sensor, 1, () => ({
      acceleration: UPRIGHT_ANDROID,
      rate: { alpha: 0, beta: 0, gamma: 180 },
    }));
    expect(turned).toBeGreaterThan(2.4);
    expect(turned).toBeLessThan(Math.PI);
    const resting = hold(device, sensor, 1, () => ({
      acceleration: UPRIGHT_ANDROID,
      rate: { alpha: 8, beta: 6, gamma: 5 },
    }));
    expect(resting).toBe(0);
  });

  it('works out twisting from gravity on a phone with no gyroscope', () => {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    const turned = hold(device, sensor, 1.5, (time) => {
      const angle = Math.min(time, 1) * (Math.PI / 2);
      return {
        acceleration: { x: Math.sin(angle) * 9.81, y: Math.cos(angle) * 9.81, z: 0 },
        rate: null,
      };
    });
    expect(turned).toBeGreaterThan(0.7);
    expect(turned).toBeLessThan(Math.PI / 2);
  });

  it('can be turned off and on again', () => {
    const device = phone(ANDROID);
    const sensor = createMotionSensor();
    device.send(UPRIGHT_ANDROID);
    sensor.toggle();
    expect(sensor.state).toBe('off');
    const turned = hold(device, sensor, 0.5, (time) => ({
      acceleration: { x: Math.sin(time * 30) * 22, y: 9.81, z: 0 },
      rate: { alpha: 0, beta: 0, gamma: 300 },
    }));
    expect(sensor.motion.active).toBe(false);
    expect(sensor.motion.force).toBe(0);
    expect(turned).toBe(0);
    sensor.toggle();
    expect(sensor.state).toBe('on');
  });

  it('needs no asking where the browser gives permission straight away', async () => {
    const device = phone(ANDROID, () => Promise.resolve('granted'));
    const sensor = createMotionSensor();
    await settle();
    expect(sensor.state).toBe('unavailable');
    device.send(UPRIGHT_ANDROID);
    expect(sensor.state).toBe('on');
  });

  it('asks from a tap where the browser only gives permission then', async () => {
    let tapped = false;
    let asked = 0;
    const device = phone(IPHONE, () => {
      asked += 1;
      return tapped ? Promise.resolve('granted') : Promise.reject(new Error('Needs a tap'));
    });
    const sensor = createMotionSensor();
    await settle();
    expect(sensor.state).toBe('off');
    tapped = true;
    sensor.toggle();
    await settle();
    expect(asked).toBe(2);
    device.send({ x: 0, y: -9.81, z: 0 });
    expect(sensor.state).toBe('on');
  });

  it('gives up when the person refuses', async () => {
    let tapped = false;
    phone(IPHONE, () =>
      tapped ? Promise.resolve('denied') : Promise.reject(new Error('Needs a tap')),
    );
    const sensor = createMotionSensor();
    await settle();
    tapped = true;
    sensor.toggle();
    await settle();
    expect(sensor.state).toBe('unavailable');
  });
});
