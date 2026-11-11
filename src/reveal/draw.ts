export const PALETTE = {
  red: '#d6263f',
  redDeep: '#a3142b',
  redLight: '#ef5b6f',
  gold: '#e8b33c',
  goldDeep: '#b8842a',
  goldPale: '#f7dc8b',
  cream: '#fbf4e6',
  creamShade: '#d9c4ab',
  pink: '#f6a6b8',
  ice: '#dbe7f3',
  iceDeep: '#a9bfd6',
  slate: '#475569',
  slateDark: '#1e293b',
  slateLight: '#94a3b8',
  white: '#ffffff',
};

export const CONFETTI_COLORS: readonly string[] = [
  PALETTE.red,
  PALETTE.gold,
  PALETTE.goldPale,
  PALETTE.pink,
  PALETTE.slate,
  PALETTE.iceDeep,
  PALETTE.white,
];

export const GOLD_GLOW_RGB = '255, 214, 120';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

export function easeInCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * c;
}

export function easeOutBack(t: number): number {
  const c = clamp(t, 0, 1);
  const s = 1.70158;
  return 1 + (s + 1) * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2);
}

/** Damped spring. Kick it by adding to `velocity`, or move `target`. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private readonly stiffness: number;
  private readonly damping: number;

  constructor(initial: number, stiffness: number, damping: number) {
    this.value = initial;
    this.target = initial;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  update(dt: number): void {
    const force = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
  }
}

/** Soft elliptical contact shadow on the studio floor. */
export function softShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  alpha = 0.28,
): void {
  if (radiusX <= 0 || radiusY <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, radiusY / radiusX);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  gradient.addColorStop(0, `rgba(30, 41, 59, ${alpha})`);
  gradient.addColorStop(0.6, `rgba(30, 41, 59, ${alpha * 0.45})`);
  gradient.addColorStop(1, 'rgba(30, 41, 59, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Four-point sparkle. */
export function sparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 1,
  rotation = 0,
): void {
  if (radius <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const inner = radius * 0.22;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.lineTo(Math.cos(angle + Math.PI / 4) * inner, Math.sin(angle + Math.PI / 4) * inner);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Radial glow, for light spilling out of an opened object. `rgb` is "r, g, b". */
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rgb: string,
  alpha: number,
): void {
  if (radius <= 0 || alpha <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  gradient.addColorStop(0.4, `rgba(${rgb}, ${alpha * 0.4})`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
