import { PALETTE, Spring, clamp, glow, lerp, softShadow, sparkle } from '../draw';
import type { Point, RevealFactory } from '../engine';

const COMPLETE_DELAY = 0.35;
const HINT = 'Pull one end';
const FLASH_RGB = '255, 248, 230';

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
  cx: number;
  cy: number;
  unit: number;
  threshold: number;
}

interface Grab {
  side: number;
  /** Pointer position along the pull axis, in pixels, that corresponds to zero stretch. */
  anchor: number;
  threshold: number;
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

function drawBarrel(ctx: CanvasRenderingContext2D, shift: number, glintX: number): void {
  const left = shift - BARREL_HALF;
  const r = BARREL_RADIUS;
  roundedRect(ctx, left, -r, BARREL_HALF * 2, r * 2, 10);
  ctx.fillStyle = foil(ctx, r, PALETTE.white, PALETTE.cream, PALETTE.creamShade);
  ctx.fill();

  ctx.save();
  roundedRect(ctx, left, -r, BARREL_HALF * 2, r * 2, 10);
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

/** Pinched, pleated neck and its gold tie, in mirrored coordinates. */
function drawNeck(ctx: CanvasRenderingContext2D, from: number, to: number, glintX: number): void {
  const rest = END_INNER - NECK_START;
  const radius = NECK_RADIUS * Math.sqrt(rest / Math.max(rest, to - from));
  const middle = (from + to) / 2;
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(from, -SHOULDER_RADIUS);
    neckEdge(ctx, from, to, -SHOULDER_RADIUS, -radius, -END_INNER_RADIUS);
    ctx.lineTo(to, END_INNER_RADIUS);
    neckEdge(ctx, to, from, END_INNER_RADIUS, radius, SHOULDER_RADIUS);
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = foil(ctx, SHOULDER_RADIUS, PALETTE.redLight, PALETTE.red, PALETTE.redDeep);
  ctx.fill();
  ctx.save();
  outline();
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

  roundedRect(ctx, middle - 4.5, -radius - 3, 9, radius * 2 + 6, 3);
  ctx.fillStyle = foil(ctx, radius + 3, PALETTE.goldPale, PALETTE.gold, PALETTE.goldDeep);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(middle - 2.5, -radius - 1, 2, Math.max(2, radius * 0.7));
}

export const createCracker: RevealFactory = (stage) => {
  const leftStretch = new Spring(0, 300, 11);
  const rightStretch = new Spring(0, 300, 11);
  const rock = new Spring(0, 90, 5);
  let grab: Grab | null = null;
  let tension = 0;
  let snapped: Snapped | null = null;
  let completeSent = false;

  stage.setHint(HINT);

  function layout(): Layout {
    const scale = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    const span = Math.max(120, Math.min(stage.width * 0.78, REST_SPAN * scale));
    return {
      cx: stage.width / 2,
      cy: stage.height * 0.52,
      unit: span / REST_SPAN,
      threshold: clamp(stage.width * 0.18, 60, 130),
    };
  }

  function stretchOf(side: number): Spring {
    return side < 0 ? leftStretch : rightStretch;
  }

  function barrelShift(): number {
    return (rightStretch.value - leftStretch.value) * 0.12;
  }

  function angle(): number {
    const strain = tension * tension;
    return (
      TILT +
      rock.value +
      Math.sin(stage.time * 1.4) * 0.03 * (1 - tension) +
      Math.sin(stage.time * 51) * strain * 0.012
    );
  }

  /** Pointer position along the fixed pull axis for one side, in pixels. */
  function along(point: Point, l: Layout, side: number): number {
    return ((point.x - l.cx) * Math.cos(TILT) + (point.y - l.cy) * Math.sin(TILT)) * side;
  }

  function snap(l: Layout, side: number): void {
    const a = angle();
    const neckMiddle =
      side * ((NECK_START + side * barrelShift() + END_INNER + stretchOf(side).value) / 2);
    const origin = {
      x: l.cx + Math.cos(a) * neckMiddle * l.unit,
      y: l.cy + Math.sin(a) * neckMiddle * l.unit,
    };
    snapped = { at: stage.time, side, angle: a, origin };
    grab = null;
    stage.sfx.snap();
    stage.shake(26);
    stage.haptic([40, 30, 90]);
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

  function drag(point: Point): void {
    if (grab === null || snapped !== null) return;
    const l = layout();
    const pull = Math.max(0, along(point, l, grab.side) - grab.anchor);
    const held = stretchOf(grab.side);
    held.value = pull / l.unit;
    held.velocity = 0;
    stretchOf(-grab.side).target = held.value * 0.22;
    tension = clamp(pull / grab.threshold, 0, 1);
    stage.setProgress(tension);
    stage.setHint(tension > 0.6 ? 'Keep pulling' : HINT);
    if (tension > 0.05) stage.sfx.stretch(tension);
    if (pull >= grab.threshold) snap(l, grab.side);
  }

  function release(): void {
    if (grab === null) return;
    rock.velocity += grab.side * tension * 0.8;
    stretchOf(-grab.side).target = 0;
    grab = null;
    stage.setProgress(0);
    stage.setHint(HINT);
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
    if (withNeck)
      drawNeck(ctx, NECK_START + side * barrelShift(), END_INNER + stretch, side * glintX);
    drawEnd(ctx, stretch, side * glintX);
    ctx.restore();
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
    softShadow(ctx, l.cx, l.cy + 72 * l.unit, reach * 1.05 * l.unit, 17 * l.unit, 0.24);
    const offset = { x: -Math.sin(a) * tremble, y: Math.cos(a) * tremble + bob };
    withPiece(ctx, l, a, 0, offset, 0, 1, () => {
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
    softShadow(ctx, l.cx, l.cy + 72 * l.unit, END_OUTER * l.unit, 17 * l.unit, 0.24 * alpha);
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
      drawSide(ctx, s.side, 9999, false);
    });
    withPiece(ctx, l, s.angle, -s.side * 45, bodyOffset, -s.side * 3.5 * elapsed, alpha, () => {
      drawSide(ctx, -s.side, 9999, true);
      drawBarrel(ctx, barrelShift(), 9999);
    });
  }

  return {
    update(dt) {
      rock.update(dt);
      const l = layout();
      if (snapped !== null) {
        if (!completeSent && stage.time - snapped.at > COMPLETE_DELAY) {
          completeSent = true;
          stage.complete({ x: l.cx, y: l.cy });
        }
        return;
      }
      if (grab === null) {
        leftStretch.update(dt);
        rightStretch.update(dt);
        tension = clamp(
          (Math.max(leftStretch.value, rightStretch.value) * l.unit) / l.threshold,
          0,
          1,
        );
      } else {
        stretchOf(-grab.side).update(dt);
      }
    },
    draw(ctx) {
      const l = layout();
      if (snapped === null) drawWhole(ctx, l);
      else drawSnapped(ctx, l, snapped);
    },
    onPointerDown(point) {
      if (snapped !== null) return;
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
      if (Math.abs(local.y) > END_OUTER_RADIUS + pad) return;
      if (distance < BARREL_HALF - 8) {
        rock.velocity += side * 0.9;
        stage.sfx.tap();
        return;
      }
      const held = stretchOf(side);
      if (distance > END_OUTER + held.value + pad) return;
      const room = (side > 0 ? stage.width - point.x : point.x) / Math.cos(TILT);
      grab = {
        side,
        anchor: along(point, l, side) - held.value * l.unit,
        threshold: clamp(room - 14, 30, l.threshold),
      };
      stage.sfx.tap(1.2);
      stage.haptic(8);
    },
    onPointerMove(point, down) {
      if (down) drag(point);
      else release();
    },
    onPointerUp: release,
  };
};
