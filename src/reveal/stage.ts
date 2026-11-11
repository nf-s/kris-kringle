import { CONFETTI_COLORS, clamp, rand } from './draw';
import type { Point, Reveal, RevealFactory, Stage } from './engine';
import { createParticles } from './particles';
import type { Sfx } from './sfx';

export interface StageOptions {
  canvas: HTMLCanvasElement;
  receiverName: string;
  factory: RevealFactory;
  sfx: Sfx;
  onHint(text: string): void;
  onProgress(value: number): void;
  onComplete(): void;
}

export interface StageHandle {
  destroy(): void;
}

interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
}

const CONFETTI_CANNON_SECONDS = 1.6;
const CONFETTI_DRIZZLE_SECONDS = 9;

export function createStage(options: StageOptions): StageHandle {
  const { canvas, sfx } = options;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  const particles = createParticles();
  let width = 0;
  let height = 0;
  let time = 0;
  let shakeAmount = 0;
  let completedAt: number | null = null;
  let drizzleDebt = 0;
  let frame = 0;
  let lastTimestamp: number | null = null;
  /** Only the first finger down is tracked; extra touches are ignored. */
  let activePointer: number | null = null;

  const stage: Stage = {
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get time() {
      return time;
    },
    get completed() {
      return completedAt !== null;
    },
    receiverName: options.receiverName,
    particles,
    sfx,
    shake(amount) {
      shakeAmount = Math.min(30, shakeAmount + amount);
    },
    haptic(pattern) {
      if ('vibrate' in navigator) navigator.vibrate(pattern);
    },
    setHint: options.onHint,
    setProgress(value) {
      options.onProgress(clamp(value, 0, 1));
    },
    complete(origin) {
      if (completedAt !== null) return;
      completedAt = time;
      options.onProgress(1);
      sfx.fanfare();
      particles.burst({
        x: origin.x,
        y: origin.y,
        count: 90,
        colors: CONFETTI_COLORS,
        shapes: ['rect', 'rect', 'circle', 'star'],
        speed: [250, 900],
        size: [7, 14],
        life: [1.6, 3.2],
        gravity: 700,
        drag: 1.2,
      });
      options.onComplete();
    },
  };

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();

  const snow: Snowflake[] = Array.from({ length: 70 }, () => ({
    x: Math.random(),
    y: Math.random(),
    radius: rand(1.2, 4.2),
    speed: rand(0.02, 0.06),
    phase: rand(0, Math.PI * 2),
  }));

  const reveal: Reveal = options.factory(stage);

  function toPoint(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handleDown(event: PointerEvent): void {
    event.preventDefault();
    sfx.unlock();
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    reveal.onPointerDown?.(toPoint(event));
  }

  function handleMove(event: PointerEvent): void {
    if (activePointer !== null && event.pointerId !== activePointer) return;
    reveal.onPointerMove?.(toPoint(event), activePointer !== null);
  }

  function handleUp(event: PointerEvent): void {
    // iOS only allows audio to start from the end of a touch.
    sfx.unlock();
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    reveal.onPointerUp?.(toPoint(event));
  }

  /** Stops the browser scrolling, zooming or opening a menu while someone is playing. */
  function suppress(event: Event): void {
    event.preventDefault();
  }

  function emitConfetti(dt: number): void {
    if (completedAt === null) return;
    const elapsed = time - completedAt;
    const scale = clamp(Math.min(width, height) / 600, 0.7, 1.5);
    if (elapsed < CONFETTI_CANNON_SECONDS) {
      for (const side of [0, 1]) {
        particles.burst({
          x: side === 0 ? -10 : width + 10,
          y: height * 0.92,
          count: 4,
          colors: CONFETTI_COLORS,
          shapes: ['rect', 'rect', 'rect', 'circle', 'star'],
          angle: side === 0 ? -Math.PI * 0.32 : -Math.PI * 0.68,
          spread: Math.PI * 0.3,
          speed: [700 * scale, 1500 * scale],
          size: [7, 15],
          life: [2.4, 4.2],
          gravity: 650,
          drag: 1.1,
        });
      }
    } else if (elapsed < CONFETTI_DRIZZLE_SECONDS) {
      drizzleDebt += dt * 26;
      while (drizzleDebt >= 1) {
        drizzleDebt -= 1;
        particles.burst({
          x: rand(0, width),
          y: -20,
          count: 1,
          colors: CONFETTI_COLORS,
          shapes: ['rect', 'rect', 'circle'],
          angle: Math.PI / 2,
          spread: 0.8,
          speed: [40, 160],
          size: [7, 13],
          life: [4, 6],
          gravity: 160,
          drag: 0.9,
        });
      }
    }
  }

  function drawSnow(context: CanvasRenderingContext2D): void {
    context.fillStyle = '#ffffff';
    for (const flake of snow) {
      const x = flake.x * width + Math.sin(time * 0.6 + flake.phase) * 18;
      const y = flake.y * (height + 40) - 20;
      context.globalAlpha = 0.35 + flake.radius * 0.13;
      context.beginPath();
      context.arc(x, y, flake.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function tick(timestamp: number): void {
    frame = requestAnimationFrame(tick);
    const context = ctx;
    if (!context) return;
    const dt = lastTimestamp === null ? 0.016 : Math.min(0.033, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    time += dt;

    for (const flake of snow) {
      flake.y += flake.speed * dt * (0.6 + flake.radius * 0.25);
      if (flake.y > 1) {
        flake.y = 0;
        flake.x = Math.random();
      }
    }
    reveal.update(dt);
    emitConfetti(dt);
    particles.update(dt);
    shakeAmount *= Math.pow(0.002, dt);

    context.clearRect(0, 0, width, height);
    drawSnow(context);
    context.save();
    if (shakeAmount > 0.2) {
      context.translate(rand(-shakeAmount, shakeAmount), rand(-shakeAmount, shakeAmount));
    }
    reveal.draw(context);
    context.restore();
    particles.draw(context);
  }

  canvas.addEventListener('pointerdown', handleDown);
  canvas.addEventListener('pointermove', handleMove);
  canvas.addEventListener('pointerup', handleUp);
  canvas.addEventListener('pointercancel', handleUp);
  canvas.addEventListener('touchstart', suppress, { passive: false });
  canvas.addEventListener('contextmenu', suppress);
  document.addEventListener('gesturestart', suppress);
  window.addEventListener('resize', resize);
  frame = requestAnimationFrame(tick);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', handleDown);
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerup', handleUp);
      canvas.removeEventListener('pointercancel', handleUp);
      canvas.removeEventListener('touchstart', suppress);
      canvas.removeEventListener('contextmenu', suppress);
      document.removeEventListener('gesturestart', suppress);
      window.removeEventListener('resize', resize);
    },
  };
}
