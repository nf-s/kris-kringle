import {
  GOLD_GLOW_RGB,
  PALETTE,
  Spring,
  clamp,
  easeInCubic,
  easeOutCubic,
  glow,
  lerp,
  rand,
  softShadow,
  sparkle,
} from '../draw';
import type { Point, RevealFactory } from '../engine';

/** Seconds of full-intensity, back-and-forth shaking needed to fill the globe. */
const CHARGE_TIME = 8.5;
/** Charge lost per second once shaking stops. */
const CHARGE_DECAY = 0.12;
const DECAY_GRACE = 0.4;
/** Pointer speed, in design pixels per second, below which shaking does not count. */
const SHAKE_THRESHOLD = 260;
/** Charge only counts this long after the pointer last reversed direction. */
const REVERSAL_WINDOW = 0.35;
const REVERSAL_SEGMENT = 8;
/** Shaking the phone counts from this many m/s² and is at full strength `PHONE_SHAKE_RANGE` on. */
const PHONE_SHAKE_START = 4;
const PHONE_SHAKE_RANGE = 12;
/** Movement of the phone weaker than this is not an attempt at shaking. */
const PHONE_STIR = 1.5;
/** How hard the globe is thrown about by the phone's own movement. */
const PHONE_PUSH = 700;
const STAGES = 3;
const STAGE_FLOURISHES: readonly (readonly number[])[] = [
  [2, 4, 7],
  [4, 7, 9, 11],
];
const FLOURISH_GAP = 0.085;
const TAP_TIME = 0.3;
const TAP_SLOP = 12;
const COMPLETE_DELAY = 0.4;
const FLAKE_BASE = 150;
const FLAKE_EXTRA = 110;
const FLAKE_WALL = 0.9;
const FLAKE_GRAVITY = 0.4;
const PENGUIN_X = -0.08;
const PENGUIN_GRAVITY = 7;
const GIFT_MIN = -0.72;
const GIFT_MAX = 0.3;
const INK = '#2b2233';
/** Width of the ink line round the globe, in globe space. Half of it sits behind the artwork. */
const OUTLINE_WIDTH = 0.026;
/** A second, slightly misplaced pass of the ink line, so its thickness varies like a drawn one. */
const OUTLINE_DRIFT = { x: 0.003, y: -0.004, turn: 0.006, extra: 0.006 };
const GRAIN_SIZE = 384;
/** Grain texels per CSS pixel. */
const GRAIN_DENSITY = 2;
const GRAIN_DARK: readonly [number, number, number] = [30, 41, 59];
/** Outer edge of the glass, including its rim, in globe space. */
const GLASS_EDGE = 1.016;

/** Hairline cracks in globe space, each with the charge at which it starts to grow. */
const CRACKS: readonly { start: number; points: readonly Point[] }[] = [
  {
    start: 0.66,
    points: [
      { x: 0.66, y: -0.66 },
      { x: 0.54, y: -0.55 },
      { x: 0.57, y: -0.42 },
      { x: 0.45, y: -0.33 },
      { x: 0.48, y: -0.2 },
    ],
  },
  {
    start: 0.76,
    points: [
      { x: -0.9, y: 0.22 },
      { x: -0.74, y: 0.17 },
      { x: -0.71, y: 0.04 },
      { x: -0.57, y: -0.02 },
    ],
  },
  {
    start: 0.86,
    points: [
      { x: 0.2, y: -0.97 },
      { x: 0.15, y: -0.84 },
      { x: 0.25, y: -0.74 },
      { x: 0.2, y: -0.62 },
    ],
  },
];

const FLASH_SPOTS: readonly Point[] = [
  { x: -0.5, y: -0.45 },
  { x: 0.3, y: -0.6 },
  { x: 0.62, y: -0.1 },
  { x: -0.7, y: 0.05 },
  { x: 0.05, y: -0.25 },
  { x: -0.28, y: 0.3 },
  { x: 0.45, y: 0.32 },
  { x: -0.1, y: -0.78 },
];

interface Layout {
  cx: number;
  cy: number;
  radius: number;
  unit: number;
  reachX: number;
  reachUp: number;
  reachDown: number;
}

/** Snowflake in globe space: the glass is the unit circle around the origin. */
interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  drag: number;
  phase: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
}

interface Pose {
  lean: number;
  flap: number;
  wide: number;
  /** 0 calm, 0.5 seeing stars, 1 spiral eyes and a slipping hat. */
  dizzy: number;
  /** -1 looking left to 1 looking right. */
  look: number;
  wave: number;
  hop: number;
  time: number;
}

function groundY(x: number): number {
  return 0.62 + 0.035 * Math.sin(x * 2.6);
}

function makeFlake(): Flake {
  const angle = rand(0, Math.PI * 2);
  const distance = Math.sqrt(Math.random()) * 0.85;
  const x = Math.cos(angle) * distance;
  return {
    x,
    y: Math.min(Math.sin(angle) * distance, groundY(x)),
    vx: 0,
    vy: 0,
    size: rand(0.012, 0.03),
    drag: rand(1.8, 3),
    phase: rand(0, Math.PI * 2),
  };
}

