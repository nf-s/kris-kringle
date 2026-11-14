import {
  GOLD_GLOW_RGB,
  OUTLINE_WEIGHT,
  PALETTE,
  Spring,
  clamp,
  easeOutCubic,
  glow,
  inkOutline,
  rand,
  softShadow,
  sparkle,
} from '../draw';
import type { Point, RevealFactory } from '../engine';

const HITS_TO_BREAK = 20;
const HITS_PER_DODGE = 4;
/** Seconds without a tap before the newest crack seals over. */
const SEAL_AFTER = 1.7;
const SEAL_INTERVAL = 0.7;
const COMPLETE_DELAY = 0.4;
/** One sharp phone impact does the work of five screen taps. */
const HITS_PER_IMPACT = 5;

interface Crack {
  /** Polylines in unit egg space (x and y in -1..1). */
  branches: Point[][];
  age: number;
}

interface Layout {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Where the egg rests, used for the contact shadow while it hops. */
  floorY: number;
  /** Pixels per drawing unit. */
  scale: number;
}

const SPECKLES: readonly { x: number; y: number; r: number; spin: number }[] = [
  { x: -0.42, y: -0.52, r: 0.07, spin: 0.2 },
  { x: 0.3, y: -0.66, r: 0.05, spin: 0.6 },
  { x: 0.56, y: -0.3, r: 0.08, spin: 0.1 },
  { x: -0.68, y: -0.12, r: 0.05, spin: 0.9 },
  { x: 0.02, y: -0.4, r: 0.045, spin: 0.4 },
  { x: -0.2, y: -0.8, r: 0.04, spin: 0.3 },
  { x: 0.72, y: 0.08, r: 0.045, spin: 0.7 },
];

function eggPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(0.62, -1, 1, -0.25, 1, 0.2);
  ctx.bezierCurveTo(1, 0.72, 0.56, 1, 0, 1);
  ctx.bezierCurveTo(-0.56, 1, -1, 0.72, -1, 0.2);
  ctx.bezierCurveTo(-1, -0.25, -0.62, -1, 0, -1);
  ctx.closePath();
}

/** Jagged break line across the egg, in unit space. */
const BREAK_LINE: readonly Point[] = Array.from({ length: 12 }, (_, i) => ({
  x: -1.2 + (i * 2.4) / 11,
  y: 0.08 + (i % 2 === 0 ? -0.09 : 0.09),
}));

function clipHalf(ctx: CanvasRenderingContext2D, top: boolean): void {
  ctx.beginPath();
  ctx.moveTo(-1.3, top ? -1.3 : 1.3);
  for (const point of BREAK_LINE) ctx.lineTo(point.x, point.y);
  ctx.lineTo(1.3, top ? -1.3 : 1.3);
  ctx.closePath();
  ctx.clip();
}

