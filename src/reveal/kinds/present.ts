import {
  GOLD_GLOW_RGB,
  OUTLINE_WEIGHT,
  PALETTE,
  Spring,
  clamp,
  easeInCubic,
  easeOutCubic,
  glow,
  inkOutline,
  lerp,
  rand,
  softShadow,
  sparkle,
} from '../draw';
import type { Point, RevealFactory } from '../engine';

const COMPLETE_DELAY = 0.4;
/** Tugs needed to undo the knot. */
const NOTCHES = 3;
/** Keep pull distances this far clear of the stage edges, in pixels. */
const EDGE = 12;
/** Seconds of playing with the box, without touching the ribbon, before the tassel pulses harder. */
const NUDGE_AFTER = 6;
/** Pixels per second squared at scale 1. */
const GRAVITY = 2600;
const TAP_TIME = 0.35;
const TAP_SLOP = 10;

/** Design units, relative to the centre of the box's base. Negative y is up. */
const BODY = { halfWidth: 95, height: 150 };
const LID = { halfWidth: 106, top: -192, height: 46 };
const KNOT_Y = LID.top;
const LID_CENTRE_Y = LID.top + LID.height / 2;
const TAIL_REST: Point = { x: 46, y: -84 };
const TAIL_DROOP: Point = { x: 29, y: -58 };
const SHORT_TAIL: readonly [Point, Point, Point] = [
  { x: 0, y: KNOT_Y },
  { x: -52, y: KNOT_Y - 4 },
  { x: -60, y: KNOT_Y + 74 },
];

interface Layout {
  cx: number;
  floorY: number;
  scale: number;
  /** Pull distance for the first tug, before it is capped by the room on stage. */
  base: number;
}

/** Where the box is drawn: base centre, lean, and squash and stretch factors. */
interface Pose {
  x: number;
  y: number;
  angle: number;
  sx: number;
  sy: number;
}

interface RibbonGrab {
  kind: 'ribbon';
  anchor: Point;
  /** Tassel displacement when the grab began. */
  start: Point;
  /** Where the tassel is being dragged to, as a displacement from rest. */
  target: Point;
  threshold: number;
}

interface BoxGrab {
  kind: 'box';
  part: 'box' | 'lid';
  start: Point;
  /** Box offset when the grab began. */
  origin: Point;
  target: Point;
  startedAt: number;
  moved: boolean;
  lastX: number;
  lastTime: number;
  direction: number;
  peakSpeed: number;
}

type Grab = RibbonGrab | BoxGrab;

interface Opened {
  at: number;
  knot: Point;
  end: Point;
  direction: Point;
  lidSide: number;
}

function hintFor(notches: number): string {
  if (notches === 0) return 'Pull the ribbon';
  if (notches === 1) return 'Pull again';
  return 'One more pull';
}

/** Soft limit: follows `value` near zero and eases towards `range`. */
function rubber(value: number, range: number): number {
  return range * Math.tanh(value / range);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapGradient(
  ctx: CanvasRenderingContext2D,
  halfWidth: number,
  light: string,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(-halfWidth, 0, halfWidth, 0);
  gradient.addColorStop(0, PALETTE.redDeep);
  gradient.addColorStop(0.2, PALETTE.red);
  gradient.addColorStop(0.4, light);
  gradient.addColorStop(0.62, PALETTE.red);
  gradient.addColorStop(1, PALETTE.redDeep);
  return gradient;
}

function satinGradient(ctx: CanvasRenderingContext2D, from: Point, to: Point): CanvasGradient {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, PALETTE.goldDeep);
  gradient.addColorStop(0.25, PALETTE.gold);
  gradient.addColorStop(0.5, PALETTE.goldPale);
  gradient.addColorStop(0.75, PALETTE.gold);
  gradient.addColorStop(1, PALETTE.goldDeep);
  return gradient;
}

/** Satin ribbon drawn as a quadratic curve with an edge, a sheen and a highlight. */
function strokeRibbon(
  ctx: CanvasRenderingContext2D,
  from: Point,
  control: Point,
  to: Point,
  width: number,
): void {
  const layers: readonly { style: string | CanvasGradient; width: number; shift: number }[] = [
    { style: PALETTE.goldDeep, width, shift: 0 },
    { style: satinGradient(ctx, from, to), width: width * 0.74, shift: 0 },
    { style: 'rgba(255, 255, 255, 0.55)', width: width * 0.16, shift: -width * 0.16 },
  ];
  ctx.lineCap = 'round';
  for (const layer of layers) {
    ctx.beginPath();
    ctx.moveTo(from.x + layer.shift, from.y + layer.shift);
    ctx.quadraticCurveTo(
      control.x + layer.shift,
      control.y + layer.shift,
      to.x + layer.shift,
      to.y + layer.shift,
    );
    ctx.strokeStyle = layer.style;
    ctx.lineWidth = layer.width;
    ctx.stroke();
  }
}