function metal(ctx: CanvasRenderingContext2D, halfWidth: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(-halfWidth, 0, halfWidth, 0);
  gradient.addColorStop(0, PALETTE.goldDeep);
  gradient.addColorStop(0.22, PALETTE.gold);
  gradient.addColorStop(0.38, PALETTE.goldPale);
  gradient.addColorStop(0.62, PALETTE.gold);
  gradient.addColorStop(1, PALETTE.goldDeep);
  return gradient;
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pose: Pose,
): void {
  if (pose.dizzy > 0.6) {
    const spin = pose.time * 7;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.011;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const angle = spin + k * 0.75;
      const r = (size * 1.35 * k) / 16;
      ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    }
    ctx.stroke();
    return;
  }
  const shift = pose.look * 0.014;
  ctx.fillStyle = INK;
  ellipse(ctx, x + shift, y, size, size);
  ctx.fillStyle = PALETTE.white;
  ellipse(ctx, x + shift - size * 0.3, y - size * 0.35, size * 0.35, size * 0.35);
}

function drawHat(ctx: CanvasRenderingContext2D, pose: Pose): void {
  const slip = pose.dizzy * (0.32 + Math.sin(pose.time * 4.5) * 0.08);
  ctx.save();
  ctx.translate(0.12 * slip, -0.72);
  ctx.rotate(slip);
  ctx.translate(0, 0.72);
  ctx.fillStyle = PALETTE.red;
  ctx.beginPath();
  ctx.ellipse(0, -0.73, 0.165, 0.14, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.roundRect(-0.185, -0.76, 0.37, 0.065, 0.032);
  ctx.fill();
  ellipse(ctx, 0, -0.885, 0.05, 0.05);
  ctx.restore();
}

/** Penguin in a hat and scarf, standing with its feet at the origin. */
function drawPenguin(ctx: CanvasRenderingContext2D, pose: Pose): void {
  const { flap, wide } = pose;
  ctx.fillStyle = PALETTE.gold;
  ellipse(ctx, -0.09, -0.01, 0.08, 0.035);
  ellipse(ctx, 0.09, -0.01, 0.08, 0.035);

  const coat = ctx.createRadialGradient(-0.1, -0.5, 0.02, 0, -0.35, 0.5);
  coat.addColorStop(0, '#5d6f8c');
  coat.addColorStop(0.6, PALETTE.slateDark);
  coat.addColorStop(1, '#131c2b');
  ctx.fillStyle = coat;
  for (const side of [-1, 1]) {
    const wave = side > 0 ? pose.wave * (1.9 + Math.sin(pose.time * 16) * 0.35) : 0;
    ctx.save();
    ctx.translate(side * 0.21, -0.4);
    ctx.rotate(-side * (0.3 + flap + wave));
    ellipse(ctx, 0, 0.13, 0.055, 0.16);
    ctx.restore();
  }
  ellipse(ctx, 0, -0.3, 0.25, 0.3);
  ellipse(ctx, 0, -0.6, 0.2, 0.2);

  const belly = ctx.createLinearGradient(0, -0.5, 0, -0.03);
  belly.addColorStop(0, PALETTE.white);
  belly.addColorStop(1, PALETTE.ice);
  ctx.fillStyle = belly;
  ellipse(ctx, 0, -0.26, 0.17, 0.23);
  ctx.fillStyle = PALETTE.white;
  ellipse(ctx, -0.07, -0.59, 0.1, 0.1);
  ellipse(ctx, 0.07, -0.59, 0.1, 0.1);
  ellipse(ctx, 0, -0.54, 0.13, 0.09);

  ctx.fillStyle = 'rgba(246, 140, 160, 0.6)';
  ellipse(ctx, -0.14, -0.53, 0.04, 0.028);
  ellipse(ctx, 0.14, -0.53, 0.04, 0.028);
  const eye = 0.028 + 0.012 * wide;
  drawEye(ctx, -0.075, -0.6, eye, pose);
  drawEye(ctx, 0.075, -0.6, eye, pose);
  const beak = pose.look * 0.012;
  ctx.fillStyle = PALETTE.gold;
  ellipse(ctx, beak, -0.535, 0.045, 0.03 + 0.012 * wide);
  ctx.fillStyle = PALETTE.goldDeep;
  ctx.fillRect(beak - 0.04, -0.538, 0.08, 0.008);

  ctx.fillStyle = PALETTE.red;
  ctx.save();
  ctx.translate(0.12, -0.43);
  ctx.rotate(-0.25 - flap * 0.6);
  ctx.beginPath();
  ctx.roundRect(-0.045, 0, 0.09, 0.21, 0.02);
  ctx.fill();
  ctx.fillStyle = PALETTE.goldPale;
  ctx.fillRect(-0.045, 0.15, 0.09, 0.025);
  ctx.restore();
  const wool = ctx.createLinearGradient(0, -0.48, 0, -0.38);
  wool.addColorStop(0, PALETTE.redLight);
  wool.addColorStop(1, PALETTE.redDeep);
  ctx.fillStyle = wool;
  ctx.beginPath();
  ctx.roundRect(-0.215, -0.475, 0.43, 0.095, 0.045);
  ctx.fill();
  ctx.fillStyle = PALETTE.goldPale;
  for (const x of [-0.13, -0.03, 0.07]) ctx.fillRect(x, -0.475, 0.025, 0.095);

  drawHat(ctx, pose);

  const stars = clamp((pose.dizzy - 0.15) / 0.3, 0, 1);
  if (stars > 0) {
    for (let i = 0; i < 3; i++) {
      const angle = pose.time * 4 + (i * Math.PI * 2) / 3;
      const depth = Math.sin(angle);
      sparkle(
        ctx,
        Math.cos(angle) * 0.24,
        -0.97 + depth * 0.06,
        0.05 + depth * 0.012,
        PALETTE.gold,
        stars * (0.75 + depth * 0.25),
        pose.time * 3,
      );
    }
  }
}

function drawGift(ctx: CanvasRenderingContext2D, x: number, lean: number): void {
  ctx.save();
  ctx.translate(x, 0.63);
  ctx.rotate(lean);
  ctx.fillStyle = PALETTE.red;
  ctx.fillRect(-0.085, -0.14, 0.17, 0.14);
  ctx.fillStyle = PALETTE.redDeep;
  ctx.fillRect(-0.085, -0.14, 0.17, 0.03);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(-0.02, -0.14, 0.04, 0.14);
  ellipse(ctx, -0.03, -0.16, 0.035, 0.025);
  ellipse(ctx, 0.03, -0.16, 0.035, 0.025);
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  giftX: number,
  giftLean: number,
): void {
  const snow = ctx.createLinearGradient(0, 0.5, 0, 1);
  snow.addColorStop(0, PALETTE.white);
  snow.addColorStop(1, PALETTE.iceDeep);
  ctx.fillStyle = snow;
  ctx.beginPath();
  ctx.moveTo(-1.1, 0.68);
  ctx.quadraticCurveTo(-0.45, 0.5, 0, 0.6);
  ctx.quadraticCurveTo(0.5, 0.7, 1.1, 0.54);
  ctx.lineTo(1.1, 1.1);
  ctx.lineTo(-1.1, 1.1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(71, 85, 105, 0.16)';
  const shadowScale = 1 / (1 - pose.hop * 4);
  ellipse(ctx, PENGUIN_X, 0.63, 0.26 * shadowScale, 0.04 * shadowScale);
  ellipse(ctx, 0.5, 0.65, 0.18, 0.03);
  ellipse(ctx, giftX, 0.63, 0.12, 0.025);

  // Snowy tree.
  ctx.fillStyle = PALETTE.slate;
  ctx.fillRect(0.48, 0.52, 0.04, 0.13);
  for (let tier = 2; tier >= 0; tier--) {
    const top = 0.1 + tier * 0.13;
    const half = 0.1 + tier * 0.045;
    const needles = ctx.createLinearGradient(0.5 - half, 0, 0.5 + half, 0);
    needles.addColorStop(0, '#f4f9fd');
    needles.addColorStop(1, PALETTE.iceDeep);
    ctx.fillStyle = needles;
    ctx.beginPath();
    ctx.moveTo(0.5, top);
    ctx.lineTo(0.5 + half, top + 0.2);
    ctx.quadraticCurveTo(0.5, top + 0.24, 0.5 - half, top + 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.white;
    ctx.beginPath();
    ctx.moveTo(0.5, top);
    ctx.lineTo(0.5 + half * 0.5, top + 0.1);
    ctx.quadraticCurveTo(0.5, top + 0.06, 0.5 - half * 0.5, top + 0.1);
    ctx.closePath();
    ctx.fill();
  }
  sparkle(ctx, 0.5, 0.09, 0.07, PALETTE.gold);

  drawGift(ctx, giftX, giftLean);

  ctx.save();
  ctx.translate(PENGUIN_X, 0.63 + pose.hop);
  ctx.rotate(pose.lean);
  drawPenguin(ctx, pose);
  ctx.restore();
}

/** The base from `top` down to its rounded foot, in globe space. */
function baseBand(top: number): Path2D {
  const half = 0.7 + ((top - 0.78) / 0.52) * 0.22;
  const path = new Path2D();
  path.moveTo(-half, top);
  path.lineTo(half, top);
  path.lineTo(0.92, 1.3);
  path.quadraticCurveTo(0.92, 1.4, 0.8, 1.4);
  path.lineTo(-0.8, 1.4);
  path.quadraticCurveTo(-0.92, 1.4, -0.92, 1.3);
  path.closePath();
  return path;
}

function baseCollar(): Path2D {
  const path = new Path2D();
  path.roundRect(-0.75, 0.72, 1.5, 0.125, 0.06);
  return path;
}

function glassEdge(): Path2D {
  const path = new Path2D();
  path.arc(0, 0, GLASS_EDGE, 0, Math.PI * 2);
  return path;
}

/**
 * Dark ink line round the globe. Draw it before the artwork: the fills then cover its inner half
 * and every line where two parts overlap, leaving a single outline round the whole silhouette.
 */
function drawOutline(ctx: CanvasRenderingContext2D, glass: boolean): void {
  const parts = [baseBand(0.78), baseCollar()];
  if (glass) parts.push(glassEdge());
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineWidth = OUTLINE_WIDTH;
  for (const part of parts) ctx.stroke(part);
  ctx.translate(OUTLINE_DRIFT.x, OUTLINE_DRIFT.y);
  ctx.rotate(OUTLINE_DRIFT.turn);
  ctx.lineWidth = OUTLINE_WIDTH + OUTLINE_DRIFT.extra;
  for (const part of parts) ctx.stroke(part);
  ctx.restore();
}

let sharedGrain: HTMLCanvasElement | null = null;

/**
 * Paper grain tile: short brush strokes and fine noise, stored as faint dark and light pixels so
 * it can be laid over artwork with an ordinary fill. Strokes wrap round the edges so it repeats
 * without seams.
 */
function grainTile(): HTMLCanvasElement | null {
  if (sharedGrain) return sharedGrain;
  const tile = document.createElement('canvas');
  tile.width = GRAIN_SIZE;
  tile.height = GRAIN_SIZE;
  const ctx = tile.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, GRAIN_SIZE, GRAIN_SIZE);
  ctx.lineCap = 'round';
  const strokes = Math.round((GRAIN_SIZE * GRAIN_SIZE) / 180);
  for (let i = 0; i < strokes; i++) {
    const x = rand(0, GRAIN_SIZE);
    const y = rand(0, GRAIN_SIZE);
    const length = rand(12, 46);
    const angle = rand(-0.85, -0.15);
    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)';
    ctx.lineWidth = rand(1, 4);
    for (const wrapX of [0, -GRAIN_SIZE]) {
      for (const wrapY of [0, GRAIN_SIZE]) {
        ctx.beginPath();
        ctx.moveTo(x + wrapX, y + wrapY);
        ctx.lineTo(x + wrapX + Math.cos(angle) * length, y + wrapY + Math.sin(angle) * length);
        ctx.stroke();
      }
    }
  }
  const image = ctx.getImageData(0, 0, GRAIN_SIZE, GRAIN_SIZE);
  for (let i = 0; i < image.data.length; i += 4) {
    const offset = (image.data[i] / 255 - 0.5) * 0.3 + rand(-0.03, 0.03);
    for (let channel = 0; channel < 3; channel++) {
      image.data[i + channel] = offset < 0 ? GRAIN_DARK[channel] : 255;
    }
    image.data[i + 3] = Math.min(255, Math.abs(offset) * 290);
  }
  ctx.putImageData(image, 0, 0);
  sharedGrain = tile;
  return tile;
}

/**
 * Lays paper grain over the globe. The grain stays still on screen while the globe moves under
 * it, as it would if the globe were painted on paper.
 */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  grain: CanvasPattern,
  glass: boolean,
  pixelRatio: number,
): void {
  const silhouette = baseBand(0.78);
  silhouette.addPath(baseCollar());
  if (glass) silhouette.addPath(glassEdge());
  const scale = pixelRatio / GRAIN_DENSITY;
  ctx.save();
  ctx.clip(silhouette);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = grain;
  ctx.fillRect(0, 0, ctx.canvas.width / scale, ctx.canvas.height / scale);
  ctx.restore();
}

