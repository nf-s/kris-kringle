import {
  GOLD_GLOW_RGB,
  PALETTE,
  Spring,
  clamp,
  easeInCubic,
  easeOutCubic,
  glow,
  lerp,
  pick,
  rand,
  softShadow,
  sparkle,
} from '../draw';
import type { Point, RevealFactory } from '../engine';
import type { ParticleShape } from '../particles';

const CLEAR_THRESHOLD = 0.6;
const COMPLETE_DELAY = 0.45;
const MELT_TIME = 0.35;
const GRID_COLS = 14;
const GRID_ROWS = 18;
/** Glass half-height over half-width. */
const ASPECT = 140 / 110;
/** Height of the arch spring line, in half-widths from the window centre. */
const SPRING_LINE = 1 - ASPECT;
const NAME_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const FLECK_SHAPES: readonly ParticleShape[] = ['shard', 'circle'];
const FLECK_COLORS: readonly string[] = [PALETTE.white, PALETTE.ice, PALETTE.iceDeep];

interface Layout {
  cx: number;
  cy: number;
  /** Glass half-width and half-height. */
  hw: number;
  hh: number;
  unit: number;
  frame: number;
  brush: number;
}

interface FrostSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  width: number;
  height: number;
}

/** Whether a point (in half-widths from the window centre) lies on the arched glass. */
function onGlass(x: number, y: number): boolean {
  if (Math.abs(x) > 1 || y > ASPECT) return false;
  return y >= SPRING_LINE || Math.hypot(x, y - SPRING_LINE) <= 1;
}

const CELL_VALID: readonly boolean[] = Array.from({ length: GRID_COLS * GRID_ROWS }, (_, k) => {
  const x = (((k % GRID_COLS) + 0.5) / GRID_COLS) * 2 - 1;
  const y = ((Math.floor(k / GRID_COLS) + 0.5) / GRID_ROWS) * 2 - 1;
  return onGlass(x, y * ASPECT);
});
const VALID_CELLS = CELL_VALID.filter(Boolean).length;

const TWINKLES: readonly Point[] = [
  { x: 0.2, y: 0.34 },
  { x: 0.74, y: 0.28 },
  { x: 0.5, y: 0.12 },
  { x: 0.32, y: 0.62 },
  { x: 0.82, y: 0.56 },
  { x: 0.14, y: 0.84 },
  { x: 0.6, y: 0.8 },
  { x: 0.88, y: 0.9 },
  { x: 0.46, y: 0.44 },
];

function glassPath(ctx: CanvasRenderingContext2D, hw: number, hh: number, grow: number): void {
  const spring = -hh + hw;
  ctx.beginPath();
  ctx.moveTo(-hw - grow, hh + grow);
  ctx.lineTo(-hw - grow, spring);
  ctx.arc(0, spring, hw + grow, Math.PI, Math.PI * 2);
  ctx.lineTo(hw + grow, hh + grow);
  ctx.closePath();
}

/** Feathery ice crystal: a stem with shorter stems branching off both sides. */
function frond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  depth: number,
): void {
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  ctx.lineWidth = 0.7 + depth * 0.55;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
  if (depth === 0) return;
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const side = length * 0.44 * (1 - t * 0.55);
    frond(ctx, x + dx * t, y + dy * t, angle + 0.95, side, depth - 1);
    frond(ctx, x + dx * t, y + dy * t, angle - 0.95, side, depth - 1);
  }
}

