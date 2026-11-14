import {
  OUTLINE_WEIGHT,
  PALETTE,
  Spring,
  clamp,
  glow,
  inkOutline,
  lerp,
  rand,
  softShadow,
  sparkle,
} from '../draw';
import type { Point, RevealFactory } from '../engine';

const COMPLETE_DELAY = 0.35;
const FLASH_RGB = '255, 248, 230';

/** Most tear one pull can add before the paper slips out of the fingers. */
const SLIP_AT = 0.3;
/** Tear added per second at full strain. */
const TEAR_RATE = 0.5;
/** Tear lost per second while nobody is pulling, down to the last slip. */
const RELAX_RATE = 0.03;
/** Fraction of a full pull before the paper starts to tear. */
const STRAIN_START = 0.45;
/** Pixels kept clear between a full pull and the stage edge. */
const EDGE_MARGIN = 14;
const TAP_TIME = 0.35;
const TAP_SLOP = 10;
/** How far, in design units, an end jumps out when a flick of the phone pulls it. */
const FLICK_STRETCH = 60;

/** Design units along the cracker's axis, measured from its centre. */
const REST_SPAN = 330;
const BARREL_HALF = 62;
const BARREL_RADIUS = 34;
const NECK_START = 60;
const END_INNER = 90;
const END_OUTER = REST_SPAN / 2;
const END_INNER_RADIUS = 22;
const END_OUTER_RADIUS = 38;
const NECK_RADIUS = 13;
const SHOULDER_RADIUS = 30;
const TILT = -0.1;

interface Layout {
  /** Centre of the cracker, including any drag offset. */
  cx: number;
  cy: number;
  /** Centre of the cracker at rest. */
  restX: number;
  restY: number;
  unit: number;
  threshold: number;
}

interface EndGrab {
  kind: 'end';
  side: number;
  /** Pointer position along the pull axis, in pixels, that corresponds to zero stretch. */
  anchor: number;
  /** Pull distance, in pixels, that counts as full strength. */
  full: number;
  pull: number;
  /** Tear this pull has added so far. */
  gained: number;
}

interface BarrelGrab {
  kind: 'barrel';
  side: number;
  start: Point;
  origin: Point;
  startedAt: number;
  moved: boolean;
}

type Grab = EndGrab | BarrelGrab;

interface Damage {
  amount: number;
  /** Tear locked in by the last slip on this side. */
  floor: number;
}

interface Snapped {
  at: number;
  side: number;
  angle: number;
  origin: Point;
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

function foil(
  ctx: CanvasRenderingContext2D,
  radius: number,
  top: string,
  middle: string,
  bottom: string,
) {
  const gradient = ctx.createLinearGradient(0, -radius, 0, radius);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.45, middle);
  gradient.addColorStop(1, bottom);
  return gradient;
}

/** Cylinder shading and the sweeping glint. Call inside a clip. */
function gloss(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  radius: number,
  glintX: number,
): void {
  const shade = ctx.createLinearGradient(0, -radius, 0, radius);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  shade.addColorStop(0.24, 'rgba(255, 255, 255, 0.1)');
  shade.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(0.76, 'rgba(60, 10, 24, 0.12)');
  shade.addColorStop(1, 'rgba(60, 10, 24, 0.42)');
  ctx.fillStyle = shade;
  ctx.fillRect(x0, -radius, x1 - x0, radius * 2);

  ctx.save();
  ctx.transform(1, 0, -0.5, 1, 0, 0);
  const glint = ctx.createLinearGradient(glintX - 16, 0, glintX + 16, 0);
  glint.addColorStop(0, 'rgba(255, 255, 255, 0)');
  glint.addColorStop(0.5, 'rgba(255, 255, 255, 0.7)');
  glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glint;
  ctx.fillRect(glintX - 16, -radius * 2, 32, radius * 4);
  ctx.restore();
}

function barrelPath(ctx: CanvasRenderingContext2D, shift: number): void {
  roundedRect(ctx, shift - BARREL_HALF, -BARREL_RADIUS, BARREL_HALF * 2, BARREL_RADIUS * 2, 10);
}