function drawBase(ctx: CanvasRenderingContext2D): void {
  const lacquer = ctx.createLinearGradient(-0.92, 0, 0.92, 0);
  lacquer.addColorStop(0, PALETTE.redDeep);
  lacquer.addColorStop(0.2, PALETTE.red);
  lacquer.addColorStop(0.36, PALETTE.redLight);
  lacquer.addColorStop(0.6, PALETTE.red);
  lacquer.addColorStop(1, PALETTE.redDeep);
  ctx.fillStyle = lacquer;
  ctx.fill(baseBand(0.78));
  ctx.fillStyle = metal(ctx, 0.92);
  ctx.fill(baseBand(1.23));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.beginPath();
  ctx.moveTo(-0.47, 0.88);
  ctx.lineTo(-0.4, 0.88);
  ctx.lineTo(-0.5, 1.2);
  ctx.lineTo(-0.6, 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(30, 41, 59, 0.22)';
  ctx.fillRect(-0.72, 0.84, 1.44, 0.03);
  ctx.fillStyle = metal(ctx, 0.75);
  ctx.fill(baseCollar());
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fillRect(-0.68, 0.745, 1.36, 0.018);
  sparkle(ctx, 0, 1.04, 0.12, PALETTE.goldPale);
  sparkle(ctx, -0.3, 1.05, 0.05, PALETTE.gold);
  sparkle(ctx, 0.3, 1.05, 0.05, PALETTE.gold);
}

function drawGlassShine(ctx: CanvasRenderingContext2D): void {
  const rim = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 1);
  rim.addColorStop(0, 'rgba(71, 85, 105, 0)');
  rim.addColorStop(1, 'rgba(71, 85, 105, 0.38)');
  ctx.fillStyle = rim;
  ellipse(ctx, 0, 0, 1, 1);

  ctx.save();
  ctx.translate(-0.42, -0.5);
  ctx.rotate(-0.7);
  ctx.scale(1, 0.55);
  const shine = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.36);
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = shine;
  ellipse(ctx, 0, 0, 0.36, 0.36);
  ctx.restore();

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.arc(0, 0, 0.86, Math.PI * 1.08, Math.PI * 1.36);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.arc(0, 0, 0.88, Math.PI * 0.1, Math.PI * 0.34);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ellipse(ctx, 0.52, -0.6, 0.035, 0.035);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, 0.99, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.arc(0, 0, 1.01, 0, Math.PI * 2);
  ctx.stroke();
}

