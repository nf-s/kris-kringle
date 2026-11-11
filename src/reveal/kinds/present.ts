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

const COMPLETE_DELAY = 0.4;
const HINT = 'Pull the ribbon';

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
  threshold: number;
}

interface Opened {
  at: number;
  knot: Point;
  end: Point;
  direction: Point;
  lidSide: number;
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

function drawBand(ctx: CanvasRenderingContext2D, top: number, height: number): void {
  ctx.fillStyle = satinGradient(ctx, { x: -17, y: 0 }, { x: 17, y: 0 });
  ctx.fillRect(-17, top, 34, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(-6, top, 3, height);
}

function drawBody(ctx: CanvasRenderingContext2D, open: boolean): void {
  const { halfWidth, height } = BODY;
  roundedRect(ctx, -halfWidth, -height, halfWidth * 2, height, 14);
  ctx.fillStyle = wrapGradient(ctx, halfWidth, PALETTE.redLight);
  ctx.fill();

  ctx.save();
  roundedRect(ctx, -halfWidth, -height, halfWidth * 2, height, 14);
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
  roundedRect(ctx, -halfWidth, top, halfWidth * 2, height, 11);
  ctx.fillStyle = wrapGradient(ctx, halfWidth, '#f57686');
  ctx.fill();
  ctx.save();
  roundedRect(ctx, -halfWidth, top, halfWidth * 2, height, 11);
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

/** Bow loops and knot, with the origin at the knot. */
function drawBow(ctx: CanvasRenderingContext2D, loopScale: number): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * loopScale, loopScale);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(18, -48, 76, -54, 72, -16);
    ctx.bezierCurveTo(70, 10, 24, 10, 0, 0);
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
): void {
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.scale(scale, scale);
  if (pulse > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 15 + pulse * 14, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - pulse)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
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
  const pullX = new Spring(0, 190, 9);
  const pullY = new Spring(0, 190, 9);
  const wobble = new Spring(0, 160, 6);
  let grabOffset: Point | null = null;
  let tension = 0;
  let opened: Opened | null = null;
  let completeSent = false;
  let emitTimer = 0;

  stage.setHint(HINT);

  function layout(): Layout {
    const scale = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    const cx = stage.width / 2;
    const reach = stage.width - (cx + TAIL_REST.x * scale) - 20;
    const threshold = clamp(Math.min(0.45 * Math.min(stage.width, stage.height), reach), 70, 280);
    return { cx, floorY: stage.height * 0.52 + 118 * scale, scale, threshold };
  }

  function tailRest(l: Layout): Point {
    const sway = Math.sin(stage.time * 1.8) * 4 * l.scale * (1 - tension);
    return { x: l.cx + TAIL_REST.x * l.scale + sway, y: l.floorY + TAIL_REST.y * l.scale };
  }

  function tailEnd(l: Layout): Point {
    const rest = tailRest(l);
    return { x: rest.x + pullX.value, y: rest.y + pullY.value };
  }

  function lean(l: Layout): number {
    const pull = clamp(pullX.value / l.threshold, -1, 1) * 0.07;
    return pull + wobble.value + Math.sin(stage.time * 58) * tension * tension * 0.012;
  }

  function knotPoint(l: Layout, angle: number): Point {
    return {
      x: l.cx - KNOT_Y * l.scale * Math.sin(angle),
      y: l.floorY + KNOT_Y * l.scale * Math.cos(angle),
    };
  }

  function open(l: Layout): void {
    const knot = knotPoint(l, lean(l));
    const end = tailEnd(l);
    const length = Math.max(1, Math.hypot(end.x - knot.x, end.y - knot.y));
    const direction = { x: (end.x - knot.x) / length, y: (end.y - knot.y) / length };
    opened = { at: stage.time, knot, end, direction, lidSide: direction.x >= 0 ? -1 : 1 };
    grabOffset = null;
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
      x: l.cx,
      y: l.floorY - BODY.height * l.scale,
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

  function drag(point: Point): void {
    if (grabOffset === null || opened !== null) return;
    const l = layout();
    const rest = tailRest(l);
    pullX.value = point.x - grabOffset.x - rest.x;
    pullY.value = point.y - grabOffset.y - rest.y;
    pullX.velocity = 0;
    pullY.velocity = 0;
    const pull = Math.hypot(pullX.value, pullY.value);
    tension = clamp(pull / l.threshold, 0, 1);
    stage.setProgress(tension);
    stage.setHint(tension > 0.6 ? 'Keep pulling' : HINT);
    if (tension > 0.05) stage.sfx.stretch(tension);
    if (pull >= l.threshold) open(l);
  }

  function release(): void {
    if (grabOffset === null) return;
    grabOffset = null;
    wobble.velocity += (pullX.value >= 0 ? -1 : 1) * tension * 1.3;
    if (tension > 0.2) stage.sfx.tap(0.8);
    stage.setProgress(0);
    stage.setHint(HINT);
  }

  function drawTail(ctx: CanvasRenderingContext2D, l: Layout, knot: Point, end: Point): void {
    const slack = 1 - tension;
    const control = {
      x: (knot.x + end.x) / 2 + TAIL_DROOP.x * l.scale * slack,
      y: (knot.y + end.y) / 2 + TAIL_DROOP.y * l.scale * slack,
    };
    strokeRibbon(ctx, knot, control, end, lerp(15, 8, tension) * l.scale);
    const idle = grabOffset === null && tension < 0.05;
    const angle = Math.atan2(end.y - control.y, end.x - control.x);
    drawTassel(ctx, end, angle, l.scale, idle ? (stage.time * 0.9) % 1 : 0);
  }

  function drawClosed(ctx: CanvasRenderingContext2D, l: Layout): void {
    const angle = lean(l);
    softShadow(ctx, l.cx, l.floorY, 130 * l.scale, 20 * l.scale);
    ctx.save();
    ctx.translate(l.cx, l.floorY);
    ctx.rotate(angle);
    ctx.scale(l.scale, l.scale);
    drawBody(ctx, false);
    drawLid(ctx);
    strokeRibbon(ctx, SHORT_TAIL[0], SHORT_TAIL[1], SHORT_TAIL[2], 15);
    ctx.restore();

    drawTail(ctx, l, knotPoint(l, angle), tailEnd(l));

    ctx.save();
    ctx.translate(l.cx, l.floorY);
    ctx.rotate(angle);
    ctx.scale(l.scale, l.scale);
    ctx.translate(0, KNOT_Y);
    drawBow(ctx, 1 - 0.8 * tension);
    ctx.restore();
  }

  function drawOpened(ctx: CanvasRenderingContext2D, l: Layout, o: Opened): void {
    const elapsed = stage.time - o.at;
    const s = l.scale;
    const drop = easeInCubic((elapsed - COMPLETE_DELAY) / 0.5);
    const mouthY = l.floorY - BODY.height * s;
    glow(
      ctx,
      l.cx,
      mouthY,
      s * (130 + elapsed * 700),
      GOLD_GLOW_RGB,
      0.9 * (1 - clamp(elapsed / 1.1, 0, 1)),
    );

    if (drop < 1) {
      softShadow(ctx, l.cx, l.floorY, 130 * s, 20 * s, 0.28 * (1 - drop));
      ctx.save();
      ctx.globalAlpha = 1 - drop;
      ctx.translate(l.cx, l.floorY + drop * stage.height * 0.5);
      ctx.scale(s, s);
      drawBody(ctx, true);
      ctx.restore();
    }

    const lidAlpha = 1 - clamp((elapsed - 0.45) / 0.4, 0, 1);
    if (lidAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = lidAlpha;
      ctx.translate(
        l.cx + o.lidSide * 170 * s * elapsed,
        l.floorY + (LID_CENTRE_Y - 1500 * elapsed + 800 * elapsed * elapsed) * s,
      );
      ctx.rotate(o.lidSide * elapsed * 4.2);
      ctx.scale(s, s);
      ctx.translate(0, -LID_CENTRE_Y);
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
      strokeRibbon(ctx, from, control, to, 9 * s);
      drawTassel(ctx, to, Math.atan2(o.direction.y, o.direction.x), s, 0);
      ctx.restore();
    }
  }

  return {
    update(dt) {
      wobble.update(dt);
      const l = layout();
      if (opened === null) {
        if (grabOffset === null) {
          pullX.update(dt);
          pullY.update(dt);
          tension = clamp(Math.hypot(pullX.value, pullY.value) / l.threshold, 0, 1);
        }
        return;
      }
      const elapsed = stage.time - opened.at;
      emitTimer += dt;
      while (elapsed < 0.5 && emitTimer > 0.02) {
        emitTimer -= 0.02;
        stage.particles.burst({
          x: l.cx + rand(-70, 70) * l.scale,
          y: l.floorY - BODY.height * l.scale,
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
        stage.complete({ x: l.cx, y: l.floorY - BODY.height * l.scale });
      }
    },
    draw(ctx) {
      const l = layout();
      if (opened === null) drawClosed(ctx, l);
      else drawOpened(ctx, l, opened);
    },
    onPointerDown(point) {
      if (opened !== null) return;
      const l = layout();
      const end = tailEnd(l);
      const knot = knotPoint(l, lean(l));
      const nearEnd = Math.hypot(point.x - end.x, point.y - end.y) <= Math.max(48, 44 * l.scale);
      const middle = {
        x: (knot.x + end.x) / 2 + TAIL_DROOP.x * l.scale * 0.5,
        y: (knot.y + end.y) / 2,
      };
      const nearRibbon = Math.hypot(point.x - middle.x, point.y - middle.y) <= 30 * l.scale;
      if (!nearEnd && !nearRibbon) return;
      grabOffset = { x: point.x - end.x, y: point.y - end.y };
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