function drawBarrel(ctx: CanvasRenderingContext2D, shift: number, glintX: number): void {
  const left = shift - BARREL_HALF;
  const r = BARREL_RADIUS;
  barrelPath(ctx, shift);
  ctx.fillStyle = foil(ctx, r, PALETTE.white, PALETTE.cream, PALETTE.creamShade);
  ctx.fill();

  ctx.save();
  barrelPath(ctx, shift);
  ctx.clip();
  for (const side of [-1, 1]) {
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(shift + side * 47 - 5, -r, 10, r * 2);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(shift + side * 37 - 1.25, -r, 2.5, r * 2);
    sparkle(ctx, shift + side * 21, 0, 10, PALETTE.gold, 1, 0);
    ctx.fillStyle = PALETTE.goldDeep;
    for (const row of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(shift + side * 10.5, row * 17, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = PALETTE.red;
  ctx.beginPath();
  ctx.moveTo(shift, -10);
  ctx.lineTo(shift + 7.5, 0);
  ctx.lineTo(shift, 10);
  ctx.lineTo(shift - 7.5, 0);
  ctx.closePath();
  ctx.fill();
  gloss(ctx, left, left + BARREL_HALF * 2, r, glintX);
  ctx.restore();

  roundedRect(ctx, left + 12, -r + 8, BARREL_HALF * 2 - 24, 6, 3);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fill();
}

function endPath(ctx: CanvasRenderingContext2D, inner: number, outer: number): void {
  const teeth = 8;
  ctx.beginPath();
  ctx.moveTo(inner, -END_INNER_RADIUS);
  ctx.bezierCurveTo(inner + 20, -30, outer - 30, -36, outer, -END_OUTER_RADIUS);
  for (let i = 1; i <= teeth; i++) {
    ctx.lineTo(
      outer - (i % 2 === 1 ? 7 : 0),
      -END_OUTER_RADIUS + (i * END_OUTER_RADIUS * 2) / teeth,
    );
  }
  ctx.bezierCurveTo(outer - 30, 36, inner + 20, 30, inner, END_INNER_RADIUS);
  ctx.closePath();
}

/** Flared end, drawn in mirrored coordinates where positive x points outward. */
function drawEnd(ctx: CanvasRenderingContext2D, stretch: number, glintX: number): void {
  const inner = END_INNER + stretch;
  const outer = END_OUTER + stretch;
  endPath(ctx, inner, outer);
  ctx.fillStyle = foil(ctx, END_OUTER_RADIUS, PALETTE.redLight, PALETTE.red, PALETTE.redDeep);
  ctx.fill();

  ctx.save();
  endPath(ctx, inner, outer);
  ctx.clip();
  ctx.fillStyle = PALETTE.cream;
  ctx.fillRect(outer - 25, -40, 8, 80);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(outer - 31, -40, 2.5, 80);
  ctx.fillStyle = PALETTE.goldPale;
  for (let col = 0; col < 3; col++) {
    for (let row = -1; row <= 1; row++) {
      ctx.beginPath();
      ctx.arc(inner + 13 + col * 12, row * 13 + (col % 2) * 6.5 - 3, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(90, 10, 25, 0.22)';
  ctx.lineWidth = 1.2;
  for (const fold of [-0.6, -0.2, 0.2, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(inner, END_INNER_RADIUS * fold);
    ctx.lineTo(inner + 26, 34 * fold);
    ctx.stroke();
  }
  gloss(ctx, inner, outer, END_OUTER_RADIUS, glintX);
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(inner + 8, -16);
  ctx.quadraticCurveTo(inner + 40, -26, outer - 12, -29);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** One edge of the neck from x `from` to `to`, pinching to `pinch` at the tie. Radii are signed. */
function neckEdge(
  ctx: CanvasRenderingContext2D,
  from: number,
  to: number,
  fromRadius: number,
  pinch: number,
  toRadius: number,
): void {
  const middle = (from + to) / 2;
  ctx.bezierCurveTo(
    lerp(from, middle, 0.6),
    fromRadius,
    lerp(from, middle, 0.7),
    pinch,
    middle,
    pinch,
  );
  ctx.bezierCurveTo(lerp(middle, to, 0.3), pinch, lerp(middle, to, 0.4), toRadius, to, toRadius);
}

/** Jagged rips in from both edges just outside the tie. Call inside a clip to the neck. */
function drawTear(ctx: CanvasRenderingContext2D, x: number, radius: number, damage: number): void {
  const width = 5 + 9 * damage;
  const depth = radius * (0.25 + 0.75 * damage);
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  for (const edge of [-1, 1]) {
    const outside = edge * (SHOULDER_RADIUS + 4);
    ctx.beginPath();
    ctx.moveTo(x, outside);
    ctx.lineTo(x + width * 0.2, edge * (radius - depth * 0.55));
    ctx.lineTo(x + width * 0.35, edge * (radius - depth * 0.3));
    ctx.lineTo(x + width * 0.55, edge * (radius - depth));
    ctx.lineTo(x + width * 0.72, edge * (radius - depth * 0.45));
    ctx.lineTo(x + width * 0.85, edge * (radius - depth * 0.7));
    ctx.lineTo(x + width, outside);
    ctx.fillStyle = 'rgba(70, 12, 28, 0.88)';
    ctx.fill();
    ctx.strokeStyle = PALETTE.cream;
    ctx.stroke();
  }
  if (damage <= 0.5) return;
  ctx.beginPath();
  ctx.moveTo(x + width * 0.55, -radius + depth);
  ctx.lineTo(x + width * 0.45, 0);
  ctx.lineTo(x + width * 0.55, radius - depth);
  ctx.strokeStyle = `rgba(70, 12, 28, ${(damage - 0.5) * 1.4})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Radius of the neck at its tie. It thins as the neck is stretched and as it tears. */
function neckRadius(from: number, to: number, damage: number): number {
  const rest = END_INNER - NECK_START;
  return NECK_RADIUS * Math.sqrt(rest / Math.max(rest, to - from)) * (1 - 0.35 * damage);
}

function neckPath(ctx: CanvasRenderingContext2D, from: number, to: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(from, -SHOULDER_RADIUS);
  neckEdge(ctx, from, to, -SHOULDER_RADIUS, -radius, -END_INNER_RADIUS);
  ctx.lineTo(to, END_INNER_RADIUS);
  neckEdge(ctx, to, from, END_INNER_RADIUS, radius, SHOULDER_RADIUS);
  ctx.closePath();
}

function tiePath(ctx: CanvasRenderingContext2D, middle: number, radius: number): void {
  roundedRect(ctx, middle - 4.5, -radius - 3, 9, radius * 2 + 6, 3);
}

/** Pinched, pleated neck and its gold tie, in mirrored coordinates. `damage` is 0 to 1. */
function drawNeck(
  ctx: CanvasRenderingContext2D,
  from: number,
  to: number,
  glintX: number,
  damage: number,
): void {
  const radius = neckRadius(from, to, damage);
  const middle = (from + to) / 2;
  neckPath(ctx, from, to, radius);
  ctx.fillStyle = foil(ctx, SHOULDER_RADIUS, PALETTE.redLight, PALETTE.red, PALETTE.redDeep);
  ctx.fill();
  ctx.save();
  neckPath(ctx, from, to, radius);
  ctx.clip();
  gloss(ctx, from, to, SHOULDER_RADIUS, glintX);
  ctx.restore();

  ctx.strokeStyle = 'rgba(90, 10, 25, 0.35)';
  ctx.lineWidth = 1.2;
  for (const fold of [-0.6, -0.2, 0.2, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(from, SHOULDER_RADIUS * fold);
    neckEdge(ctx, from, to, SHOULDER_RADIUS * fold, radius * fold, END_INNER_RADIUS * fold);
    ctx.stroke();
  }

  tiePath(ctx, middle, radius);
  ctx.fillStyle = foil(ctx, radius + 3, PALETTE.goldPale, PALETTE.gold, PALETTE.goldDeep);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(middle - 2.5, -radius - 1, 2, Math.max(2, radius * 0.7));

  if (damage <= 0.01) return;
  ctx.save();
  neckPath(ctx, from, to, radius);
  ctx.clip();
  drawTear(ctx, middle + 7, radius, damage);
  ctx.restore();
}

/** Soft limit: follows `value` near zero and eases towards `range`. */
function rubber(value: number, range: number): number {
  return range * Math.tanh(value / range);
}

export const createCracker: RevealFactory = (stage) => {
  const leftStretch = new Spring(0, 300, 11);
  const rightStretch = new Spring(0, 300, 11);
  const rock = new Spring(0, 90, 5);
  /** Drag offset of the whole cracker, in pixels. */
  const offX = new Spring(0, 140, 8);
  const offY = new Spring(0, 140, 8);
  const leftDamage: Damage = { amount: 0, floor: 0 };
  const rightDamage: Damage = { amount: 0, floor: 0 };
  let grab: Grab | null = null;
  let tension = 0;
  let snapped: Snapped | null = null;
  let completeSent = false;
  let rattles = 0;
  let nextRattle = 0;
  let hint = '';
  let shownProgress = 0;
  /** End pulled by the last flick that had no sideways direction. */
  let flickSide = -1;

  function showHint(): void {
    const total = totalTear();
    const flicking = stage.motion.active;
    const start = flicking ? 'Flick your phone or pull one end' : 'Pull one end';
    const middle = flicking ? 'Keep going' : 'Pull harder';
    const next = total < SLIP_AT * 0.9 ? start : total < 0.55 ? middle : 'Nearly there';
    if (next === hint) return;
    hint = next;
    stage.setHint(next);
  }

  showHint();

  function layout(): Layout {
    const scale = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    const span = Math.max(120, Math.min(stage.width * 0.78, REST_SPAN * scale));
    const restX = stage.width / 2;
    const restY = stage.height * 0.52;
    return {
      cx: restX + offX.value,
      cy: restY + offY.value,
      restX,
      restY,
      unit: span / REST_SPAN,
      threshold: clamp(stage.width * 0.18, 60, 130),
    };
  }

  function stretchOf(side: number): Spring {
    return side < 0 ? leftStretch : rightStretch;
  }

  function damageOf(side: number): Damage {
    return side < 0 ? leftDamage : rightDamage;
  }

  function totalTear(): number {
    return leftDamage.amount + rightDamage.amount;
  }

  function showProgress(): void {
    const total = clamp(totalTear(), 0, 1);
    if (Math.abs(total - shownProgress) < 0.002) return;
    shownProgress = total;
    stage.setProgress(total);
  }

  function barrelShift(): number {
    return (rightStretch.value - leftStretch.value) * 0.12;
  }

  function angle(): number {
    const strain = tension * tension;
    return (
      TILT +
      rock.value +
      clamp(offX.velocity * 0.0005, -0.25, 0.25) +
      Math.sin(stage.time * 1.4) * 0.03 * (1 - tension) +
      Math.sin(stage.time * 51) * strain * 0.012
    );
  }

  /** Pointer position along the fixed pull axis for one side, in pixels. */
  function along(point: Point, l: Layout, side: number): number {
    return ((point.x - l.restX) * Math.cos(TILT) + (point.y - l.restY) * Math.sin(TILT)) * side;
  }

  /** Centre of the neck on one side, in stage pixels. */
  function neckPoint(l: Layout, side: number, a: number): Point {
    const middle =
      side * ((NECK_START + side * barrelShift() + END_INNER + stretchOf(side).value) / 2);
    return { x: l.cx + Math.cos(a) * middle * l.unit, y: l.cy + Math.sin(a) * middle * l.unit };
  }

  function snap(l: Layout, side: number): void {
    const a = angle();
    const origin = neckPoint(l, side, a);
    snapped = { at: stage.time, side, angle: a, origin };
    grab = null;
    stage.sfx.snap();
    stage.shake(26);
    stage.haptic([40, 30, 90]);
    hint = '';
    stage.setHint('');
    stage.setProgress(1);
    stage.particles.burst({
      ...origin,
      count: 36,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      speed: [300, 1100],
      size: [8, 22],
      life: [0.6, 1.4],
      gravity: 300,
      drag: 2,
    });
    stage.particles.burst({
      ...origin,
      count: 44,
      colors: [PALETTE.red, PALETTE.cream, PALETTE.gold, PALETTE.pink, PALETTE.redLight],
      shapes: ['rect', 'shard'],
      speed: [200, 850],
      size: [6, 16],
      life: [0.9, 1.8],
      gravity: 1200,
    });
    stage.particles.burst({
      ...origin,
      count: 12,
      colors: [PALETTE.white, PALETTE.ice, PALETTE.slateLight],
      shapes: ['circle'],
      speed: [40, 220],
      size: [16, 34],
      life: [0.4, 0.8],
      gravity: -120,
      drag: 3,
    });
  }

  /** The paper slips out of the fingers: the tear so far is kept and the end springs back. */
  function slip(l: Layout, g: EndGrab): void {
    const total = totalTear();
    const damage = damageOf(g.side);
    damage.floor = damage.amount;
    const held = stretchOf(g.side);
    const origin = neckPoint(l, g.side, angle());
    grab = null;
    held.target = 0;
    held.velocity = -held.value * 10;
    stretchOf(-g.side).target = 0;
    rock.velocity += g.side * 0.6;
    stage.sfx.crack(0.3 + 0.4 * total);
    stage.haptic([12, 25, 18]);
    stage.shake(5 + 6 * total);
    stage.particles.burst({
      ...origin,
      count: 8,
      colors: [PALETTE.red, PALETTE.cream, PALETTE.redLight, PALETTE.gold],
      shapes: ['rect', 'shard'],
      angle: -Math.PI / 2,
      spread: Math.PI * 1.4,
      speed: [120, 420],
      size: [4, 9],
      life: [0.5, 1],
      gravity: 1000,
    });
    showHint();
  }

  /** Holding an end past the strain point tears the paper, up to one slip's worth per pull. */
  function strain(l: Layout, g: EndGrab, dt: number): void {
    const amount = clamp((g.pull / g.full - STRAIN_START) / (1 - STRAIN_START), 0, 1);
    if (amount <= 0) return;
    const gain = Math.min(TEAR_RATE * amount * dt, SLIP_AT - g.gained);
    damageOf(g.side).amount += gain;
    g.gained += gain;
    stage.sfx.rub(amount);
    showProgress();
    if (totalTear() >= 1) snap(l, g.side);
    else if (g.gained >= SLIP_AT - 0.0001) slip(l, g);
  }

  /**
   * A flick of the phone tears as much as one full pull: on the end it was flicked towards, or
   * on each end in turn when it had no sideways direction.
   */
  function tug(flick: Point, l: Layout): void {
    if (flick.x === 0) flickSide = -flickSide;
    const side = flick.x === 0 ? flickSide : Math.sign(flick.x);
    damageOf(side).amount += Math.min(SLIP_AT, 1 - totalTear());
    const held = stretchOf(side);
    held.value = Math.max(held.value, FLICK_STRETCH);
    showProgress();
    if (totalTear() >= 1 - 0.0001) snap(l, side);
    else slip(l, { kind: 'end', side, anchor: 0, full: 1, pull: 0, gained: SLIP_AT });
  }

  function relax(damage: Damage, dt: number): void {
    damage.amount = Math.max(damage.floor, damage.amount - RELAX_RATE * dt);
  }

  function playRattles(): void {
    if (rattles <= 0 || stage.time < nextRattle) return;
    stage.sfx.tap(rand(0.75, 1.25) * (0.8 + 0.1 * rattles));
    rattles -= 1;
    nextRattle = stage.time + rand(0.06, 0.1);
  }

  function dragEnd(g: EndGrab, point: Point, l: Layout): void {
    const pull = Math.max(0, along(point, l, g.side) - g.anchor);
    const held = stretchOf(g.side);
    g.pull = pull;
    held.value = pull / l.unit;
    held.velocity = 0;
    stretchOf(-g.side).target = held.value * 0.22;
    tension = clamp(pull / g.full, 0, 1);
    if (tension > 0.05) stage.sfx.stretch(tension);
  }

  function dragBarrel(g: BarrelGrab, point: Point): void {
    const dx = point.x - g.start.x;
    const dy = point.y - g.start.y;
    if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
    offX.target = rubber(g.origin.x + dx, Math.max(8, stage.width * 0.06));
    offY.target = rubber(g.origin.y + dy, Math.max(20, Math.min(stage.height * 0.12, 90)));
  }

  function release(): void {
    const g = grab;
    if (g === null) return;
    grab = null;
    if (g.kind === 'end') {
      rock.velocity += g.side * tension * 0.8;
      stretchOf(-g.side).target = 0;
      return;
    }
    offX.target = 0;
    offY.target = 0;
    if (g.moved || stage.time - g.startedAt > TAP_TIME) return;
    rock.velocity += g.side * 0.9;
    offY.velocity -= 240;
    rattles = 3;
    nextRattle = stage.time;
    stage.haptic(10);
  }

  function drawSide(
    ctx: CanvasRenderingContext2D,
    side: number,
    glintX: number,
    withNeck: boolean,
  ): void {
    const stretch = Math.max(0, stretchOf(side).value);
    ctx.save();
    ctx.scale(side, 1);
    if (withNeck) {
      drawNeck(
        ctx,
        NECK_START + side * barrelShift(),
        END_INNER + stretch,
        side * glintX,
        clamp(damageOf(side).amount, 0, 1),
      );
    }
    drawEnd(ctx, stretch, side * glintX);
    ctx.restore();
  }

  /** Ink round what `drawSide` draws with the same arguments. */
  function outlineSide(ctx: CanvasRenderingContext2D, side: number, withNeck: boolean): void {
    const stretch = Math.max(0, stretchOf(side).value);
    ctx.save();
    ctx.scale(side, 1);
    if (withNeck) {
      const from = NECK_START + side * barrelShift();
      const to = END_INNER + stretch;
      const radius = neckRadius(from, to, clamp(damageOf(side).amount, 0, 1));
      inkOutline(ctx, OUTLINE_WEIGHT, () => neckPath(ctx, from, to, radius));
      inkOutline(ctx, OUTLINE_WEIGHT, () => tiePath(ctx, (from + to) / 2, radius));
    }
    inkOutline(ctx, OUTLINE_WEIGHT, () => endPath(ctx, END_INNER + stretch, END_OUTER + stretch));
    ctx.restore();
  }

  function outlineBarrel(ctx: CanvasRenderingContext2D): void {
    inkOutline(ctx, OUTLINE_WEIGHT, () => barrelPath(ctx, barrelShift()));
  }

  /** Runs `paint` in design units, rotated about `pivotX` on the cracker's axis. */
  function withPiece(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    base: number,
    pivotX: number,
    offset: Point,
    spin: number,
    alpha: number,
    paint: () => void,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(
      l.cx + Math.cos(base) * pivotX * l.unit + offset.x,
      l.cy + Math.sin(base) * pivotX * l.unit + offset.y,
    );
    ctx.rotate(base + spin);
    ctx.scale(l.unit, l.unit);
    ctx.translate(-pivotX, 0);
    paint();
    ctx.restore();
  }

  function drawWhole(ctx: CanvasRenderingContext2D, l: Layout): void {
    const a = angle();
    const tremble = Math.sin(stage.time * 64) * tension * tension * 2.4 * l.unit;
    const bob = Math.sin(stage.time * 1.7) * 2.5 * (1 - tension);
    const sweep = (stage.time % 3.6) / 1.1;
    const glintX = sweep < 1 ? lerp(-260, 260, sweep) : 9999;
    const reach = END_OUTER + (leftStretch.value + rightStretch.value) / 2;
    const lift = clamp(-offY.value / (120 * l.unit), 0, 1);
    softShadow(
      ctx,
      l.cx,
      l.restY + 72 * l.unit,
      reach * 1.05 * l.unit * (1 - 0.25 * lift),
      17 * l.unit,
      0.24 * (1 - 0.5 * lift),
    );
    const offset = { x: -Math.sin(a) * tremble, y: Math.cos(a) * tremble + bob };
    withPiece(ctx, l, a, 0, offset, 0, 1, () => {
      outlineSide(ctx, -1, true);
      outlineSide(ctx, 1, true);
      outlineBarrel(ctx);
      drawSide(ctx, -1, glintX, true);
      drawSide(ctx, 1, glintX, true);
      drawBarrel(ctx, barrelShift(), glintX);
    });
  }

  function drawSnapped(ctx: CanvasRenderingContext2D, l: Layout, s: Snapped): void {
    const elapsed = stage.time - s.at;
    const alpha = 1 - clamp((elapsed - 0.3) / 0.45, 0, 1);
    glow(
      ctx,
      s.origin.x,
      s.origin.y,
      l.unit * (70 + elapsed * 900),
      FLASH_RGB,
      1 - clamp(elapsed / 0.3, 0, 1),
    );
    if (alpha <= 0) return;
    softShadow(ctx, l.cx, l.restY + 72 * l.unit, END_OUTER * l.unit, 17 * l.unit, 0.24 * alpha);
    const axis = { x: Math.cos(s.angle) * s.side, y: Math.sin(s.angle) * s.side };
    const fall = 750 * elapsed * elapsed;
    const endOffset = {
      x: axis.x * 1300 * l.unit * elapsed,
      y: (axis.y * 1300 * elapsed - 260 * elapsed + fall) * l.unit,
    };
    const bodyOffset = {
      x: -axis.x * 1000 * l.unit * elapsed,
      y: (-axis.y * 1000 * elapsed - 180 * elapsed + fall) * l.unit,
    };
    const endPivot = s.side * ((END_INNER + END_OUTER) / 2 + stretchOf(s.side).value);
    withPiece(ctx, l, s.angle, endPivot, endOffset, s.side * 7 * elapsed, alpha, () => {
      outlineSide(ctx, s.side, false);
      drawSide(ctx, s.side, 9999, false);
    });
    withPiece(ctx, l, s.angle, -s.side * 45, bodyOffset, -s.side * 3.5 * elapsed, alpha, () => {
      outlineSide(ctx, -s.side, true);
      outlineBarrel(ctx);
      drawSide(ctx, -s.side, 9999, true);
      drawBarrel(ctx, barrelShift(), 9999);
    });
  }

  return {
    update(dt) {
      rock.update(dt);
      offX.update(dt);
      offY.update(dt);
      playRattles();
      const l = layout();
      if (snapped !== null) {
        if (!completeSent && stage.time - snapped.at > COMPLETE_DELAY) {
          completeSent = true;
          stage.complete({ x: l.cx, y: l.cy });
        }
        return;
      }
      if (grab !== null && grab.kind === 'end') {
        stretchOf(-grab.side).update(dt);
        strain(l, grab, dt);
        return;
      }
      showHint();
      if (stage.motion.flick) {
        tug(stage.motion.flick, l);
        if (snapped !== null) return;
      }
      leftStretch.update(dt);
      rightStretch.update(dt);
      tension = clamp(
        (Math.max(leftStretch.value, rightStretch.value) * l.unit) / l.threshold,
        0,
        1,
      );
      relax(leftDamage, dt);
      relax(rightDamage, dt);
      showProgress();
    },
    draw(ctx) {
      const l = layout();
      if (snapped === null) drawWhole(ctx, l);
      else drawSnapped(ctx, l, snapped);
    },
    onPointerDown(point) {
      if (snapped !== null || grab !== null) return;
      const l = layout();
      const a = angle();
      const dx = point.x - l.cx;
      const dy = point.y - l.cy;
      const local = {
        x: (dx * Math.cos(a) + dy * Math.sin(a)) / l.unit,
        y: (-dx * Math.sin(a) + dy * Math.cos(a)) / l.unit,
      };
      const pad = 26 / l.unit;
      const side = local.x < 0 ? -1 : 1;
      const distance = Math.abs(local.x);
      const held = stretchOf(side);
      const onEnd =
        distance >= BARREL_HALF - 8 &&
        distance <= END_OUTER + held.value + pad &&
        Math.abs(local.y) <= END_OUTER_RADIUS + pad;
      if (onEnd) {
        const room = (side > 0 ? stage.width - point.x : point.x) * Math.cos(TILT);
        grab = {
          kind: 'end',
          side,
          anchor: along(point, l, side) - held.value * l.unit,
          full: clamp(room - EDGE_MARGIN, 12, l.threshold),
          pull: held.value * l.unit,
          gained: 0,
        };
        stage.sfx.tap(1.2);
        stage.haptic(8);
        return;
      }
      if (distance >= BARREL_HALF - 8 || Math.abs(local.y) > BARREL_RADIUS + pad) return;
      grab = {
        kind: 'barrel',
        side,
        start: point,
        origin: { x: offX.value, y: offY.value },
        startedAt: stage.time,
        moved: false,
      };
      stage.haptic(6);
    },
    onPointerMove(point, down) {
      if (!down) {
        release();
        return;
      }
      const g = grab;
      if (g === null || snapped !== null) return;
      if (g.kind === 'end') dragEnd(g, point, layout());
      else dragBarrel(g, point);
    },
    onPointerUp: release,
  };
};