function bodyPath(ctx: CanvasRenderingContext2D): void {
  roundedRect(ctx, -BODY.halfWidth, -BODY.height, BODY.halfWidth * 2, BODY.height, 14);
}

function lidPath(ctx: CanvasRenderingContext2D): void {
  roundedRect(ctx, -LID.halfWidth, LID.top, LID.halfWidth * 2, LID.height, 11);
}

/** One loop of the bow, from the knot round and back. Add it to a path that has been begun. */
function bowLoop(ctx: CanvasRenderingContext2D): void {
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(18, -48, 76, -54, 72, -16);
  ctx.bezierCurveTo(70, 10, 24, 10, 0, 0);
}

/** Ink round a ribbon drawn by `strokeRibbon` with the same points and width. */
function outlineRibbon(
  ctx: CanvasRenderingContext2D,
  from: Point,
  control: Point,
  to: Point,
  width: number,
  weight: number,
): void {
  inkOutline(
    ctx,
    weight,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    },
    width,
  );
}

/** Ink round the bow drawn by `drawBow` with the same arguments. */
function outlineBow(
  ctx: CanvasRenderingContext2D,
  scaleX: number,
  scaleY: number,
  droop: number,
): void {
  inkOutline(ctx, OUTLINE_WEIGHT, () => {
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(droop);
      ctx.scale(scaleX, scaleY);
      bowLoop(ctx);
      ctx.restore();
    }
  });
  inkOutline(ctx, OUTLINE_WEIGHT, () => roundedRect(ctx, -14, -13, 28, 26, 9));
}

/** Ink round the tassel drawn by `drawTassel` at the same place. */
function outlineTassel(
  ctx: CanvasRenderingContext2D,
  end: Point,
  angle: number,
  scale: number,
): void {
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.scale(scale, scale);
  ctx.rotate(angle - Math.PI / 2);
  inkOutline(
    ctx,
    OUTLINE_WEIGHT,
    () => {
      ctx.beginPath();
      for (let strand = -2; strand <= 2; strand++) {
        ctx.moveTo(strand * 1.5, 6);
        ctx.lineTo(strand * 4.5, 27 - Math.abs(strand) * 1.5);
      }
    },
    3.2,
  );
  inkOutline(ctx, OUTLINE_WEIGHT, () => {
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
  });
  ctx.restore();
}