/** Draws the first `growth` (0 to 1) of a crack's polyline as a bright line with a dark edge. */
function drawCrack(ctx: CanvasRenderingContext2D, points: readonly Point[], growth: number): void {
  if (growth <= 0 || points.length < 2) return;
  const reach = growth * (points.length - 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const layer of [
    { style: 'rgba(43, 34, 51, 0.35)', width: 0.022, shift: 0.008 },
    { style: 'rgba(255, 255, 255, 0.95)', width: 0.012, shift: 0 },
  ]) {
    ctx.beginPath();
    ctx.moveTo(points[0].x + layer.shift, points[0].y + layer.shift);
    for (let i = 1; i < points.length; i++) {
      const t = clamp(reach - (i - 1), 0, 1);
      if (t <= 0) break;
      const from = points[i - 1];
      const to = points[i];
      ctx.lineTo(lerp(from.x, to.x, t) + layer.shift, lerp(from.y, to.y, t) + layer.shift);
    }
    ctx.strokeStyle = layer.style;
    ctx.lineWidth = layer.width;
    ctx.stroke();
  }
}

export const createGlobe: RevealFactory = (stage) => {
  const offsetX = new Spring(0, 320, 20);
  const offsetY = new Spring(0, 320, 20);
  const tilt = new Spring(0, 140, 10);
  const look = new Spring(0, 70, 9);
  const flakes: Flake[] = Array.from({ length: FLAKE_BASE + FLAKE_EXTRA }, makeFlake);
  const ripples: Ripple[] = Array.from({ length: 4 }, () => ({ x: 0, y: 0, age: 9 }));
  const pose: Pose = { lean: 0, flap: 0, wide: 0, dizzy: 0, look: 0, wave: 0, hop: 0, time: 0 };
  let grab: Point | null = null;
  let lastPointer: Point = { x: 0, y: 0 };
  let downPoint: Point = { x: 0, y: 0 };
  let downAt = 0;
  let downTravel = 0;
  let travel = 0;
  let speed = 0;
  let intensity = 0;
  let charge = 0;
  let banked = 0;
  let shown = 0;
  let peak = 0;
  let lastChargeAt = -10;
  let segmentX = 0;
  let segmentY = 0;
  let directionX = 0;
  let directionY = 0;
  let olderX = 0;
  let olderY = 0;
  let lastReversal = -10;
  let weakFor = 0;
  let jingle = 0;
  let hapticWait = 0;
  let previousVx = 0;
  let previousVy = 0;
  let blizzard = 0;
  let flash = 0;
  let flourish: readonly number[] = [];
  let flourishIndex = 0;
  let flourishAt = 0;
  let cracksHeard = 0;
  let lookUntil = 0;
  let waveLeft = 0;
  let hopVelocity = 0;
  let giftX = -0.56;
  let giftVelocity = 0;
  let hint = idleHint();
  let nextWiggle = 2.5;
  let poppedAt: number | null = null;
  let completeSent = false;
  let grain: CanvasPattern | null = null;

  stage.setHint(hint);

  function layout(): Layout {
    const unit = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    const cx = stage.width / 2;
    const cy = stage.height * 0.52 - 26 * unit;
    const radius = 118 * unit;
    const reach = Math.min(stage.width, stage.height) * 0.3;
    return {
      cx,
      cy,
      radius,
      unit,
      reachX: clamp(cx - radius * 0.92 - 12, 16, reach),
      reachUp: clamp(cy - radius * 0.9 - 12, 16, reach),
      reachDown: clamp(stage.height - 12 - (cy + radius * 1.4), 16, reach),
    };
  }

  function idleHint(): string {
    return stage.motion.active ? 'Shake your phone or the globe' : 'Shake the snow globe';
  }

  function showHint(text: string): void {
    if (text === hint) return;
    hint = text;
    stage.setHint(text);
  }

  function bob(l: Layout): number {
    return poppedAt === null ? Math.sin(stage.time * 1.6) * 2.5 * l.unit : 0;
  }

  /** Converts a stage point into globe space, where the glass is the unit circle. */
  function toLocal(point: Point, l: Layout): Point {
    const dx = point.x - (l.cx + offsetX.value);
    const dy = point.y - (l.cy + offsetY.value + bob(l));
    const cos = Math.cos(tilt.value);
    const sin = Math.sin(tilt.value);
    return { x: (dx * cos + dy * sin) / l.radius, y: (-dx * sin + dy * cos) / l.radius };
  }

  function penguinJump(height: number): void {
    if (pose.hop < 0) return;
    hopVelocity = -Math.sqrt(2 * PENGUIN_GRAVITY * height);
  }

  function tapGlass(local: Point): void {
    stage.sfx.tap(2.6);
    stage.haptic(6);
    let oldest = ripples[0];
    for (const ripple of ripples) if (ripple.age > oldest.age) oldest = ripple;
    oldest.x = local.x;
    oldest.y = local.y;
    oldest.age = 0;
    look.target = clamp((local.x - PENGUIN_X) * 2.2, -1, 1);
    lookUntil = stage.time + 1.4;
    waveLeft = 0.9;
    penguinJump(0.09);
  }

  function tapBase(l: Layout): void {
    stage.sfx.tap(0.85);
    stage.haptic(10);
    offsetY.velocity -= 900 * l.unit;
    penguinJump(0.05);
  }

  function celebrateStage(reached: number, l: Layout): void {
    flourish = STAGE_FLOURISHES[reached - 1];
    flourishIndex = 0;
    flourishAt = stage.time;
    flash = 1;
    stage.haptic([18, 30, 18]);
    stage.shake(4 + reached * 2);
    stage.particles.burst({
      x: l.cx + offsetX.value,
      y: l.cy + offsetY.value,
      count: 14 + reached * 6,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      speed: [80, 320],
      size: [6, 13],
      life: [0.5, 1],
      gravity: 120,
      drag: 2.2,
    });
  }

  function pop(l: Layout): void {
    const x = l.cx + offsetX.value;
    const y = l.cy + offsetY.value;
    poppedAt = stage.time;
    grab = null;
    offsetX.target = 0;
    offsetY.target = 0;
    stage.setProgress(1);
    showHint('');
    stage.sfx.pop();
    stage.sfx.chime(4);
    stage.shake(18);
    stage.haptic([30, 40, 70]);
    stage.particles.burst({
      x,
      y,
      count: 70,
      colors: [PALETTE.white, PALETTE.ice],
      shapes: ['circle'],
      speed: [120, 760],
      size: [4, 11],
      life: [0.9, 1.8],
      gravity: 420,
      drag: 1.6,
    });
    stage.particles.burst({
      x,
      y,
      count: 30,
      colors: [PALETTE.white, PALETTE.ice, PALETTE.iceDeep],
      shapes: ['shard'],
      speed: [260, 900],
      size: [8, 20],
      life: [0.7, 1.4],
      gravity: 1400,
    });
    stage.particles.burst({
      x,
      y,
      count: 30,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      speed: [150, 700],
      size: [8, 20],
      life: [0.7, 1.5],
      gravity: 200,
      drag: 2,
    });
  }

  function activeFlakes(): number {
    return FLAKE_BASE + Math.round(blizzard * FLAKE_EXTRA);
  }

  function updateFlakes(dt: number, l: Layout): void {
    const pushX = clamp((offsetX.velocity - previousVx) / dt / l.radius, -45, 45);
    const pushY = clamp((offsetY.velocity - previousVy) / dt / l.radius, -45, 45);
    previousVx = offsetX.velocity;
    previousVy = offsetY.velocity;
    const stir = (Math.hypot(pushX, pushY) * 0.6 + intensity * 3) * (1 + blizzard * 2);
    const swirl = clamp(tilt.value * 9, -3, 3) + blizzard * 1.6;
    const slide = Math.sin(tilt.value) * 2.4;
    const count = activeFlakes();
    for (let i = 0; i < count; i++) {
      const flake = flakes[i];
      flake.vx += (-pushX * 0.8 - flake.y * swirl + rand(-1, 1) * stir) * dt;
      flake.vy += (-pushY * 0.8 + flake.x * swirl + rand(-1, 1) * stir + FLAKE_GRAVITY) * dt;
      flake.vx += Math.sin(stage.time * 2 + flake.phase) * 0.12 * dt;
      const damping = Math.exp(-flake.drag * dt);
      flake.vx = clamp(flake.vx * damping, -5, 5);
      flake.vy = clamp(flake.vy * damping, -5, 5);
      flake.x += flake.vx * dt;
      flake.y += flake.vy * dt;

      const distance = Math.hypot(flake.x, flake.y);
      if (distance > FLAKE_WALL) {
        const nx = flake.x / distance;
        const ny = flake.y / distance;
        flake.x = nx * FLAKE_WALL;
        flake.y = ny * FLAKE_WALL;
        const outward = flake.vx * nx + flake.vy * ny;
        if (outward > 0) {
          flake.vx -= outward * nx * 1.5;
          flake.vy -= outward * ny * 1.5;
        }
      }
      const ground = groundY(flake.x);
      if (flake.y > ground) {
        flake.y = ground;
        flake.vy = Math.min(flake.vy, 0);
        flake.vx += slide * dt;
        flake.vx *= Math.exp(-5 * dt);
      }
    }
  }

  function updateGift(dt: number): void {
    giftVelocity += Math.sin(tilt.value) * 3.2 * dt;
    giftVelocity *= Math.exp(-2.4 * dt);
    giftX += giftVelocity * dt;
    if (giftX < GIFT_MIN || giftX > GIFT_MAX) {
      giftX = clamp(giftX, GIFT_MIN, GIFT_MAX);
      if (Math.abs(giftVelocity) > 0.25) stage.sfx.tap(1.9);
      giftVelocity *= -0.35;
    }
  }

  function updatePenguin(dt: number): void {
    if (stage.time > lookUntil) look.target = 0;
    look.update(dt);
    waveLeft = Math.max(0, waveLeft - dt);
    if (pose.hop < 0 || hopVelocity < 0) {
      hopVelocity += PENGUIN_GRAVITY * dt;
      pose.hop += hopVelocity * dt;
      if (pose.hop >= 0) {
        pose.hop = 0;
        hopVelocity = 0;
      }
    }
    pose.dizzy = lerp(pose.dizzy, banked / (STAGES - 1), 1 - Math.exp(-dt * 2.5));
    blizzard = lerp(
      blizzard,
      Math.max(banked / (STAGES - 1), intensity * 0.6),
      1 - Math.exp(-dt * 2),
    );
  }

  function updateFlourish(): void {
    while (
      flourishIndex < flourish.length &&
      stage.time >= flourishAt + flourishIndex * FLOURISH_GAP
    ) {
      stage.sfx.chime(flourish[flourishIndex]);
      flourishIndex += 1;
    }
  }

  function trackDirection(point: Point): void {
    segmentX += point.x - lastPointer.x;
    segmentY += point.y - lastPointer.y;
    const length = Math.hypot(segmentX, segmentY);
    if (length < REVERSAL_SEGMENT) return;
    const nx = segmentX / length;
    const ny = segmentY / length;
    if (nx * directionX + ny * directionY < -0.2 || nx * olderX + ny * olderY < -0.2) {
      lastReversal = stage.time;
    }
    olderX = directionX;
    olderY = directionY;
    directionX = nx;
    directionY = ny;
    segmentX = 0;
    segmentY = 0;
  }

  function updateShake(dt: number, l: Layout): void {
    speed = lerp(speed, travel / dt / l.unit, 1 - Math.exp(-dt * 10));
    travel = 0;
    const dragged = grab === null ? 0 : clamp((speed - SHAKE_THRESHOLD) / 900, 0, 1);
    const phone = clamp((stage.motion.force - PHONE_SHAKE_START) / PHONE_SHAKE_RANGE, 0, 1);
    intensity = Math.max(dragged, phone);
    const reversing = stage.time - lastReversal < REVERSAL_WINDOW;
    const shaking = intensity > 0.05 && (reversing || phone > 0.05);
    if (shaking) {
      charge += (intensity * dt) / CHARGE_TIME;
      lastChargeAt = stage.time;
    } else if (stage.time - lastChargeAt > DECAY_GRACE) {
      charge -= CHARGE_DECAY * dt;
    }
    charge = clamp(charge, banked / STAGES, 1);
    peak = Math.max(peak, charge);
    if (Math.abs(charge - shown) > 0.004) {
      shown = charge;
      stage.setProgress(charge);
    }

    const trying = (grab !== null && speed > 60) || stage.motion.force > PHONE_STIR;
    weakFor = trying && !shaking ? weakFor + dt : 0;
    if (weakFor > 0.4) showHint(intensity > 0.05 ? 'Shake back and forth' : 'Shake harder');
    else if (charge > 0.75) showHint('Nearly there');
    else if (charge > 0 && (shaking || grab === null)) showHint('Keep shaking');
    else if (charge === 0 && grab === null) showHint(idleHint());

    jingle += intensity * dt;
    if (jingle > 0.16) {
      jingle = 0;
      stage.sfx.tap(rand(1.5, 2.4));
    }
    hapticWait -= dt;
    if (shaking && intensity > 0.6 && hapticWait <= 0) {
      hapticWait = 0.16;
      stage.haptic(12);
    }

    while (cracksHeard < CRACKS.length && peak >= CRACKS[cracksHeard].start) {
      cracksHeard += 1;
      stage.sfx.crack(0.25 + cracksHeard * 0.12);
    }
    const reached = Math.min(STAGES - 1, Math.floor(charge * STAGES));
    if (charge >= 1) pop(l);
    else if (reached > banked) {
      banked = reached;
      celebrateStage(reached, l);
    }
  }

  function drawRipples(ctx: CanvasRenderingContext2D): void {
    for (const ripple of ripples) {
      if (ripple.age > 0.6) continue;
      const t = ripple.age / 0.6;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * (1 - t)})`;
      ctx.lineWidth = 0.02 * (1 - t) + 0.004;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 0.04 + t * 0.26, 0, Math.PI * 2);
      ctx.stroke();
      sparkle(ctx, ripple.x, ripple.y, 0.09 * (1 - t), PALETTE.white, 1 - t, t * 2);
    }
  }

  function drawSphere(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createRadialGradient(-0.2, -0.3, 0.1, 0, 0, 1);
    sky.addColorStop(0, '#f6fbff');
    sky.addColorStop(0.6, '#d3e3f2');
    sky.addColorStop(1, '#a4bdd8');
    ctx.fillStyle = sky;
    ellipse(ctx, 0, 0, 1, 1);

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 0.97, 0, Math.PI * 2);
    ctx.clip();
    pose.time = stage.time;
    pose.look = look.value;
    pose.wide = Math.max(intensity, pose.dizzy * 0.6);
    pose.flap = intensity * 0.9 + Math.sin(stage.time * 2.2) * 0.06;
    pose.wave = clamp(waveLeft / 0.25, 0, 1);
    pose.lean =
      -tilt.value * 0.5 +
      Math.sin(stage.time * 22) * 0.05 * intensity +
      Math.sin(stage.time * 4.5) * 0.16 * pose.dizzy +
      look.value * 0.08;
    drawScene(ctx, pose, giftX, -tilt.value * 0.4 + giftVelocity * 0.3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    const count = activeFlakes();
    for (let i = 0; i < count; i++) {
      const flake = flakes[i];
      ellipse(ctx, flake.x, flake.y, flake.size, flake.size);
    }
    if (blizzard > 0.05) {
      ctx.fillStyle = `rgba(240, 246, 252, ${0.22 * blizzard})`;
      ellipse(ctx, 0, 0, 1, 1);
    }
    if (flash > 0) {
      for (let i = 0; i < FLASH_SPOTS.length; i++) {
        const spot = FLASH_SPOTS[i];
        const size = (0.06 + (i % 3) * 0.03) * easeOutCubic(flash * 1.6) * flash;
        sparkle(
          ctx,
          spot.x,
          spot.y,
          size,
          i % 2 === 0 ? PALETTE.goldPale : PALETTE.white,
          1,
          stage.time * 2,
        );
      }
    }
    drawRipples(ctx);
    ctx.restore();
    glow(ctx, 0, 0.1, 1, GOLD_GLOW_RGB, 0.5 * charge + 0.4 * flash);
    drawGlassShine(ctx);
    for (const crack of CRACKS) {
      if (peak < crack.start) continue;
      drawCrack(ctx, crack.points, 0.25 + (0.75 * (peak - crack.start)) / (1 - crack.start));
    }
  }

  function release(point: Point): void {
    if (grab === null) return;
    const quick = stage.time - downAt < TAP_TIME;
    const still =
      Math.max(downTravel, Math.hypot(point.x - downPoint.x, point.y - downPoint.y)) < TAP_SLOP;
    grab = null;
    offsetX.target = 0;
    offsetY.target = 0;
    if (!quick || !still || poppedAt !== null) return;
    const l = layout();
    const local = toLocal(point, l);
    if (Math.hypot(local.x, local.y) <= 1) tapGlass(local);
    else if (local.y > 0.7 && local.y < 1.5 && Math.abs(local.x) < 1) tapBase(l);
  }

  return {
    update(dt) {
      if (dt <= 0) return;
      const l = layout();
      if (grab === null && poppedAt === null) {
        offsetX.velocity += stage.motion.push.x * PHONE_PUSH * l.unit * dt;
        offsetY.velocity += stage.motion.push.y * PHONE_PUSH * l.unit * dt;
      }
      offsetX.update(dt);
      offsetY.update(dt);
      tilt.target = clamp(
        (offsetX.velocity / l.unit) * 0.0007 + (offsetX.value / l.radius) * 0.3,
        -0.45,
        0.45,
      );
      tilt.update(dt);
      flash = Math.max(0, flash - dt * 1.5);
      for (const ripple of ripples) ripple.age += dt;
      updateFlourish();
      if (poppedAt !== null) {
        if (!completeSent && stage.time - poppedAt > COMPLETE_DELAY) {
          completeSent = true;
          stage.complete({ x: l.cx, y: l.cy });
        }
        return;
      }
      if (charge === 0 && grab === null) {
        nextWiggle -= dt;
        if (nextWiggle < 0) {
          tilt.velocity += rand(-2.4, 2.4);
          nextWiggle = rand(2.2, 3.6);
        }
      }
      updatePenguin(dt);
      updateGift(dt);
      updateFlakes(dt, l);
      updateShake(dt, l);
    },
    draw(ctx) {
      const l = layout();
      const pixelRatio = ctx.getTransform().a;
      const elapsed = poppedAt === null ? 0 : stage.time - poppedAt;
      const fade = 1 - easeOutCubic((elapsed - 0.25) / 0.6);
      if (poppedAt !== null) {
        const flare = 0.9 * (1 - clamp(elapsed / 1.1, 0, 1));
        glow(ctx, l.cx, l.cy, l.radius * (1.5 + elapsed * 5), GOLD_GLOW_RGB, flare);
      }
      if (fade <= 0) return;
      const lift = clamp(-offsetY.value / (l.radius * 2), -0.2, 0.5);
      softShadow(
        ctx,
        l.cx + offsetX.value * 0.8,
        l.cy + l.radius * 1.42,
        l.radius * (1.2 - lift * 0.4),
        l.radius * 0.17,
        0.28 * fade * (1 - lift * 0.6),
      );
      const drop = easeInCubic((elapsed - 0.2) / 0.6) * l.radius * 1.4;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(l.cx + offsetX.value, l.cy + offsetY.value + bob(l) + drop);
      ctx.rotate(tilt.value);
      ctx.scale(l.radius, l.radius);
      glow(ctx, 0, 0, 1.3 + 0.5 * charge, GOLD_GLOW_RGB, 0.55 * charge);
      const glass = 1 - clamp(elapsed / 0.3, 0, 1);
      const intact = poppedAt === null;
      drawOutline(ctx, intact);
      if (glass > 0) {
        const swell = 1 + easeOutCubic(elapsed / 0.3) * 0.25;
        ctx.save();
        ctx.globalAlpha = fade * glass;
        ctx.scale(swell, swell);
        drawSphere(ctx);
        ctx.restore();
        glow(ctx, 0, 0, 1.7, '255, 255, 255', poppedAt === null ? 0 : 0.9 * glass);
      }
      drawBase(ctx);
      if (!grain) {
        const tile = grainTile();
        grain = tile ? ctx.createPattern(tile, 'repeat') : null;
      }
      if (grain) drawGrain(ctx, grain, intact, pixelRatio);
      ctx.restore();
    },
    onPointerDown(point) {
      if (poppedAt !== null) return;
      const l = layout();
      const x = l.cx + offsetX.value;
      const y = l.cy + offsetY.value + l.radius * 0.3;
      if (Math.hypot(point.x - x, point.y - y) > l.radius * 1.7) return;
      grab = { x: point.x - offsetX.value, y: point.y - offsetY.value };
      lastPointer = point;
      downPoint = point;
      downAt = stage.time;
      downTravel = 0;
      segmentX = 0;
      segmentY = 0;
      directionX = 0;
      directionY = 0;
      olderX = 0;
      olderY = 0;
      stage.haptic(8);
    },
    onPointerMove(point, down) {
      if (!down || grab === null) return;
      travel += Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y);
      downTravel = Math.max(downTravel, Math.hypot(point.x - downPoint.x, point.y - downPoint.y));
      trackDirection(point);
      lastPointer = point;
      const l = layout();
      offsetX.target = clamp(point.x - grab.x, -l.reachX, l.reachX);
      offsetY.target = clamp(point.y - grab.y, -l.reachUp, l.reachDown);
    },
    onPointerUp: release,
  };
};