function strokeBranch(
  ctx: CanvasRenderingContext2D,
  branch: readonly Point[],
  visible: number,
  offset: number,
  color: string,
  lineWidth: number,
): void {
  ctx.beginPath();
  ctx.moveTo(branch[0].x + offset, branch[0].y + offset);
  for (let i = 1; i < visible; i++) ctx.lineTo(branch[i].x + offset, branch[i].y + offset);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function makeCrack(origin: Point): Crack {
  const branches: Point[][] = [];
  const branchCount = 2 + Math.floor(Math.random() * 3);
  const baseAngle = rand(0, Math.PI * 2);
  for (let b = 0; b < branchCount; b++) {
    let angle = baseAngle + (b * Math.PI * 2) / branchCount + rand(-0.5, 0.5);
    let point = { ...origin };
    const branch = [point];
    const segments = 3 + Math.floor(Math.random() * 4);
    for (let s = 0; s < segments; s++) {
      angle += rand(-0.9, 0.9);
      const length = rand(0.1, 0.22);
      const next = { x: point.x + Math.cos(angle) * length, y: point.y + Math.sin(angle) * length };
      if (next.x * next.x + next.y * next.y > 0.86) break;
      branch.push(next);
      point = next;
    }
    if (branch.length > 1) branches.push(branch);
  }
  return { branches, age: 0 };
}

export const createEgg: RevealFactory = (stage) => {
  const squash = new Spring(0, 260, 13);
  const tilt = new Spring(0, 110, 7);
  const cracks: Crack[] = [];
  let hits = 0;
  let brokenAt: number | null = null;
  let look: Point = { x: 0, y: 0 };
  let blink = 0;
  let nextBlink = 1.5;
  let surprise = 0;
  let nextWiggle = 2.5;
  const dodge = new Spring(0, 90, 10);
  const hop = new Spring(0, 300, 13);
  let dodgeSlot = 0;
  let lastHitAt = 0;
  let dragStart: Point | null = null;
  let hint = '';

  /** Shows `moving` in place of `tapping` while the phone's own movement is in use. */
  function showHint(tapping: string, moving = tapping): void {
    const text = stage.motion.active ? moving : tapping;
    if (text === hint) return;
    hint = text;
    stage.setHint(text);
  }

  function showIdleHint(): void {
    showHint('Tap the egg', 'Jolt your phone or tap the egg');
  }

  showIdleHint();

  function layout(): Layout {
    const scale = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    const rx = 118 * scale;
    const ry = 152 * scale;
    const restY = stage.height * 0.52;
    return {
      cx: stage.width / 2 + dodge.value,
      cy: restY - Math.max(0, hop.value),
      rx,
      ry,
      floorY: restY + ry * 1.02,
      scale,
    };
  }

  /** Hops sideways to one of three spots so the next taps have to find it again. */
  function dodgeAway(l: Layout): void {
    const reach = Math.max(0, Math.min(stage.width / 2 - l.rx - 14, l.rx * 0.9));
    const slots = [-1, 0, 1].filter((slot) => slot !== dodgeSlot);
    dodgeSlot = slots[Math.floor(Math.random() * slots.length)];
    dodge.target = dodgeSlot * reach;
    hop.velocity += 760;
    stage.sfx.whoosh();
  }

  function sealNewestCrack(l: Layout): void {
    hits -= 1;
    cracks.pop();
    lastHitAt = stage.time - (SEAL_AFTER - SEAL_INTERVAL);
    stage.setProgress(hits / HITS_TO_BREAK);
    showHint('Cracks are sealing. Tap faster', 'Cracks are sealing. Faster');
    stage.sfx.tap(0.7);
    stage.particles.burst({
      x: l.cx,
      y: l.cy,
      count: 5,
      colors: [PALETTE.gold, PALETTE.goldPale],
      shapes: ['star'],
      speed: [60, 200],
      size: [6, 12],
      life: [0.4, 0.8],
      gravity: 0,
      drag: 2,
    });
  }

  function toLocal(point: Point, l: Layout): Point {
    return { x: (point.x - l.cx) / l.rx, y: (point.y - l.cy) / l.ry };
  }

  function strike(point: Point, hitCount = 1): boolean {
    const l = layout();
    const local = toLocal(point, l);
    const distance = Math.hypot(local.x, local.y);
    if (distance > 1.15 || brokenAt !== null) return false;
    const scaleIn = distance > 0.7 ? 0.7 / distance : 1;
    lastHitAt = stage.time;
    const before = hits;
    hits = Math.min(HITS_TO_BREAK, hits + hitCount);
    for (let hit = before; hit < hits; hit++) {
      cracks.push(makeCrack({ x: local.x * scaleIn, y: local.y * scaleIn }));
    }
    squash.velocity += 2.4;
    tilt.velocity += (local.x < 0 ? 1 : -1) * rand(2, 3.4);
    surprise = 1;
    stage.setProgress(hits / HITS_TO_BREAK);
    stage.particles.burst({
      x: point.x,
      y: point.y,
      count: 7 + hits,
      colors: [PALETTE.cream, PALETTE.white, PALETTE.creamShade],
      shapes: ['shard'],
      speed: [120, 380],
      size: [5, 11],
      life: [0.5, 1],
      gravity: 1200,
    });

    if (hits < HITS_TO_BREAK) {
      stage.sfx.crack(hits / HITS_TO_BREAK);
      stage.shake(4 + hits);
      stage.haptic(12);
      if (hits >= HITS_TO_BREAK - 4) showHint('Nearly there');
      else showHint('Keep tapping', 'Keep going');
      if (Math.floor(hits / HITS_PER_DODGE) > Math.floor(before / HITS_PER_DODGE)) dodgeAway(l);
      return true;
    }

    brokenAt = stage.time;
    stage.sfx.crack(1);
    stage.sfx.pop();
    stage.shake(20);
    stage.haptic([30, 40, 70]);
    showHint('');
    stage.particles.burst({
      x: l.cx,
      y: l.cy,
      count: 46,
      colors: [PALETTE.cream, PALETTE.white, PALETTE.creamShade, PALETTE.goldPale],
      shapes: ['shard'],
      speed: [250, 900],
      size: [8, 22],
      life: [0.8, 1.6],
      gravity: 1500,
    });
    stage.particles.burst({
      x: l.cx,
      y: l.cy,
      count: 30,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      speed: [150, 700],
      size: [8, 20],
      life: [0.7, 1.5],
      gravity: 200,
      drag: 2,
    });
    return true;
  }

  /**
   * The sensor reports one flick per sharp jolt, including a tap-like stop along the phone's
   * depth axis. Treat it as an impact on the egg's base, without needing a sideways swing.
   */
  function impact(): void {
    const flick = stage.motion.flick;
    if (!stage.motion.active || !flick) return;
    const l = layout();
    strike({ x: l.cx + flick.direction.x * l.rx * 0.45, y: l.cy + l.ry * 0.55 }, HITS_PER_IMPACT);
  }

  function drawShell(ctx: CanvasRenderingContext2D): void {
    eggPath(ctx);
    const base = ctx.createRadialGradient(-0.35, -0.5, 0.05, -0.1, -0.1, 1.45);
    base.addColorStop(0, '#fffefb');
    base.addColorStop(0.45, '#f8eddc');
    base.addColorStop(0.85, '#e2cfb6');
    base.addColorStop(1, '#c9b196');
    ctx.fillStyle = base;
    ctx.fill();

    ctx.save();
    eggPath(ctx);
    ctx.clip();

    // Festive band.
    ctx.fillStyle = PALETTE.red;
    ctx.beginPath();
    ctx.moveTo(-1.1, 0.5);
    for (let i = 0; i <= 12; i++) {
      ctx.lineTo(-1.1 + (i * 2.2) / 12, 0.5 + (i % 2 === 0 ? 0 : -0.1));
    }
    ctx.lineTo(1.1, 0.76);
    for (let i = 12; i >= 0; i--) {
      ctx.lineTo(-1.1 + (i * 2.2) / 12, 0.76 + (i % 2 === 0 ? 0 : -0.1));
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.goldPale;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(-0.78 + i * 0.26, 0.6, 0.04, 0.032, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const speckle of SPECKLES) {
      ctx.save();
      ctx.translate(speckle.x, speckle.y);
      ctx.scale(1, 0.78);
      sparkle(ctx, 0, 0, speckle.r, PALETTE.gold, 0.9, speckle.spin);
      ctx.restore();
    }

    // Edge shading and specular highlight.
    const rim = ctx.createRadialGradient(0, 0.05, 0.55, 0, 0.05, 1.15);
    rim.addColorStop(0, 'rgba(120, 90, 60, 0)');
    rim.addColorStop(1, 'rgba(120, 90, 60, 0.32)');
    ctx.fillStyle = rim;
    ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    const shine = ctx.createRadialGradient(-0.4, -0.52, 0, -0.4, -0.52, 0.42);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shine;
    ctx.fillRect(-1.2, -1.2, 2.4, 2.4);

    for (const crack of cracks) {
      const reveal = clamp(crack.age / 0.14, 0, 1);
      for (const branch of crack.branches) {
        const visible = Math.max(2, Math.ceil(branch.length * reveal));
        strokeBranch(ctx, branch, visible, 0.012, 'rgba(255, 255, 255, 0.8)', 0.014);
        strokeBranch(ctx, branch, visible, 0, 'rgba(84, 58, 40, 0.9)', 0.02);
      }
    }
    ctx.restore();
  }

  function drawFace(ctx: CanvasRenderingContext2D, l: Layout): void {
    const u = l.rx;
    const eyeY = -0.02 * l.ry;
    const eyeOpen = 1 - blink;
    const eyeRadius = u * (0.085 + 0.03 * surprise);
    ctx.fillStyle = 'rgba(246, 140, 160, 0.45)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 0.52 * u, eyeY + 0.2 * u, 0.13 * u, 0.085 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const side of [-1, 1]) {
      const x = side * 0.3 * u + look.x * u * 0.035;
      const y = eyeY + look.y * u * 0.035;
      ctx.fillStyle = '#2b2233';
      ctx.beginPath();
      ctx.ellipse(x, y, eyeRadius, Math.max(eyeRadius * eyeOpen, u * 0.012), 0, 0, Math.PI * 2);
      ctx.fill();
      if (eyeOpen > 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - eyeRadius * 0.3, y - eyeRadius * 0.35, eyeRadius * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#2b2233';
    ctx.fillStyle = '#2b2233';
    ctx.lineWidth = u * 0.028;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (surprise > 0.3) {
      ctx.ellipse(0, eyeY + 0.2 * u, 0.045 * u, 0.06 * u * surprise, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.arc(0, eyeY + 0.13 * u, 0.09 * u, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }

  /** Ink round a shell `width` by `height` pixels across its half-axes, centred on the origin. */
  function outlineShell(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    width: number,
    height: number,
  ): void {
    inkOutline(ctx, OUTLINE_WEIGHT * l.scale, () => {
      ctx.save();
      ctx.scale(width, height);
      eggPath(ctx);
      ctx.restore();
    });
  }

  function drawWhole(ctx: CanvasRenderingContext2D, l: Layout): void {
    const bob = Math.sin(stage.time * 1.7) * 3;
    softShadow(ctx, l.cx, l.floorY, l.rx * 1.15, l.rx * 0.2);
    ctx.save();
    ctx.translate(l.cx, l.cy + l.ry + bob);
    ctx.rotate(tilt.value * 0.12);
    ctx.translate(0, -l.ry);
    const width = l.rx * (1 + squash.value * 0.1);
    const height = l.ry * (1 - squash.value * 0.1);
    outlineShell(ctx, l, width, height);
    ctx.save();
    ctx.scale(width, height);
    drawShell(ctx);
    ctx.restore();
    drawFace(ctx, l);
    ctx.restore();
  }

  function drawBroken(ctx: CanvasRenderingContext2D, l: Layout, elapsed: number): void {
    const fade = 1 - easeOutCubic((elapsed - 0.25) / 0.6);
    glow(
      ctx,
      l.cx,
      l.cy,
      l.rx * (1.5 + elapsed * 5),
      GOLD_GLOW_RGB,
      0.9 * (1 - clamp(elapsed / 1.1, 0, 1)),
    );
    if (fade <= 0) return;
    softShadow(ctx, l.cx, l.cy + l.ry * 1.02, l.rx * 1.15, l.rx * 0.2, 0.28 * fade);
    for (const top of [true, false]) {
      ctx.save();
      ctx.globalAlpha = fade;
      const travel = easeOutCubic(elapsed / 0.7);
      if (top) {
        ctx.translate(l.cx - travel * l.rx * 0.5, l.cy - travel * l.ry * 1.5);
        ctx.rotate(-travel * 0.9);
      } else {
        ctx.translate(l.cx, l.cy + travel * l.ry * 0.5);
      }
      ctx.scale(l.rx, l.ry);
      clipHalf(ctx, top);
      ctx.scale(1 / l.rx, 1 / l.ry);
      outlineShell(ctx, l, l.rx, l.ry);
      ctx.scale(l.rx, l.ry);
      drawShell(ctx);
      ctx.restore();
    }
  }

  return {
    footprint() {
      const l = layout();
      return [
        {
          x: stage.width / 2,
          y: stage.height * 0.52,
          halfWidth: l.rx,
          halfHeight: l.ry,
          round: true,
        },
      ];
    },
    update(dt) {
      squash.update(dt);
      tilt.update(dt);
      dodge.update(dt);
      hop.update(dt);
      if (brokenAt === null) impact();
      if (hits === 0 && brokenAt === null) showIdleHint();
      if (hits > 0 && brokenAt === null && stage.time - lastHitAt > SEAL_AFTER) {
        sealNewestCrack(layout());
      }
      surprise = Math.max(0, surprise - dt * 1.6);
      for (const crack of cracks) crack.age += dt;

      nextBlink -= dt;
      if (nextBlink < 0) {
        blink = 1;
        nextBlink = rand(1.8, 4.5);
      }
      blink = Math.max(0, blink - dt * 7);

      if (hits === 0) {
        nextWiggle -= dt;
        if (nextWiggle < 0) {
          tilt.velocity += rand(-2.2, 2.2);
          squash.velocity += 0.8;
          nextWiggle = rand(2.2, 3.6);
        }
      }

      if (brokenAt !== null && stage.time - brokenAt > COMPLETE_DELAY) {
        const l = layout();
        stage.complete({ x: l.cx, y: l.cy });
      }
    },
    draw(ctx) {
      const l = layout();
      if (brokenAt === null) drawWhole(ctx, l);
      else drawBroken(ctx, l, stage.time - brokenAt);
    },
    onPointerDown(point) {
      if (strike(point)) dragStart = point;
    },
    onPointerMove(point, down) {
      const l = layout();
      if (down && dragStart && brokenAt === null) {
        tilt.target = clamp((point.x - dragStart.x) / l.rx, -1, 1) * 3.2;
      }
      const local = toLocal(point, l);
      const length = Math.max(1, Math.hypot(local.x, local.y));
      look = { x: local.x / length, y: local.y / length };
    },
    onPointerUp() {
      dragStart = null;
      tilt.target = 0;
    },
  };
};