function paintFrost(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, 'rgba(248, 252, 255, 0.97)');
  base.addColorStop(0.5, 'rgba(226, 238, 249, 0.96)');
  base.addColorStop(1, 'rgba(198, 217, 236, 0.97)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 28; i++) {
    const x = rand(0, width);
    const y = rand(0, height);
    const radius = rand(0.12, 0.3) * width;
    const blotch = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const tint = i % 3 === 0 ? '169, 191, 214' : '255, 255, 255';
    blotch.addColorStop(0, `rgba(${tint}, 0.42)`);
    blotch.addColorStop(1, `rgba(${tint}, 0)`);
    ctx.fillStyle = blotch;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  ctx.lineCap = 'round';
  for (let i = 0; i < 20; i++) {
    const fromSide = i % 2 === 0;
    const x = fromSide ? (i % 4 === 0 ? 0 : width) : rand(0, width);
    const y = fromSide ? rand(0, height) : i % 4 === 1 ? 0 : height;
    const inward = Math.atan2(height / 2 - y, width / 2 - x);
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(134, 164, 196, 0.4)' : 'rgba(255, 255, 255, 0.8)';
    frond(ctx, x, y, inward + rand(-0.6, 0.6), rand(0.32, 0.62) * width, 2);
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  for (let i = 0; i < 110; i++) {
    ctx.beginPath();
    ctx.arc(rand(0, width), rand(0, height), rand(0.5, 1.6), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 12; i++) {
    const color = i % 2 === 0 ? PALETTE.white : PALETTE.iceDeep;
    sparkle(ctx, rand(0, width), rand(0, height), rand(3, 7), color, 0.8, rand(0, 1));
  }
}

export const createFrost: RevealFactory = (stage) => {
  const pulse = new Spring(0, 240, 12);
  const wiped: boolean[] = CELL_VALID.map(() => false);
  let wipedCount = 0;
  let frost: FrostSurface | null = null;
  let last: Point | null = null;
  let travel = 0;
  let milestone = 0;
  let progress = 0;
  let meltedAt: number | null = null;

  stage.setHint('Rub the glass to clear the frost');

  function layout(): Layout {
    const unit = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    return {
      cx: stage.width / 2,
      cy: stage.height * 0.52,
      hw: 110 * unit,
      hh: 110 * ASPECT * unit,
      unit,
      frame: 20 * unit,
      brush: 34 * unit,
    };
  }

  /** Builds the frost layer, and rebuilds it (resetting the wipe) when the stage resizes. */
  function ensureFrost(l: Layout): void {
    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(l.hw * 2 * resolution));
    const height = Math.max(1, Math.round(l.hh * 2 * resolution));
    if (frost !== null && frost.width === width && frost.height === height) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.scale(resolution, resolution);
      paintFrost(ctx, l.hw * 2, l.hh * 2);
      ctx.globalCompositeOperation = 'destination-out';
    }
    frost = { canvas, ctx, width, height };
    wiped.fill(false);
    wipedCount = 0;
    milestone = 0;
    progress = 0;
    stage.setProgress(0);
  }

  /** Erases one soft brush dab. `x` and `y` are relative to the window centre. */
  function stamp(l: Layout, x: number, y: number): void {
    const fx = x + l.hw;
    const fy = y + l.hh;
    if (frost !== null && frost.ctx !== null) {
      const brush = frost.ctx.createRadialGradient(fx, fy, l.brush * 0.2, fx, fy, l.brush);
      brush.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
      brush.addColorStop(1, 'rgba(0, 0, 0, 0)');
      frost.ctx.fillStyle = brush;
      frost.ctx.beginPath();
      frost.ctx.arc(fx, fy, l.brush, 0, Math.PI * 2);
      frost.ctx.fill();
    }
    const cellW = (l.hw * 2) / GRID_COLS;
    const cellH = (l.hh * 2) / GRID_ROWS;
    const reach = l.brush * 0.8;
    const colFrom = clamp(Math.floor((fx - reach) / cellW), 0, GRID_COLS - 1);
    const colTo = clamp(Math.floor((fx + reach) / cellW), 0, GRID_COLS - 1);
    const rowFrom = clamp(Math.floor((fy - reach) / cellH), 0, GRID_ROWS - 1);
    const rowTo = clamp(Math.floor((fy + reach) / cellH), 0, GRID_ROWS - 1);
    for (let row = rowFrom; row <= rowTo; row++) {
      for (let col = colFrom; col <= colTo; col++) {
        const k = row * GRID_COLS + col;
        if (!CELL_VALID[k] || wiped[k]) continue;
        if (Math.hypot((col + 0.5) * cellW - fx, (row + 0.5) * cellH - fy) > reach) continue;
        wiped[k] = true;
        wipedCount += 1;
      }
    }
  }

  function melt(l: Layout): void {
    meltedAt = stage.time;
    last = null;
    stage.setHint('');
    stage.sfx.chime(4);
    stage.sfx.whoosh();
    stage.shake(10);
    stage.haptic([20, 30, 60]);
    stage.particles.burst({
      x: l.cx,
      y: l.cy,
      count: 36,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      speed: [150, 720],
      size: [8, 20],
      life: [0.7, 1.5],
      gravity: 200,
      drag: 2,
    });
    stage.particles.burst({
      x: l.cx,
      y: l.cy,
      count: 40,
      colors: FLECK_COLORS,
      shapes: FLECK_SHAPES,
      speed: [200, 800],
      size: [5, 14],
      life: [0.7, 1.4],
      gravity: 1300,
    });
  }

  function updateProgress(l: Layout): void {
    progress = clamp(wipedCount / VALID_CELLS / CLEAR_THRESHOLD, 0, 1);
    stage.setProgress(progress);
    if (progress >= 1) {
      melt(l);
      return;
    }
    const step = Math.floor(progress * 3);
    if (step <= milestone) return;
    milestone = step;
    pulse.velocity += 1.6;
    stage.sfx.chime(step);
    stage.haptic(10);
    stage.setHint(step >= 2 ? 'Nearly there' : 'Keep wiping');
  }

  function wipeTo(point: Point): void {
    if (meltedAt !== null) return;
    const l = layout();
    ensureFrost(l);
    const target = { x: point.x - l.cx, y: point.y - l.cy };
    const from = last ?? target;
    const distance = Math.hypot(target.x - from.x, target.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / (l.brush * 0.3)));
    for (let s = 1; s <= steps; s++) {
      stamp(l, lerp(from.x, target.x, s / steps), lerp(from.y, target.y, s / steps));
    }
    last = target;
    if (!onGlass(target.x / l.hw, target.y / l.hw)) return;

    stage.sfx.rub(clamp(distance / (30 * l.unit), 0.15, 1));
    travel += distance;
    while (travel > 18 * l.unit) {
      travel -= 18 * l.unit;
      stage.particles.emit({
        x: point.x + rand(-0.5, 0.5) * l.brush,
        y: point.y + rand(-0.5, 0.5) * l.brush,
        vx: rand(-70, 70),
        vy: rand(-60, 40),
        size: rand(3, 6.5) * l.unit,
        color: pick(FLECK_COLORS),
        shape: pick(FLECK_SHAPES),
        life: rand(0.4, 0.8),
        gravity: 520,
        drag: 1.5,
      });
    }
    updateProgress(l);
  }

  function drawTag(ctx: CanvasRenderingContext2D, l: Layout): void {
    const pivotY = -l.hh + l.hw;
    const width = l.hw * 1.22;
    const height = l.hw * 0.62;
    const top = l.hh * 0.02 - pivotY;
    const cut = height * 0.3;
    ctx.save();
    ctx.translate(0, pivotY);
    ctx.rotate(Math.sin(stage.time * 1.3) * 0.045);
    ctx.strokeStyle = PALETTE.goldDeep;
    ctx.lineWidth = 1.6 * l.unit;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, top + cut * 0.55);
    ctx.stroke();
    for (const shadow of [true, false]) {
      const offset = shadow ? 4 * l.unit : 0;
      ctx.beginPath();
      ctx.moveTo(-width / 2 + cut + offset, top + offset);
      ctx.lineTo(width / 2 - cut + offset, top + offset);
      ctx.lineTo(width / 2 + offset, top + cut + offset);
      ctx.lineTo(width / 2 + offset, top + height + offset);
      ctx.lineTo(-width / 2 + offset, top + height + offset);
      ctx.lineTo(-width / 2 + offset, top + cut + offset);
      ctx.closePath();
      if (shadow) {
        ctx.fillStyle = 'rgba(120, 60, 20, 0.28)';
      } else {
        const paper = ctx.createLinearGradient(0, top, 0, top + height);
        paper.addColorStop(0, PALETTE.white);
        paper.addColorStop(1, PALETTE.cream);
        ctx.fillStyle = paper;
      }
      ctx.fill();
    }
    ctx.strokeStyle = PALETTE.red;
    ctx.lineWidth = 1.5 * l.unit;
    ctx.strokeRect(
      -width / 2 + 6 * l.unit,
      top + cut,
      width - 12 * l.unit,
      height - cut - 6 * l.unit,
    );
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.arc(0, top + cut * 0.55, 4.5 * l.unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.goldDeep;
    ctx.beginPath();
    ctx.arc(0, top + cut * 0.55, 2 * l.unit, 0, Math.PI * 2);
    ctx.fill();

    const maxWidth = width - 26 * l.unit;
    let size = height * 0.36;
    ctx.font = `700 ${size}px ${NAME_FONT}`;
    const measured = ctx.measureText(stage.receiverName).width;
    if (measured > maxWidth) {
      size *= maxWidth / measured;
      ctx.font = `700 ${size}px ${NAME_FONT}`;
    }
    ctx.fillStyle = PALETTE.slateDark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stage.receiverName, 0, top + cut + (height - cut - 6 * l.unit) / 2);
    ctx.restore();
  }

  function drawInterior(ctx: CanvasRenderingContext2D, l: Layout): void {
    const { hw, hh } = l;
    const room = ctx.createRadialGradient(0, hh * 0.15, hw * 0.1, 0, 0, hh * 1.25);
    room.addColorStop(0, '#fff6cf');
    room.addColorStop(0.45, '#f9cf6e');
    room.addColorStop(1, '#c97a34');
    ctx.fillStyle = room;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
    for (let i = 0; i < 6; i++) {
      const x = Math.sin(i * 2.4) * hw * 0.7;
      const y = Math.cos(i * 1.7) * hh * 0.6 - hh * 0.1;
      const flicker = 0.16 + 0.08 * Math.sin(stage.time * 2 + i * 1.9);
      glow(ctx, x, y, hw * (0.2 + (i % 3) * 0.07), '255, 250, 225', flicker);
    }
    ctx.fillStyle = 'rgba(140, 70, 30, 0.35)';
    ctx.fillRect(-hw, hh * 0.88, hw * 2, hh * 0.12);

    for (const side of [-1, 1]) {
      const drape = ctx.createLinearGradient(side * hw, 0, side * hw * 0.3, 0);
      drape.addColorStop(0, PALETTE.redDeep);
      drape.addColorStop(0.55, PALETTE.red);
      drape.addColorStop(1, PALETTE.redLight);
      ctx.fillStyle = drape;
      ctx.beginPath();
      ctx.moveTo(side * hw, -hh);
      ctx.lineTo(side * hw * 0.1, -hh);
      ctx.quadraticCurveTo(side * hw * 0.5, -hh * 0.2, side * hw * 0.8, hh * 0.22);
      ctx.quadraticCurveTo(side * hw * 0.7, hh * 0.6, side * hw * 0.78, hh);
      ctx.lineTo(side * hw, hh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 10, 30, 0.35)';
      ctx.lineWidth = 2 * l.unit;
      ctx.beginPath();
      ctx.moveTo(side * hw * 0.45, -hh);
      ctx.quadraticCurveTo(side * hw * 0.7, -hh * 0.3, side * hw * 0.86, hh * 0.2);
      ctx.stroke();
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.ellipse(side * hw * 0.88, hh * 0.22, hw * 0.13, hw * 0.05, side * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    drawTag(ctx, l);
  }

  function drawGlass(ctx: CanvasRenderingContext2D, l: Layout, frostAlpha: number): void {
    const { hw, hh } = l;
    ctx.save();
    glassPath(ctx, hw, hh, 0);
    ctx.clip();
    drawInterior(ctx, l);
    if (frost !== null && frostAlpha > 0) {
      ctx.save();
      ctx.globalAlpha *= frostAlpha;
      ctx.drawImage(frost.canvas, -hw, -hh, hw * 2, hh * 2);
      TWINKLES.forEach((twinkle, i) => {
        const col = Math.floor(twinkle.x * GRID_COLS);
        const row = Math.floor(twinkle.y * GRID_ROWS);
        if (wiped[row * GRID_COLS + col]) return;
        const shimmer = 0.5 + 0.5 * Math.sin(stage.time * 2.6 + i * 1.7);
        const x = (twinkle.x * 2 - 1) * hw;
        const y = (twinkle.y * 2 - 1) * hh;
        sparkle(ctx, x, y, (5 + 5 * shimmer) * l.unit, PALETTE.white, shimmer, i);
      });
      ctx.restore();
    }
    ctx.fillStyle = `rgba(255, 246, 207, ${0.85 * (1 - frostAlpha)})`;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    for (const [offset, width] of [
      [-0.5, 0.28],
      [-0.05, 0.1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(hw * offset, -hh);
      ctx.lineTo(hw * (offset + width), -hh);
      ctx.lineTo(hw * (offset + width - 0.9), hh);
      ctx.lineTo(hw * (offset - 0.9), hh);
      ctx.closePath();
      ctx.fill();
    }
    glassPath(ctx, hw, hh, 0);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.3)';
    ctx.lineWidth = 9 * l.unit;
    ctx.stroke();
    ctx.restore();
  }

  function drawSnow(ctx: CanvasRenderingContext2D, l: Layout): void {
    const { hw, hh, frame, unit } = l;
    const sillTop = hh + frame * 0.5;
    const reach = hw + frame + 6 * unit;
    const snow = ctx.createLinearGradient(0, sillTop - 26 * unit, 0, sillTop + 4 * unit);
    snow.addColorStop(0, PALETTE.white);
    snow.addColorStop(1, PALETTE.ice);
    ctx.fillStyle = snow;
    ctx.beginPath();
    ctx.moveTo(-reach, sillTop + 3 * unit);
    ctx.bezierCurveTo(
      -reach,
      sillTop - 20 * unit,
      -hw * 0.6,
      sillTop - 30 * unit,
      -hw * 0.3,
      sillTop - 14 * unit,
    );
    ctx.bezierCurveTo(
      -hw * 0.1,
      sillTop - 6 * unit,
      hw * 0.1,
      sillTop - 24 * unit,
      hw * 0.45,
      sillTop - 20 * unit,
    );
    ctx.bezierCurveTo(
      hw * 0.8,
      sillTop - 16 * unit,
      reach,
      sillTop - 22 * unit,
      reach,
      sillTop + 3 * unit,
    );
    ctx.closePath();
    ctx.fill();

    const crown = -hh - frame;
    const cap = ctx.createLinearGradient(0, crown - 12 * unit, 0, crown + 22 * unit);
    cap.addColorStop(0, PALETTE.white);
    cap.addColorStop(1, PALETTE.ice);
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(0, -hh + hw, hw + frame + 9 * unit, Math.PI * 1.2, Math.PI * 1.8);
    ctx.quadraticCurveTo(hw * 0.5, crown + 16 * unit, hw * 0.2, crown + 9 * unit);
    ctx.quadraticCurveTo(0, crown + 20 * unit, -hw * 0.25, crown + 9 * unit);
    ctx.quadraticCurveTo(-hw * 0.5, crown + 18 * unit, -hw * 0.74, crown + 30 * unit);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(219, 231, 243, 0.9)';
    for (const [x, length] of [
      [-0.82, 26],
      [-0.6, 15],
      [0.5, 20],
      [0.76, 30],
      [0.95, 14],
    ]) {
      const top = sillTop + 20 * unit;
      ctx.beginPath();
      ctx.moveTo(hw * x - 5 * unit, top);
      ctx.lineTo(hw * x + 5 * unit, top);
      ctx.lineTo(hw * x, top + length * unit);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawWindow(ctx: CanvasRenderingContext2D, l: Layout, frostAlpha: number): void {
    const { hw, hh, frame, unit } = l;
    glow(ctx, 0, 0, hw * 2.6, GOLD_GLOW_RGB, 0.12 + 0.4 * progress);

    const wood = ctx.createLinearGradient(-hw - frame, 0, hw + frame, 0);
    wood.addColorStop(0, PALETTE.redLight);
    wood.addColorStop(0.3, PALETTE.red);
    wood.addColorStop(1, PALETTE.redDeep);
    glassPath(ctx, hw, hh, frame);
    ctx.fillStyle = wood;
    ctx.fill();
    glassPath(ctx, hw, hh, frame * 0.55);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 2.5 * unit;
    ctx.stroke();

    drawGlass(ctx, l, frostAlpha);

    glassPath(ctx, hw, hh, 1.5 * unit);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 3 * unit;
    ctx.stroke();
    const bar = 9 * unit;
    ctx.fillStyle = wood;
    ctx.fillRect(-hw, -hh + hw - bar / 2, hw * 2, bar);
    ctx.fillRect(-bar / 2, -hh, bar, hw);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(-hw, -hh + hw - bar / 2, hw * 2, 2 * unit);
    ctx.fillRect(-bar / 2, -hh, 2 * unit, hw);

    const sillTop = hh + frame * 0.5;
    const sillHalf = hw + frame + 14 * unit;
    const sill = ctx.createLinearGradient(0, sillTop, 0, sillTop + 22 * unit);
    sill.addColorStop(0, PALETTE.redLight);
    sill.addColorStop(0.35, PALETTE.red);
    sill.addColorStop(1, PALETTE.redDeep);
    ctx.fillStyle = sill;
    ctx.beginPath();
    ctx.roundRect(-sillHalf, sillTop, sillHalf * 2, 22 * unit, 7 * unit);
    ctx.fill();
    drawSnow(ctx, l);
  }

  return {
    update(dt) {
      pulse.update(dt);
      if (meltedAt === null || stage.time - meltedAt <= COMPLETE_DELAY) return;
      const l = layout();
      stage.complete({ x: l.cx, y: l.cy });
    },
    draw(ctx) {
      const l = layout();
      if (meltedAt === null) ensureFrost(l);
      const elapsed = meltedAt === null ? 0 : stage.time - meltedAt;
      const fade = 1 - easeOutCubic((elapsed - 0.3) / 0.55);
      if (meltedAt !== null) {
        const flare = 0.9 * (1 - clamp(elapsed / 1.1, 0, 1));
        glow(ctx, l.cx, l.cy, l.hw * (2 + elapsed * 6), GOLD_GLOW_RGB, flare);
      }
      if (fade <= 0) return;
      const floor = l.cy + l.hh + l.frame + 46 * l.unit;
      softShadow(ctx, l.cx, floor, l.hw * 1.5, l.hw * 0.2, 0.26 * fade);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(l.cx, l.cy + easeInCubic((elapsed - 0.3) / 0.55) * l.hh * 0.7);
      const swell = 1 + pulse.value * 0.03 + easeOutCubic(elapsed / 0.5) * 0.06;
      ctx.scale(swell, swell);
      drawWindow(ctx, l, 1 - clamp(elapsed / MELT_TIME, 0, 1));
      ctx.restore();
    },
    onPointerDown(point) {
      last = null;
      wipeTo(point);
    },
    onPointerMove(point, down) {
      if (down) wipeTo(point);
    },
    onPointerUp() {
      last = null;
    },
  };
};