function drawBand(ctx: CanvasRenderingContext2D, top: number, height: number): void {
  ctx.fillStyle = satinGradient(ctx, { x: -17, y: 0 }, { x: 17, y: 0 });
  ctx.fillRect(-17, top, 34, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(-6, top, 3, height);
}

function drawBody(ctx: CanvasRenderingContext2D, open: boolean): void {
  const { halfWidth, height } = BODY;
  bodyPath(ctx);
  ctx.fillStyle = wrapGradient(ctx, halfWidth, PALETTE.redLight);
  ctx.fill();

  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  ctx.fillStyle = PALETTE.goldPale;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 8; col++) {
      const x = -86 + col * 26 + (row % 2) * 13;
      const y = -132 + row * 24;
      if (Math.abs(x) < 24 || x > halfWidth) continue;
      if ((row + col) % 3 === 0) {
        sparkle(ctx, x, y, 5.5, PALETTE.goldPale, 0.9, 0.3);
      } else {
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  drawBand(ctx, -height, height);

  const floorShade = ctx.createLinearGradient(0, -height * 0.5, 0, 0);
  floorShade.addColorStop(0, 'rgba(60, 8, 20, 0)');
  floorShade.addColorStop(1, 'rgba(60, 8, 20, 0.34)');
  ctx.fillStyle = floorShade;
  ctx.fillRect(-halfWidth, -height, halfWidth * 2, height);
  const lidShade = ctx.createLinearGradient(0, -height, 0, -height + 24);
  lidShade.addColorStop(0, 'rgba(60, 8, 20, 0.45)');
  lidShade.addColorStop(1, 'rgba(60, 8, 20, 0)');
  ctx.fillStyle = lidShade;
  ctx.fillRect(-halfWidth, -height, halfWidth * 2, 24);
  ctx.restore();

  roundedRect(ctx, -halfWidth + 12, -height + 22, 9, height - 48, 4.5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();

  if (!open) return;
  const light = ctx.createLinearGradient(0, -height - 8, 0, -height + 10);
  light.addColorStop(0, PALETTE.white);
  light.addColorStop(1, PALETTE.goldPale);
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(0, -height + 1, halfWidth - 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLid(ctx: CanvasRenderingContext2D): void {
  const { halfWidth, top, height } = LID;
  lidPath(ctx);
  ctx.fillStyle = wrapGradient(ctx, halfWidth, '#f57686');
  ctx.fill();
  ctx.save();
  lidPath(ctx);
  ctx.clip();
  drawBand(ctx, top, height);
  const lip = ctx.createLinearGradient(0, top + height - 12, 0, top + height);
  lip.addColorStop(0, 'rgba(60, 8, 20, 0)');
  lip.addColorStop(1, 'rgba(60, 8, 20, 0.36)');
  ctx.fillStyle = lip;
  ctx.fillRect(-halfWidth, top + height - 12, halfWidth * 2, 12);
  ctx.restore();
  roundedRect(ctx, -halfWidth + 12, top + 6, halfWidth * 2 - 24, 5, 2.5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.fill();
}

/** Bow loops and knot, with the origin at the knot. `droop` tips the loops down, in radians. */
function drawBow(
  ctx: CanvasRenderingContext2D,
  scaleX: number,
  scaleY: number,
  droop: number,
): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(droop);
    ctx.scale(scaleX, scaleY);
    ctx.beginPath();
    bowLoop(ctx);
    const satin = ctx.createRadialGradient(34, -34, 2, 38, -22, 52);
    satin.addColorStop(0, '#fff3c4');
    satin.addColorStop(0.35, PALETTE.goldPale);
    satin.addColorStop(0.7, PALETTE.gold);
    satin.addColorStop(1, PALETTE.goldDeep);
    ctx.fillStyle = satin;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, -5);
    ctx.bezierCurveTo(24, -28, 54, -34, 56, -16);
    ctx.bezierCurveTo(54, -4, 28, 0, 12, -5);
    ctx.fillStyle = 'rgba(150, 100, 24, 0.5)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16, -27);
    ctx.quadraticCurveTo(38, -47, 61, -35);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
  roundedRect(ctx, -14, -13, 28, 26, 9);
  const knot = ctx.createLinearGradient(0, -13, 0, 13);
  knot.addColorStop(0, PALETTE.goldPale);
  knot.addColorStop(0.5, PALETTE.gold);
  knot.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = knot;
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.ellipse(-4, -6, 5, 3, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawTassel(
  ctx: CanvasRenderingContext2D,
  end: Point,
  angle: number,
  scale: number,
  pulse: number,
  strong: boolean,
): void {
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.scale(scale, scale);
  if (pulse > 0) {
    const rings = strong ? [pulse, (pulse + 0.5) % 1] : [pulse];
    for (const ring of rings) {
      ctx.beginPath();
      ctx.arc(0, 0, 15 + ring * (strong ? 28 : 14), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - ring)})`;
      ctx.lineWidth = strong ? 4 : 3;
      ctx.stroke();
    }
    if (strong) {
      const bump = 1 + 0.14 * Math.sin(pulse * Math.PI * 2);
      ctx.scale(bump, bump);
    }
  }
  ctx.rotate(angle - Math.PI / 2);
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.2;
  for (let strand = -2; strand <= 2; strand++) {
    ctx.beginPath();
    ctx.moveTo(strand * 1.5, 6);
    ctx.lineTo(strand * 4.5, 27 - Math.abs(strand) * 1.5);
    ctx.strokeStyle = strand % 2 === 0 ? PALETTE.gold : PALETTE.goldDeep;
    ctx.stroke();
  }
  const bead = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
  bead.addColorStop(0, PALETTE.white);
  bead.addColorStop(0.35, PALETTE.goldPale);
  bead.addColorStop(0.75, PALETTE.gold);
  bead.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = bead;
  ctx.beginPath();
  ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const createPresent: RevealFactory = (stage) => {
  /** Tassel displacement from rest, in pixels. */
  const pullX = new Spring(0, 190, 9);
  const pullY = new Spring(0, 190, 9);
  const wobble = new Spring(0, 160, 6);
  /** Positive squashes the box flat, negative stretches it tall. */
  const squash = new Spring(0, 300, 12);
  /** Lid lift in design units, negative is up. */
  const lidLift = new Spring(0, 320, 10);
  const boing = new Spring(0, 200, 5);
  /** Bow loop size, which shrinks as the knot gives. */
  const bowLoose = new Spring(1, 120, 8);
  /** Where the tassel hangs relative to the box, lagging behind it so it swings. */
  const tasselX = new Spring(0, 70, 4.5);
  const tasselY = new Spring(0, 70, 4.5);
  /** Box offset from its resting spot and velocity, in pixels. Negative y is up. */
  let bx = 0;
  let by = 0;
  let bvx = 0;
  let bvy = 0;
  let grab: Grab | null = null;
  let tension = 0;
  let notches = 0;
  let opened: Opened | null = null;
  let completeSent = false;
  let emitTimer = 0;
  let ribbonTouched = false;
  let playStartedAt: number | null = null;
  let lastThud = -1;
  let lastClack = -1;
  let lastRattle = -1;

  stage.setHint(hintFor(0));

  function layout(): Layout {
    const scale = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    return {
      cx: stage.width / 2,
      floorY: stage.height * 0.52 + 118 * scale,
      scale,
      base: clamp(0.42 * Math.min(stage.width, stage.height), 70, 260),
    };
  }

  function lean(l: Layout): number {
    const pull = clamp(pullX.value / (l.base * 0.6), -1, 1) * 0.07;
    const drift = clamp((bvx * 0.00035) / l.scale, -0.2, 0.2);
    return pull + drift + wobble.value + Math.sin(stage.time * 58) * tension * tension * 0.012;
  }

  function pose(l: Layout): Pose {
    const stretch = by < 0 ? clamp(Math.abs(bvy) / (6000 * l.scale), 0, 0.08) : 0;
    const squish = clamp(squash.value, -0.15, 0.3);
    return {
      x: l.cx + bx,
      y: l.floorY + by,
      angle: lean(l),
      sx: (1 + squish * 0.55) * (1 - stretch * 0.5),
      sy: (1 - squish) * (1 + stretch),
    };
  }

  function applyPose(ctx: CanvasRenderingContext2D, l: Layout, p: Pose): void {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.scale(l.scale * p.sx, l.scale * p.sy);
  }

  function toWorld(l: Layout, p: Pose, local: Point): Point {
    const x = local.x * l.scale * p.sx;
    const y = local.y * l.scale * p.sy;
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    return { x: p.x + x * cos - y * sin, y: p.y + x * sin + y * cos };
  }

  function toLocal(l: Layout, p: Pose, point: Point): Point {
    const dx = point.x - p.x;
    const dy = point.y - p.y;
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    return {
      x: (dx * cos + dy * sin) / (l.scale * p.sx),
      y: (-dx * sin + dy * cos) / (l.scale * p.sy),
    };
  }

  function knotPoint(l: Layout, p: Pose): Point {
    return toWorld(l, p, { x: 0, y: KNOT_Y + lidLift.value });
  }

  function tailRest(l: Layout): Point {
    const sway = Math.sin(stage.time * 1.8) * 4 * l.scale * (1 - tension);
    return {
      x: l.cx + (TAIL_REST.x + notches * 5) * l.scale + sway + tasselX.value,
      y: l.floorY + (TAIL_REST.y + notches * 8) * l.scale + tasselY.value,
    };
  }

  function tailEnd(l: Layout): Point {
    const rest = tailRest(l);
    return { x: rest.x + pullX.value, y: rest.y + pullY.value };
  }

  function nudging(): boolean {
    return !ribbonTouched && playStartedAt !== null && stage.time - playStartedAt > NUDGE_AFTER;
  }

  function markPlay(): void {
    if (playStartedAt === null) playStartedAt = stage.time;
  }

  function dust(l: Layout, strength: number): void {
    for (const side of [-1, 1]) {
      stage.particles.burst({
        x: l.cx + bx + side * BODY.halfWidth * l.scale * 0.9,
        y: l.floorY - 4 * l.scale,
        count: 3 + Math.round(strength * 4),
        colors: [PALETTE.cream, PALETTE.ice, PALETTE.white],
        shapes: ['circle'],
        angle: side < 0 ? Math.PI : 0,
        spread: 0.9,
        speed: [40, 120 + 160 * strength],
        size: [6, 13],
        life: [0.3, 0.6],
        gravity: -90,
        drag: 3,
      });
    }
    stage.particles.burst({
      x: l.cx + bx,
      y: l.floorY - BODY.height * l.scale * 0.5,
      count: 3,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      speed: [60, 180],
      size: [5, 9],
      life: [0.4, 0.7],
      gravity: 200,
      drag: 2,
    });
  }

  function land(l: Layout, impact: number): void {
    by = 0;
    if (impact < 150 * l.scale) {
      bvy = 0;
      return;
    }
    bvy = -impact * 0.3;
    squash.velocity += (impact / l.scale) * 0.0012;
    if (impact < 260 * l.scale || stage.time - lastThud < 0.12) return;
    lastThud = stage.time;
    stage.sfx.tap(rand(0.4, 0.5));
    stage.haptic(10);
    dust(l, clamp(impact / (900 * l.scale), 0, 1));
  }

  function updateBox(dt: number, l: Layout): void {
    const held = grab !== null && grab.kind === 'box' ? grab : null;
    if (held !== null) {
      bvx += ((held.target.x - bx) * 260 - bvx * 20) * dt;
      bvy += ((held.target.y - by) * 260 - bvy * 20) * dt;
    } else {
      bvx += (-bx * 140 - bvx * 7) * dt;
      if (by < 0 || bvy < 0) bvy += GRAVITY * l.scale * dt;
    }
    bx += bvx * dt;
    by += bvy * dt;
    if (by <= 0) return;
    if (held !== null) {
      by = 0;
      bvy = Math.min(0, bvy);
      return;
    }
    land(l, bvy);
  }

  function updateLid(dt: number): void {
    lidLift.update(dt);
    if (lidLift.value <= 0) return;
    const impact = lidLift.velocity;
    lidLift.value = 0;
    lidLift.velocity = impact > 40 ? -impact * 0.25 : 0;
    if (impact > 60 && stage.time - lastClack > 0.07) {
      lastClack = stage.time;
      stage.sfx.tap(1.6);
    }
  }

  function open(l: Layout): void {
    const knot = knotPoint(l, pose(l));
    const end = tailEnd(l);
    const length = Math.max(1, Math.hypot(end.x - knot.x, end.y - knot.y));
    const direction = { x: (end.x - knot.x) / length, y: (end.y - knot.y) / length };
    opened = { at: stage.time, knot, end, direction, lidSide: direction.x >= 0 ? -1 : 1 };
    grab = null;
    stage.sfx.whoosh();
    stage.sfx.pop();
    stage.shake(16);
    stage.haptic([20, 30, 60]);
    stage.setHint('');
    stage.setProgress(1);
    stage.particles.burst({
      x: knot.x,
      y: knot.y,
      count: 26,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.goldDeep, PALETTE.white],
      shapes: ['rect', 'star'],
      speed: [200, 760],
      size: [7, 16],
      life: [0.7, 1.4],
      gravity: 1100,
    });
    stage.particles.burst({
      x: l.cx + bx,
      y: l.floorY + by - BODY.height * l.scale,
      count: 34,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      angle: -Math.PI / 2,
      spread: 1.5,
      speed: [300, 1000],
      size: [8, 20],
      life: [0.7, 1.5],
      gravity: 500,
      drag: 1.6,
    });
  }

  /** The knot gives one notch. The ribbon slips from the fingers unless that was the last one. */
  function giveNotch(l: Layout): void {
    notches += 1;
    if (notches >= NOTCHES) {
      open(l);
      return;
    }
    const knot = knotPoint(l, pose(l));
    grab = null;
    stage.sfx.crack(0.25 + 0.2 * notches);
    stage.haptic([18, 30, 24]);
    stage.shake(5 + 3 * notches);
    stage.particles.burst({
      x: knot.x,
      y: knot.y,
      count: 14,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star', 'rect'],
      speed: [120, 460],
      size: [5, 12],
      life: [0.5, 1],
      gravity: 700,
      drag: 1.2,
    });
    pullX.velocity = -pullX.value * 9;
    pullY.velocity = -pullY.value * 9;
    wobble.velocity += (pullX.value >= 0 ? -1 : 1) * 0.9;
    if (by > -2) bvy = -240 * l.scale;
    bowLoose.target = 1 - 0.17 * notches;
    boing.velocity += 2.5;
    lidLift.velocity -= 120;
    stage.setProgress(notches / NOTCHES);
    stage.setHint(hintFor(notches));
  }

  function grabRibbon(point: Point, l: Layout): void {
    ribbonTouched = true;
    const sideways = Math.max(stage.width - EDGE - point.x, point.x - EDGE);
    const room = Math.min(stage.height - EDGE - point.y, sideways);
    const threshold = Math.max(16, Math.min(l.base * (1 + 0.2 * notches), room * 0.92));
    grab = {
      kind: 'ribbon',
      anchor: point,
      start: { x: pullX.value, y: pullY.value },
      target: { x: pullX.value, y: pullY.value },
      threshold,
    };
    pullX.velocity = 0;
    pullY.velocity = 0;
    stage.sfx.tap(1.2);
    stage.haptic(8);
  }

  function dragRibbon(g: RibbonGrab, point: Point, l: Layout): void {
    const dx = point.x - g.anchor.x;
    const dy = point.y - g.anchor.y;
    const distance = Math.hypot(dx, dy);
    const t = clamp(distance / g.threshold, 0, 1);
    const give = 1 - 0.45 * Math.pow(t, 1.4);
    g.target.x = g.start.x * (1 - t) + dx * give;
    g.target.y = g.start.y * (1 - t) + dy * give;
    tension = t;
    stage.setProgress((notches + t) / NOTCHES);
    if (t > 0.05) stage.sfx.stretch(t);
    if (distance >= g.threshold) giveNotch(l);
  }

  function rattle(direction: number): void {
    if (stage.time - lastRattle < 0.09) return;
    lastRattle = stage.time;
    stage.sfx.tap(rand(0.65, 1.5));
    stage.haptic(12);
    lidLift.velocity -= rand(50, 110);
    wobble.velocity += direction * 0.3;
  }

  /** A fast change of horizontal direction while holding the box rattles it. */
  function detectShake(g: BoxGrab, point: Point): void {
    const now = performance.now();
    const elapsed = now - g.lastTime;
    const dx = point.x - g.lastX;
    if (elapsed > 0) g.peakSpeed = Math.max(g.peakSpeed, Math.abs(dx) / elapsed);
    g.lastX = point.x;
    g.lastTime = now;
    if (Math.abs(dx) < 1.5) return;
    const direction = Math.sign(dx);
    if (direction === g.direction) return;
    if (g.direction !== 0 && g.peakSpeed > 0.55) rattle(direction);
    g.direction = direction;
    g.peakSpeed = 0;
  }

  function dragBox(g: BoxGrab, point: Point, l: Layout): void {
    if (Math.hypot(point.x - g.start.x, point.y - g.start.y) > TAP_SLOP) g.moved = true;
    const rawX = point.x - g.start.x + g.origin.x;
    const rawY = point.y - g.start.y + g.origin.y;
    const rangeX = Math.max(10, Math.min(70 * l.scale, stage.width * 0.16));
    const rangeY = Math.max(20, Math.min(110 * l.scale, l.floorY - 250 * l.scale - EDGE));
    const press = 40 * l.scale;
    g.target.x = rubber(rawX, rangeX);
    g.target.y = rawY < 0 ? -rubber(-rawY, rangeY) : 0;
    squash.target = rawY > 0 ? (rubber(rawY, press) / press) * 0.12 : 0;
    detectShake(g, point);
  }

  function tapBox(part: BoxGrab['part'], l: Layout): void {
    if (part === 'lid') {
      lidLift.velocity -= 260;
      stage.sfx.tap(1.3);
      stage.haptic(6);
      return;
    }
    bvy = Math.min(bvy, -430 * l.scale);
    squash.velocity += 2.4;
    stage.sfx.tap(0.75);
    stage.haptic(8);
  }

  function release(): void {
    const g = grab;
    if (g === null) return;
    grab = null;
    if (g.kind === 'ribbon') {
      wobble.velocity += (pullX.value >= 0 ? -1 : 1) * tension * 1.3;
      if (tension > 0.2) stage.sfx.tap(0.8);
      stage.setProgress(notches / NOTCHES);
      return;
    }
    squash.target = 0;
    if (!g.moved && stage.time - g.startedAt < TAP_TIME) tapBox(g.part, layout());
  }

  /** Where the long tail of the ribbon bends between the knot and its end. */
  function tailControl(l: Layout, knot: Point, end: Point): Point {
    const slack = 1 - tension;
    return {
      x: (knot.x + end.x) / 2 + TAIL_DROOP.x * l.scale * slack,
      y: (knot.y + end.y) / 2 + TAIL_DROOP.y * l.scale * slack,
    };
  }

  function tailWidth(l: Layout): number {
    return lerp(15, 8, tension) * l.scale;
  }

  function drawTail(ctx: CanvasRenderingContext2D, l: Layout, knot: Point, end: Point): void {
    const control = tailControl(l, knot, end);
    strokeRibbon(ctx, knot, control, end, tailWidth(l));
    const held = grab !== null && grab.kind === 'ribbon';
    const idle = !held && tension < 0.05;
    const strong = idle && nudging();
    const pulse = idle ? (stage.time * (strong ? 1.4 : 0.9)) % 1 : 0;
    const angle = Math.atan2(end.y - control.y, end.x - control.x);
    drawTassel(ctx, end, angle, l.scale, pulse, strong);
  }

  function drawClosed(ctx: CanvasRenderingContext2D, l: Layout): void {
    const p = pose(l);
    const lift = clamp(-by / (160 * l.scale), 0, 1);
    softShadow(
      ctx,
      l.cx + bx,
      l.floorY,
      130 * l.scale * p.sx * (1 - 0.3 * lift),
      20 * l.scale,
      0.28 * (1 - 0.5 * lift),
    );
    const knot = knotPoint(l, p);
    const end = tailEnd(l);
    const loop = bowLoose.value * (1 - 0.3 * tension);
    const spring = clamp(boing.value, -0.4, 0.4);
    const droop = (1 - bowLoose.value) * 0.9;

    ctx.save();
    applyPose(ctx, l, p);
    inkOutline(ctx, OUTLINE_WEIGHT, () => bodyPath(ctx));
    ctx.translate(0, lidLift.value);
    inkOutline(ctx, OUTLINE_WEIGHT, () => lidPath(ctx));
    ctx.restore();

    ctx.save();
    applyPose(ctx, l, p);
    drawBody(ctx, false);
    ctx.translate(0, lidLift.value);
    drawLid(ctx);
    outlineRibbon(ctx, SHORT_TAIL[0], SHORT_TAIL[1], SHORT_TAIL[2], 15, OUTLINE_WEIGHT);
    strokeRibbon(ctx, SHORT_TAIL[0], SHORT_TAIL[1], SHORT_TAIL[2], 15);
    ctx.restore();

    const control = tailControl(l, knot, end);
    outlineRibbon(ctx, knot, control, end, tailWidth(l), OUTLINE_WEIGHT * l.scale);
    outlineTassel(ctx, end, Math.atan2(end.y - control.y, end.x - control.x), l.scale);
    drawTail(ctx, l, knot, end);

    ctx.save();
    applyPose(ctx, l, p);
    ctx.translate(0, KNOT_Y + lidLift.value);
    outlineBow(ctx, loop * (1 + spring), loop * (1 - spring), droop);
    drawBow(ctx, loop * (1 + spring), loop * (1 - spring), droop);
    ctx.restore();
  }

  function drawOpened(ctx: CanvasRenderingContext2D, l: Layout, o: Opened): void {
    const elapsed = stage.time - o.at;
    const s = l.scale;
    const x = l.cx + bx;
    const floorY = l.floorY + by;
    const drop = easeInCubic((elapsed - COMPLETE_DELAY) / 0.5);
    const mouthY = floorY - BODY.height * s;
    glow(
      ctx,
      x,
      mouthY,
      s * (130 + elapsed * 700),
      GOLD_GLOW_RGB,
      0.9 * (1 - clamp(elapsed / 1.1, 0, 1)),
    );

    if (drop < 1) {
      softShadow(ctx, x, l.floorY, 130 * s, 20 * s, 0.28 * (1 - drop));
      ctx.save();
      ctx.globalAlpha = 1 - drop;
      ctx.translate(x, floorY + drop * stage.height * 0.5);
      ctx.scale(s, s);
      inkOutline(ctx, OUTLINE_WEIGHT, () => bodyPath(ctx));
      drawBody(ctx, true);
      ctx.restore();
    }

    const lidAlpha = 1 - clamp((elapsed - 0.45) / 0.4, 0, 1);
    if (lidAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = lidAlpha;
      ctx.translate(
        x + o.lidSide * 170 * s * elapsed,
        floorY + (LID_CENTRE_Y - 1500 * elapsed + 800 * elapsed * elapsed) * s,
      );
      ctx.rotate(o.lidSide * elapsed * 4.2);
      ctx.scale(s, s);
      ctx.translate(0, -LID_CENTRE_Y);
      inkOutline(ctx, OUTLINE_WEIGHT, () => lidPath(ctx));
      drawLid(ctx);
      ctx.restore();
    }

    const whipAlpha = 1 - clamp(elapsed / 0.4, 0, 1);
    if (whipAlpha > 0) {
      const fly = 1500 * s * elapsed;
      const gather = easeOutCubic(elapsed / 0.25) * 0.7;
      const from = {
        x: lerp(o.knot.x, o.end.x, gather) + o.direction.x * fly,
        y: lerp(o.knot.y, o.end.y, gather) + o.direction.y * fly,
      };
      const to = { x: o.end.x + o.direction.x * fly, y: o.end.y + o.direction.y * fly };
      const wave = Math.sin(elapsed * 40) * 22 * s;
      const control = {
        x: (from.x + to.x) / 2 - o.direction.y * wave,
        y: (from.y + to.y) / 2 + o.direction.x * wave,
      };
      ctx.save();
      ctx.globalAlpha = whipAlpha;
      const whipAngle = Math.atan2(o.direction.y, o.direction.x);
      outlineRibbon(ctx, from, control, to, 9 * s, OUTLINE_WEIGHT * s);
      outlineTassel(ctx, to, whipAngle, s);
      strokeRibbon(ctx, from, control, to, 9 * s);
      drawTassel(ctx, to, whipAngle, s, 0, false);
      ctx.restore();
    }
  }

  return {
    update(dt) {
      const l = layout();
      wobble.update(dt);
      squash.update(dt);
      boing.update(dt);
      bowLoose.update(dt);
      updateLid(dt);
      updateBox(dt, l);
      tasselX.target = bx;
      tasselY.target = by;
      tasselX.update(dt);
      tasselY.update(dt);
      if (opened === null) {
        if (grab !== null && grab.kind === 'ribbon') {
          const follow = Math.min(1, dt * 22);
          pullX.value += (grab.target.x - pullX.value) * follow;
          pullY.value += (grab.target.y - pullY.value) * follow;
        } else {
          pullX.update(dt);
          pullY.update(dt);
          tension = clamp(Math.hypot(pullX.value, pullY.value) / (l.base * 0.55), 0, 1);
        }
        return;
      }
      const elapsed = stage.time - opened.at;
      emitTimer += dt;
      while (elapsed < 0.5 && emitTimer > 0.02) {
        emitTimer -= 0.02;
        stage.particles.burst({
          x: l.cx + bx + rand(-70, 70) * l.scale,
          y: l.floorY + by - BODY.height * l.scale,
          count: 1,
          colors: [PALETTE.goldPale, PALETTE.white, PALETTE.gold],
          shapes: ['star'],
          angle: -Math.PI / 2,
          spread: 0.9,
          speed: [260, 720],
          size: [6, 14],
          life: [0.5, 1],
          gravity: 300,
          drag: 1.5,
        });
      }
      if (!completeSent && elapsed > COMPLETE_DELAY) {
        completeSent = true;
        stage.complete({ x: l.cx + bx, y: l.floorY + by - BODY.height * l.scale });
      }
    },
    draw(ctx) {
      const l = layout();
      if (opened === null) drawClosed(ctx, l);
      else drawOpened(ctx, l, opened);
    },
    onPointerDown(point) {
      if (opened !== null || grab !== null) return;
      const l = layout();
      const p = pose(l);
      const end = tailEnd(l);
      const knot = knotPoint(l, p);
      const nearEnd = Math.hypot(point.x - end.x, point.y - end.y) <= Math.max(48, 44 * l.scale);
      const middle = {
        x: (knot.x + end.x) / 2 + TAIL_DROOP.x * l.scale * 0.5,
        y: (knot.y + end.y) / 2,
      };
      const nearRibbon =
        Math.hypot(point.x - middle.x, point.y - middle.y) <= Math.max(28, 30 * l.scale);
      if (nearEnd || nearRibbon) {
        grabRibbon(point, l);
        return;
      }

      const local = toLocal(l, p, point);
      const pad = 16 / l.scale;
      const loop = bowLoose.value;
      const knotY = KNOT_Y + lidLift.value;
      const onBow =
        Math.abs(local.x) <= 72 * loop + pad &&
        local.y >= knotY - 52 * loop - pad &&
        local.y <= knotY + 10;
      if (onBow) {
        markPlay();
        boing.velocity += 3.2;
        stage.sfx.tap(1.9);
        stage.haptic(6);
        return;
      }
      const lidTop = LID.top + lidLift.value;
      const onLid =
        Math.abs(local.x) <= LID.halfWidth + pad &&
        local.y >= lidTop - pad &&
        local.y <= lidTop + LID.height;
      const onBody =
        Math.abs(local.x) <= BODY.halfWidth + pad && local.y >= -BODY.height && local.y <= pad;
      if (!onLid && !onBody) return;
      markPlay();
      grab = {
        kind: 'box',
        part: onLid ? 'lid' : 'box',
        start: point,
        origin: { x: bx, y: by },
        target: { x: bx, y: Math.min(0, by) },
        startedAt: stage.time,
        moved: false,
        lastX: point.x,
        lastTime: performance.now(),
        direction: 0,
        peakSpeed: 0,
      };
      stage.haptic(5);
    },
    onPointerMove(point, down) {
      if (!down) {
        release();
        return;
      }
      const g = grab;
      if (g === null || opened !== null) return;
      const l = layout();
      if (g.kind === 'ribbon') dragRibbon(g, point, l);
      else dragBox(g, point, l);
    },
    onPointerUp: release,
  };
};
