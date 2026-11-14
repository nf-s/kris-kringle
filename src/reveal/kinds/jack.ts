import {
  CONFETTI_COLORS,
  GOLD_GLOW_RGB,
  OUTLINE_WEIGHT,
  PALETTE,
  Spring,
  clamp,
  easeInCubic,
  glow,
  inkOutline,
  lerp,
  rand,
  softShadow,
  sparkle,
} from '../draw';
import type { Point, RevealFactory } from '../engine';

const TURNS = 12;
const TOTAL = TURNS * Math.PI * 2;
const NOTE_STEP = Math.PI / 4;
const CLICK_STEP = Math.PI / 6;
const TICK_STEP = Math.PI / 5;
/** Fraction of the total lost per second once the handle stops turning. */
const DECAY = 0.04;
const DECAY_GRACE = 0.6;
const DEAD_ZONE = 10;
const FREEZE_TIME = 0.25;
const COMPLETE_DELAY = 0.5;
const EXIT_TIME = 0.55;
const TAP_SLOP = 8;
/** Turns of the handle for each turn of the phone, which is twisted back and forth by the wrist. */
const PHONE_WIND = 0.9;
/** The phone has to turn faster than this, in radians per second, to move the handle. */
const TWIST_FLOOR = 1;
/** Fastest the phone can turn the handle, in radians per second: about as fast as a finger. */
const TWIST_LIMIT = 9;
/** How quickly the handle picks up and loses the phone's turning, per second. */
const TWIST_FOLLOW = 12;
/** Original music-box loop, in pentatonic steps. */
const MELODY: readonly number[] = [
  4, 6, 7, 6, 4, 2, 3, 4, 7, 9, 8, 7, 6, 4, 5, 4, 2, 4, 3, 1, 2, 4, 6, 5,
];
const INK = '#2b2233';

/** Design units, relative to the centre of the box's base. Negative y is up. */
const BOX = { halfWidth: 80, height: 124 };
const LID = { overhang: 5, thickness: 24 };
const LID_WIDTH = (BOX.halfWidth + LID.overhang) * 2;
const HINGE: Point = { x: -BOX.halfWidth - LID.overhang, y: -BOX.height };
const AXLE: Point = { x: BOX.halfWidth + 22, y: -BOX.height * 0.52 };
const ARM = 50;
const KNOB_RADIUS = 14;
const COIL_BASE = -BOX.height + 70;
const HEAD_RADIUS = 40;
const JACK_RISE = 170;
const COIL_LOOPS = 9;
const COLLAR_SPIKES = 7;
const BELL_RADIUS = 5;
const LATCH = { x: LID_WIDTH - 32, y: -6, width: 14, height: 20, radius: 4 };

interface Layout {
  cx: number;
  floorY: number;
  scale: number;
}

type Grab = 'knob' | 'box' | 'lid';

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

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function metal(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, PALETTE.goldDeep);
  gradient.addColorStop(0.25, PALETTE.gold);
  gradient.addColorStop(0.45, PALETTE.goldPale);
  gradient.addColorStop(0.7, PALETTE.gold);
  gradient.addColorStop(1, PALETTE.goldDeep);
  return gradient;
}

function lacquer(
  ctx: CanvasRenderingContext2D,
  from: number,
  to: number,
  light: string,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(from, 0, to, 0);
  gradient.addColorStop(0, PALETTE.redDeep);
  gradient.addColorStop(0.18, PALETTE.red);
  gradient.addColorStop(0.36, light);
  gradient.addColorStop(0.62, PALETTE.red);
  gradient.addColorStop(1, PALETTE.redDeep);
  return gradient;
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number): void {
  const inner = outer * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.closePath();
}

function cornerCap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.lineTo(20, -2);
  ctx.quadraticCurveTo(20, 6, 9, 9);
  ctx.quadraticCurveTo(6, 20, -2, 20);
  ctx.closePath();
  ctx.fillStyle = metal(ctx, -2, -2, 20, 20);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ellipse(ctx, 4, 4, 2.2, 2.2);
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, time: number): void {
  const { halfWidth: hw, height: h } = BOX;
  ctx.beginPath();
  ctx.roundRect(-hw, -h, hw * 2, h, 8);
  ctx.fillStyle = lacquer(ctx, -hw, hw, PALETTE.redLight);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-hw, -h, hw * 2, h, 8);
  ctx.clip();
  const shade = ctx.createLinearGradient(0, -h, 0, 0);
  shade.addColorStop(0, 'rgba(60, 8, 20, 0.3)');
  shade.addColorStop(0.2, 'rgba(60, 8, 20, 0)');
  shade.addColorStop(0.7, 'rgba(60, 8, 20, 0)');
  shade.addColorStop(1, 'rgba(60, 8, 20, 0.35)');
  ctx.fillStyle = shade;
  ctx.fillRect(-hw, -h, hw * 2, h);
  ctx.restore();

  const panel = ctx.createLinearGradient(0, -h + 16, 0, -18);
  panel.addColorStop(0, PALETTE.redDeep);
  panel.addColorStop(1, '#8a1024');
  ctx.beginPath();
  ctx.roundRect(-hw + 15, -h + 16, hw * 2 - 30, h - 34, 6);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = metal(ctx, -hw, 0, hw, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-hw + 20, -h + 20.5);
  ctx.lineTo(hw - 20, -h + 20.5);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = metal(ctx, -hw - 4, 0, hw + 4, 0);
  ctx.beginPath();
  ctx.roundRect(-hw - 4, -11, hw * 2 + 8, 11, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(-hw, -9.5, hw * 2, 2);

  cornerCap(ctx, -hw, -h, 1, 1);
  cornerCap(ctx, hw, -h, -1, 1);
  cornerCap(ctx, -hw, -11, 1, -1);
  cornerCap(ctx, hw, -11, -1, -1);

  const my = -h * 0.52;
  ctx.fillStyle = 'rgba(60, 8, 20, 0.35)';
  ellipse(ctx, 1.5, my + 3, 25, 25);
  const disc = ctx.createRadialGradient(-8, my - 9, 2, 0, my, 25);
  disc.addColorStop(0, '#fff3c4');
  disc.addColorStop(0.35, PALETTE.goldPale);
  disc.addColorStop(0.75, PALETTE.gold);
  disc.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = disc;
  ellipse(ctx, 0, my, 24, 24);
  ctx.strokeStyle = PALETTE.goldDeep;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, my, 19, 0, Math.PI * 2);
  ctx.stroke();
  starPath(ctx, 0, my + 1, 14);
  ctx.fillStyle = PALETTE.red;
  ctx.fill();
  starPath(ctx, -1, my, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fill();
  const glint = Math.max(0, Math.sin(time * 1.3) - 0.85) / 0.15;
  sparkle(ctx, 12, my - 13, 9 * glint, PALETTE.white, glint);

  ctx.beginPath();
  ctx.roundRect(-hw + 6, -h + 14, 6, h - 34, 3);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fill();

  ctx.fillStyle = metal(ctx, hw - 28, 0, hw - 12, 0);
  ctx.beginPath();
  ctx.roundRect(hw - 28, -h + 3, 16, 8, 3);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(hw - 23, -h + 5.5, 6, 3);
}

/** Lid in hinge space: the hinge is the origin and the lid runs along +x. */
function drawLid(ctx: CanvasRenderingContext2D, strain: number): void {
  const w = LID_WIDTH;
  const t = LID.thickness;
  ctx.beginPath();
  ctx.roundRect(0, -t, w, t, 7);
  ctx.fillStyle = lacquer(ctx, 0, w, '#f57686');
  ctx.fill();

  ctx.fillStyle = metal(ctx, 0, 0, w, 0);
  ctx.fillRect(2, -8, w - 4, 6);
  ctx.beginPath();
  ctx.roundRect(10, -t + 4, w - 20, 4, 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fill();
  cornerCap(ctx, 0, -t, 0.8, 0.8);
  cornerCap(ctx, w, -t, -0.8, 0.8);

  const jitter = Math.sin(strain * 97) * strain * 1.5;
  ctx.save();
  ctx.translate(LATCH.x, LATCH.y);
  ctx.rotate(jitter * 0.05);
  ctx.beginPath();
  ctx.roundRect(0, 0, LATCH.width, LATCH.height, LATCH.radius);
  ctx.fillStyle = metal(ctx, 0, 0, LATCH.width, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(43, 34, 51, 0.55)';
  ctx.beginPath();
  ctx.roundRect(4, 9, 6, 8, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillRect(2.5, 2, 2, 12);
  ctx.restore();
}

/** Ink round the latch, in hinge space. Call before `drawLid`, which covers the part on the lid. */
function outlineLatch(ctx: CanvasRenderingContext2D): void {
  inkOutline(ctx, OUTLINE_WEIGHT, () => {
    ctx.beginPath();
    ctx.roundRect(LATCH.x, LATCH.y, LATCH.width, LATCH.height, LATCH.radius);
  });
}

/** Dark gap under a slightly lifted lid, with two eyes looking out. */
function drawPeek(ctx: CanvasRenderingContext2D, lift: number, blink: number, look: number): void {
  const corner = {
    x: HINGE.x + Math.cos(lift) * LID_WIDTH,
    y: HINGE.y - Math.sin(lift) * LID_WIDTH,
  };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(HINGE.x, HINGE.y + 1);
  ctx.lineTo(BOX.halfWidth, HINGE.y + 1);
  ctx.lineTo(corner.x, corner.y);
  ctx.closePath();
  ctx.fillStyle = '#1c1424';
  ctx.fill();
  ctx.clip();
  const tan = Math.tan(lift);
  for (const x of [22, 46]) {
    const gap = (x - HINGE.x) * tan;
    const size = clamp(gap / 3, 0, 7);
    if (size <= 0.5) continue;
    const y = HINGE.y - gap * 0.42;
    ctx.fillStyle = PALETTE.white;
    ellipse(ctx, x, y, size, size * blink);
    ctx.fillStyle = INK;
    ellipse(ctx, x + look * size * 0.35, y + size * 0.1, size * 0.55, size * 0.6 * blink);
    ctx.fillStyle = PALETTE.white;
    ellipse(ctx, x + look * size * 0.35 - size * 0.2, y - size * 0.15, size * 0.18, size * 0.18);
  }
  ctx.restore();
}

/** Height of one loop of the spring when its top is at `top`. */
function coilLoopY(top: number, index: number): number {
  return COIL_BASE - ((COIL_BASE - top) * (index + 0.5)) / COIL_LOOPS;
}

function outlineCoil(ctx: CanvasRenderingContext2D, top: number): void {
  for (let i = 0; i < COIL_LOOPS; i++) {
    inkOutline(
      ctx,
      OUTLINE_WEIGHT,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, coilLoopY(top, i), 20, 6, -0.12, 0, Math.PI * 2);
      },
      5,
    );
  }
}

function drawCoil(ctx: CanvasRenderingContext2D, top: number): void {
  ctx.lineCap = 'round';
  for (const front of [false, true]) {
    for (let i = 0; i < COIL_LOOPS; i++) {
      const y = coilLoopY(top, i);
      ctx.beginPath();
      if (front) ctx.ellipse(0, y, 20, 6, -0.12, 0, Math.PI);
      else ctx.ellipse(0, y, 20, 6, -0.12, Math.PI, Math.PI * 2);
      ctx.strokeStyle = front ? PALETTE.gold : PALETTE.goldDeep;
      ctx.lineWidth = 5;
      ctx.stroke();
      if (!front) continue;
      ctx.beginPath();
      ctx.ellipse(0, y, 20, 6, -0.12, Math.PI * 0.3, Math.PI * 0.7);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
}

function collarAngle(index: number): number {
  return Math.PI * (0.08 + (index * 0.84) / (COLLAR_SPIKES - 1));
}

/** Tip of one spike of the jester collar, where its bell hangs. */
function collarTip(index: number): Point {
  const angle = collarAngle(index);
  return {
    x: Math.cos(angle) * (HEAD_RADIUS + 22),
    y: HEAD_RADIUS * 0.62 + Math.sin(angle) * 26,
  };
}

/** Adds one spike of the collar to the current path. */
function collarSpike(ctx: CanvasRenderingContext2D, index: number): void {
  const r = HEAD_RADIUS;
  const angle = collarAngle(index);
  const tip = collarTip(index);
  const baseAngle = 0.3;
  ctx.moveTo(Math.cos(angle - baseAngle) * r * 0.75, r * 0.55 + Math.sin(angle - baseAngle) * 8);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(Math.cos(angle + baseAngle) * r * 0.75, r * 0.55 + Math.sin(angle + baseAngle) * 8);
  ctx.closePath();
}

/** Adds the cone of the party hat to the current path, in the hat's own space. */
function hatCone(ctx: CanvasRenderingContext2D): void {
  ctx.moveTo(-22, 0);
  ctx.lineTo(0, -50);
  ctx.lineTo(22, 0);
  ctx.quadraticCurveTo(0, 6, -22, 0);
  ctx.closePath();
}

function hatAngle(time: number): number {
  return 0.22 + Math.sin(time * 5) * 0.05;
}

/** Ink round what `drawSnowman` draws at the same time. */
function outlineSnowman(ctx: CanvasRenderingContext2D, time: number): void {
  const r = HEAD_RADIUS;
  inkOutline(ctx, OUTLINE_WEIGHT, () => {
    ctx.beginPath();
    for (let i = 0; i < COLLAR_SPIKES; i++) {
      collarSpike(ctx, i);
      const tip = collarTip(i);
      ctx.moveTo(tip.x + BELL_RADIUS, tip.y);
      ctx.arc(tip.x, tip.y, BELL_RADIUS, 0, Math.PI * 2);
    }
    ctx.moveTo(r, 0);
    ctx.ellipse(0, 0, r, r * 0.96, 0, 0, Math.PI * 2);
    ctx.save();
    ctx.translate(6, -r * 0.82);
    ctx.rotate(hatAngle(time));
    hatCone(ctx);
    ctx.roundRect(-24, -4, 48, 8, 4);
    ctx.moveTo(8, -50);
    ctx.arc(0, -50, 8, 0, Math.PI * 2);
    ctx.restore();
  });
}

/** Soft-toy snowman head with a jester collar and party hat, centred on the origin. */
function drawSnowman(ctx: CanvasRenderingContext2D, time: number, surprise: number): void {
  const r = HEAD_RADIUS;
  for (let i = 0; i < COLLAR_SPIKES; i++) {
    const tip = collarTip(i);
    ctx.beginPath();
    collarSpike(ctx, i);
    ctx.fillStyle = i % 2 === 0 ? PALETTE.red : PALETTE.gold;
    ctx.fill();
    const bell = ctx.createRadialGradient(tip.x - 1.5, tip.y - 1.5, 0.5, tip.x, tip.y, BELL_RADIUS);
    bell.addColorStop(0, PALETTE.white);
    bell.addColorStop(0.4, PALETTE.goldPale);
    bell.addColorStop(1, PALETTE.goldDeep);
    ctx.fillStyle = bell;
    ellipse(ctx, tip.x, tip.y, BELL_RADIUS, BELL_RADIUS);
  }

  const felt = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  felt.addColorStop(0, PALETTE.white);
  felt.addColorStop(0.55, '#f2f6fb');
  felt.addColorStop(0.85, PALETTE.ice);
  felt.addColorStop(1, PALETTE.iceDeep);
  ctx.fillStyle = felt;
  ellipse(ctx, 0, 0, r, r * 0.96);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.save();
  ctx.translate(-r * 0.42, -r * 0.45);
  ctx.rotate(-0.6);
  ellipse(ctx, 0, 0, r * 0.2, r * 0.1);
  ctx.restore();

  ctx.fillStyle = 'rgba(246, 140, 160, 0.6)';
  ellipse(ctx, -r * 0.52, r * 0.2, 8, 5.5);
  ellipse(ctx, r * 0.52, r * 0.2, 8, 5.5);

  const blink = (time * 0.7) % 3 < 0.12 ? 0.15 : 1;
  const eye = 6 + surprise * 2;
  for (const side of [-1, 1]) {
    ctx.fillStyle = INK;
    ellipse(ctx, side * r * 0.34, -r * 0.08, eye * 0.85, eye * blink);
    ctx.fillStyle = PALETTE.white;
    ellipse(ctx, side * r * 0.34 - 2, -r * 0.08 - 2.5 * blink, 2.2, 2.2 * blink);
  }

  const nose = ctx.createLinearGradient(0, -2, 0, 8);
  nose.addColorStop(0, PALETTE.gold);
  nose.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = nose;
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.quadraticCurveTo(10, 1, 17, 5);
  ctx.quadraticCurveTo(8, 8, -2, 7);
  ctx.closePath();
  ctx.fill();

  const mouth = 4 + surprise * 5;
  ctx.beginPath();
  ctx.moveTo(-11, r * 0.36);
  ctx.quadraticCurveTo(0, r * 0.36 + mouth * 2, 11, r * 0.36);
  ctx.closePath();
  ctx.fillStyle = PALETTE.redDeep;
  ctx.fill();
  ctx.fillStyle = PALETTE.pink;
  ellipse(ctx, 0, r * 0.36 + mouth * 0.8, 4.5, mouth * 0.35);

  ctx.save();
  ctx.translate(6, -r * 0.82);
  ctx.rotate(hatAngle(time));
  ctx.beginPath();
  hatCone(ctx);
  ctx.fillStyle = lacquer(ctx, -22, 22, PALETTE.redLight);
  ctx.save();
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = PALETTE.gold;
  for (let band = 0; band < 4; band++) {
    const y = -8 - band * 13;
    ctx.beginPath();
    ctx.moveTo(-30, y + 6);
    ctx.lineTo(30, y - 6);
    ctx.lineTo(30, y - 11);
    ctx.lineTo(-30, y + 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = metal(ctx, -23, 0, 23, 0);
  ctx.beginPath();
  ctx.roundRect(-24, -4, 48, 8, 4);
  ctx.fill();
  const pom = ctx.createRadialGradient(-2, -53, 1, 0, -50, 8);
  pom.addColorStop(0, PALETTE.white);
  pom.addColorStop(0.5, PALETTE.goldPale);
  pom.addColorStop(1, PALETTE.gold);
  ctx.fillStyle = pom;
  ellipse(ctx, 0, -50, 8, 8);
  ctx.restore();
}

export const createJack: RevealFactory = (stage) => {
  const boxX = new Spring(0, 160, 9);
  const tilt = new Spring(0, 200, 9);
  const squash = new Spring(0, 320, 11);
  const peek = new Spring(0, 200, 13);
  const rattle = new Spring(0, 520, 15);
  const armSnap = new Spring(0, 900, 55);
  const open = new Spring(0, 120, 8);
  const extend = new Spring(0, 170, 7);
  const sway = new Spring(0, 80, 3.5);
  let grab: Grab | null = null;
  let grabX = 0;
  let downPoint: Point = { x: 0, y: 0 };
  let moved = false;
  let hopY = 0;
  let hopVelocity = 0;
  let peekUntil = 0;
  let peekOpen = false;
  let wound = 0;
  let arm = Math.PI * 0.25;
  let lastAngle = 0;
  let debt = 0;
  let lastTurnAt = -10;
  let noteTravel = 0;
  let noteIndex = 0;
  let clickTravel = 0;
  let unwindTravel = 0;
  let shiver = 0;
  /** True in a frame where twisting the phone turned the handle. */
  let twisting = false;
  /** How fast the phone is turning, in radians per second, evened out over a moment. */
  let twistRate = 0;
  let shown = 0;
  let hint = idleHint();
  let nextTease = 3.5;
  let frozenAt: number | null = null;
  let poppedAt: number | null = null;
  let completedAt: number | null = null;

  stage.setHint(hint);

  function layout(): Layout {
    const scale = clamp(Math.min(stage.width / 440, stage.height / 700), 0.55, 1.4);
    return {
      cx: stage.width / 2 - 38 * scale,
      floorY: stage.height * 0.5 + 105 * scale,
      scale,
    };
  }

  function idleHint(): string {
    return stage.motion.active ? 'Twist your phone or turn the handle' : 'Turn the handle';
  }

  function showHint(text: string): void {
    if (text === hint) return;
    hint = text;
    stage.setHint(text);
  }

  function toScreen(l: Layout, x: number, y: number): Point {
    return {
      x: l.cx + (boxX.value + x) * l.scale,
      y: l.floorY + (hopY + y) * l.scale,
    };
  }

  function knobAngle(): number {
    return arm + armSnap.value;
  }

  function tension(): number {
    return wound / TOTAL;
  }

  function lidLift(): number {
    if (poppedAt !== null) return open.value;
    return Math.max(0, peek.value) + Math.max(0, rattle.value) * 0.004;
  }

  function lidRaise(): number {
    return Math.max(0, rattle.value);
  }

  function shake(amount: number): void {
    rattle.velocity += amount;
    stage.sfx.tap(rand(1.7, 2.1));
  }

  function wind(gain: number): void {
    wound = Math.min(TOTAL, wound + gain);
    lastTurnAt = stage.time;
    noteTravel += gain;
    let played = 0;
    while (noteTravel >= NOTE_STEP) {
      noteTravel -= NOTE_STEP;
      if (played < 2) {
        stage.sfx.chime(MELODY[noteIndex % MELODY.length]);
        stage.haptic(5);
        played += 1;
        const t = tension();
        if (t > 0.3 && Math.random() < t * 0.55) shake(rand(60, 150) * t);
      }
      noteIndex += 1;
    }
    if (wound >= TOTAL) freeze();
  }

  function freeze(): void {
    frozenAt = stage.time;
    grab = null;
    showHint('');
    stage.setProgress(1);
    stage.haptic(20);
  }

  function pop(l: Layout): void {
    poppedAt = stage.time;
    peek.target = 0;
    open.target = 2.25;
    open.velocity = 18;
    extend.target = 1;
    extend.velocity = 5;
    sway.velocity = rand(-1.8, 1.8);
    stage.sfx.pop();
    stage.sfx.whoosh();
    stage.shake(22);
    stage.haptic([40, 30, 90]);
    const mouth = toScreen(l, 0, -BOX.height);
    stage.particles.burst({
      x: mouth.x,
      y: mouth.y,
      count: 34,
      colors: [PALETTE.gold, PALETTE.goldPale, PALETTE.white],
      shapes: ['star'],
      angle: -Math.PI / 2,
      spread: 1.7,
      speed: [300, 1000],
      size: [8, 20],
      life: [0.7, 1.5],
      gravity: 500,
      drag: 1.6,
    });
    stage.particles.burst({
      x: mouth.x,
      y: mouth.y,
      count: 46,
      colors: CONFETTI_COLORS,
      shapes: ['rect', 'rect', 'circle'],
      angle: -Math.PI / 2,
      spread: 2.4,
      speed: [250, 900],
      size: [6, 13],
      life: [1, 2],
      gravity: 900,
      drag: 1.2,
    });
  }

  function crank(point: Point, l: Layout): void {
    const axle = toScreen(l, AXLE.x, AXLE.y);
    const dx = point.x - axle.x;
    const dy = point.y - axle.y;
    if (Math.hypot(dx, dy) < DEAD_ZONE) return;
    const angle = Math.atan2(dy, dx);
    const delta = wrapAngle(angle - lastAngle);
    lastAngle = angle;
    arm += delta;
    if (delta < 0) {
      debt -= delta;
      clickTravel -= delta;
      while (clickTravel >= CLICK_STEP) {
        clickTravel -= CLICK_STEP;
        stage.sfx.tap(0.75);
        stage.haptic(3);
      }
      return;
    }
    const paid = Math.min(debt, delta);
    debt -= paid;
    if (delta - paid > 0) wind(delta - paid);
  }

  function hopBox(): void {
    if (hopY < 0) return;
    hopVelocity = -470;
    squash.velocity -= 4;
    stage.sfx.tap(1.1);
    stage.haptic(8);
  }

  function peekLid(): void {
    peek.target = 0.26;
    peekUntil = stage.time + 0.9;
    if (!peekOpen) stage.sfx.tap(1.4);
    peekOpen = true;
    stage.haptic(6);
  }

  function release(): void {
    if (grab === 'box') {
      boxX.target = 0;
      if (!moved) hopBox();
    }
    grab = null;
  }

  function updateIdle(dt: number): void {
    hopVelocity += 2600 * dt;
    hopY += hopVelocity * dt;
    if (hopY >= 0) {
      if (hopVelocity > 200) {
        squash.velocity += hopVelocity * 0.012;
        stage.sfx.tap(0.7);
      }
      hopY = 0;
      hopVelocity = 0;
    }
    if (peekOpen && stage.time > peekUntil) {
      peekOpen = false;
      peek.target = 0;
      stage.sfx.tap(0.9);
      stage.haptic(8);
      squash.velocity += 1.5;
    }
    if (wound === 0 && grab === null && !peekOpen) {
      nextTease -= dt;
      if (nextTease < 0) {
        shake(rand(70, 110));
        nextTease = rand(3.5, 5.5);
      }
    }
  }

  function updateWinding(dt: number): void {
    const idleFor = stage.time - lastTurnAt;
    const decaying = wound > 0 && idleFor > DECAY_GRACE;
    if (decaying) {
      const amount = Math.min(wound, DECAY * TOTAL * dt);
      wound -= amount;
      if (grab !== 'knob') {
        arm -= amount;
        unwindTravel += amount;
        while (unwindTravel >= TICK_STEP) {
          unwindTravel -= TICK_STEP;
          stage.sfx.tap(1.5);
        }
      }
    }
    const t = tension();
    const active = (grab === 'knob' || twisting) && idleFor < 0.25;
    shiver = lerp(shiver, active ? t * t : t * t * 0.15, 1 - Math.exp(-dt * 8));
    if (active && t > 0.5) stage.sfx.stretch((t - 0.5) * 1.4);
    if (Math.abs(t - shown) > 0.003) {
      shown = t;
      stage.setProgress(t);
    }
    if (decaying) showHint('Keep winding');
    else if (t > 0.75) showHint('Nearly there');
    else if (wound > 0) showHint('Keep winding');
    else showHint(idleHint());
  }

  /**
   * Twisting the phone either way turns the handle forwards, no faster than a finger could.
   * The phone reports its turning in bursts, so it is evened out before the limit is applied.
   */
  function windByPhone(dt: number): void {
    if (dt <= 0) return;
    twistRate += (stage.motion.turned / dt - twistRate) * (1 - Math.exp(-dt * TWIST_FOLLOW));
    const turn = clamp((twistRate - TWIST_FLOOR) * PHONE_WIND, 0, TWIST_LIMIT) * dt;
    twisting = turn > 0;
    if (!twisting) return;
    arm += turn;
    wind(turn);
  }

  /** Centre of the handle's knob, in design units. It trembles as the spring tightens. */
  function knobCentre(): Point {
    const angle = knobAngle();
    const strain = shiver * 1.2;
    return {
      x: AXLE.x + Math.cos(angle) * ARM + Math.sin(stage.time * 71) * strain,
      y: AXLE.y + Math.sin(angle) * ARM + Math.cos(stage.time * 63) * strain,
    };
  }

  /** Ink round the box, its lid and the axle. Call before any of them is drawn. */
  function outlineBox(ctx: CanvasRenderingContext2D, lift: number): void {
    const { halfWidth: hw, height: h } = BOX;
    inkOutline(ctx, OUTLINE_WEIGHT, () => {
      ctx.beginPath();
      ctx.rect(hw, AXLE.y - 4.5, AXLE.x - hw, 9);
      ctx.moveTo(hw + 9, AXLE.y);
      ctx.ellipse(hw + 2, AXLE.y, 7, 14, 0, 0, Math.PI * 2);
      ctx.roundRect(-hw, -h, hw * 2, h, 8);
      ctx.roundRect(-hw - 4, -11, hw * 2 + 8, 11, 4);
      ctx.save();
      ctx.translate(HINGE.x, HINGE.y - (poppedAt === null ? lidRaise() : 0));
      ctx.rotate(-lift);
      ctx.roundRect(0, -LID.thickness, LID_WIDTH, LID.thickness, 7);
      ctx.restore();
    });
  }

  /** Ink round the handle. Call before `drawCrankFront`. */
  function outlineCrankFront(ctx: CanvasRenderingContext2D): void {
    const knob = knobCentre();
    inkOutline(ctx, OUTLINE_WEIGHT, () => {
      ctx.beginPath();
      ctx.save();
      ctx.translate(AXLE.x, AXLE.y);
      ctx.rotate(knobAngle());
      ctx.roundRect(-7, -5.5, ARM + 14, 11, 5.5);
      ctx.restore();
      ctx.moveTo(AXLE.x + 10, AXLE.y);
      ctx.arc(AXLE.x, AXLE.y, 10, 0, Math.PI * 2);
      ctx.moveTo(knob.x + KNOB_RADIUS, knob.y);
      ctx.arc(knob.x, knob.y, KNOB_RADIUS, 0, Math.PI * 2);
    });
  }

  function drawCrankBack(ctx: CanvasRenderingContext2D): void {
    const hw = BOX.halfWidth;
    ctx.fillStyle = metal(ctx, 0, AXLE.y - 5, 0, AXLE.y + 5);
    ctx.fillRect(hw, AXLE.y - 4.5, AXLE.x - hw, 9);
    ctx.fillStyle = metal(ctx, hw - 4, AXLE.y - 14, hw + 8, AXLE.y + 14);
    ellipse(ctx, hw + 2, AXLE.y, 7, 14);
  }

  function drawCrankFront(ctx: CanvasRenderingContext2D, pulse: number, cue: number): void {
    const angle = knobAngle();
    if (cue > 0) {
      ctx.save();
      ctx.translate(AXLE.x, AXLE.y);
      ctx.rotate(stage.time * 1.4);
      ctx.strokeStyle = `rgba(71, 85, 105, ${0.35 * cue})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([2, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, ARM + 24, -0.9, 0.9);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(71, 85, 105, ${0.45 * cue})`;
      ctx.beginPath();
      ctx.moveTo(Math.cos(1.15) * (ARM + 24), Math.sin(1.15) * (ARM + 24));
      ctx.lineTo(Math.cos(0.9) * (ARM + 31), Math.sin(0.9) * (ARM + 31));
      ctx.lineTo(Math.cos(0.9) * (ARM + 17), Math.sin(0.9) * (ARM + 17));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(AXLE.x, AXLE.y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(60, 8, 20, 0.25)';
    ctx.beginPath();
    ctx.roundRect(-6, -3, ARM + 12, 10, 5);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-7, -5.5, ARM + 14, 11, 5.5);
    ctx.fillStyle = metal(ctx, 0, -5.5, 0, 5.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(2, -3.5, ARM - 6, 1.6);
    ctx.restore();

    const hub = ctx.createRadialGradient(AXLE.x - 3, AXLE.y - 3, 1, AXLE.x, AXLE.y, 10);
    hub.addColorStop(0, '#fff3c4');
    hub.addColorStop(0.5, PALETTE.gold);
    hub.addColorStop(1, PALETTE.goldDeep);
    ctx.fillStyle = hub;
    ellipse(ctx, AXLE.x, AXLE.y, 10, 10);
    ctx.fillStyle = PALETTE.goldDeep;
    ellipse(ctx, AXLE.x, AXLE.y, 3, 3);

    const { x: kx, y: ky } = knobCentre();
    if (pulse > 0) {
      ctx.beginPath();
      ctx.arc(kx, ky, KNOB_RADIUS + 4 + pulse * 14, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - pulse)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30, 41, 59, 0.22)';
    ellipse(ctx, kx + 2, ky + 4, KNOB_RADIUS, KNOB_RADIUS);
    ctx.fillStyle = metal(ctx, kx - 9, 0, kx + 9, 0);
    ellipse(ctx, kx, ky, 9, 9);
    const knob = ctx.createRadialGradient(kx - 5, ky - 6, 1, kx, ky, KNOB_RADIUS);
    knob.addColorStop(0, PALETTE.white);
    knob.addColorStop(0.45, PALETTE.cream);
    knob.addColorStop(1, PALETTE.creamShade);
    ctx.fillStyle = knob;
    ellipse(ctx, kx, ky, KNOB_RADIUS, KNOB_RADIUS);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ellipse(ctx, kx - 5, ky - 6, 4, 2.6);
  }

  function drawJack(ctx: CanvasRenderingContext2D): void {
    const ext = extend.value;
    const top = COIL_BASE - (10 + ext * JACK_RISE);
    const stretch = clamp(extend.velocity * 0.025, -0.15, 0.2);
    ctx.save();
    ctx.translate(0, COIL_BASE);
    ctx.rotate(sway.value * 0.35);
    ctx.translate(0, -COIL_BASE);
    outlineCoil(ctx, top);
    drawCoil(ctx, top);
    ctx.translate(0, top - HEAD_RADIUS * 0.75);
    ctx.rotate(sway.value * 0.4);
    ctx.scale(1 - stretch * 0.5, 1 + stretch);
    outlineSnowman(ctx, stage.time);
    drawSnowman(ctx, stage.time, clamp(stretch * 5 + 0.3, 0, 1));
    ctx.restore();
  }

  return {
    footprint() {
      const { cx, floorY, scale } = layout();
      const boxHeight = (BOX.height + LID.thickness) * scale;
      const sweep = (ARM + KNOB_RADIUS) * scale;
      return [
        {
          x: cx,
          y: floorY - boxHeight / 2,
          halfWidth: (BOX.halfWidth + LID.overhang) * scale,
          halfHeight: boxHeight / 2,
          round: false,
        },
        {
          x: cx + AXLE.x * scale,
          y: floorY + AXLE.y * scale,
          halfWidth: sweep,
          halfHeight: sweep,
          round: true,
        },
      ];
    },
    update(dt) {
      if (dt <= 0) return;
      const l = layout();
      boxX.update(dt);
      tilt.target = clamp(-boxX.velocity * 0.0022, -0.3, 0.3);
      tilt.update(dt);
      squash.update(dt);
      armSnap.update(dt);
      peek.update(dt);
      rattle.update(dt);
      if (rattle.value < 0) {
        rattle.value = 0;
        rattle.velocity = Math.max(0, rattle.velocity);
      }

      if (poppedAt !== null) {
        shiver = lerp(shiver, 0, 1 - Math.exp(-dt * 10));
        open.update(dt);
        extend.update(dt);
        sway.update(dt);
        const since = stage.time - poppedAt;
        if (completedAt === null && since > COMPLETE_DELAY) {
          completedAt = stage.time;
          const head = toScreen(l, 0, COIL_BASE - 10 - JACK_RISE - HEAD_RADIUS * 0.75);
          stage.complete(head);
        }
        return;
      }
      if (frozenAt !== null) {
        shiver = 1.6;
        if (Math.random() < dt * 30) rattle.velocity += rand(20, 60);
        if (stage.time - frozenAt > FREEZE_TIME) pop(l);
        return;
      }
      updateIdle(dt);
      windByPhone(dt);
      updateWinding(dt);
    },
    draw(ctx) {
      const l = layout();
      const s = l.scale;
      const exit = completedAt === null ? 0 : easeInCubic((stage.time - completedAt) / EXIT_TIME);
      if (exit >= 1) return;
      const fade = 1 - exit;
      const sinceOpen = poppedAt === null ? 0 : stage.time - poppedAt;
      if (poppedAt !== null) {
        const flare = 0.85 * (1 - clamp(sinceOpen / 1.1, 0, 1));
        const mouth = toScreen(l, 0, -BOX.height);
        glow(ctx, mouth.x, mouth.y, s * (120 + sinceOpen * 600), GOLD_GLOW_RGB, flare);
      }

      const air = clamp(-hopY / 60, 0, 1);
      softShadow(
        ctx,
        l.cx + boxX.value * s + 18 * s,
        l.floorY,
        (BOX.halfWidth + 50) * s * (1 - air * 0.25),
        16 * s,
        0.3 * fade * (1 - air * 0.5),
      );

      const jitterX = Math.sin(stage.time * 61) * shiver * 1.3;
      const jitterRot = Math.sin(stage.time * 47) * shiver * 0.012;
      const sq = clamp(squash.value, -0.25, 0.25);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(
        l.cx + (boxX.value + jitterX) * s,
        l.floorY + hopY * s + exit * stage.height * 0.45,
      );
      ctx.rotate(tilt.value + jitterRot);
      ctx.scale(s * (1 + sq * 0.5), s * (1 - sq));

      const lift = lidLift();
      outlineBox(ctx, lift);
      if (poppedAt !== null) {
        const rim = ctx.createLinearGradient(0, -BOX.height - 9, 0, -BOX.height + 4);
        rim.addColorStop(0, '#120c18');
        rim.addColorStop(1, '#3a1e2c');
        ctx.fillStyle = rim;
        ellipse(ctx, 0, -BOX.height, BOX.halfWidth - 4, 9);
        ctx.save();
        ctx.translate(HINGE.x, HINGE.y);
        ctx.rotate(-lift);
        outlineLatch(ctx);
        drawLid(ctx, 0);
        ctx.restore();
        drawJack(ctx);
      } else if (lift > 0.01) {
        const look = Math.sin(stage.time * 2.3);
        const blink = (stage.time * 1.7) % 2 < 0.12 ? 0.15 : 1;
        drawPeek(ctx, lift, blink, look);
      }

      drawCrankBack(ctx);
      drawBody(ctx, stage.time);

      if (poppedAt === null) {
        ctx.save();
        ctx.translate(HINGE.x, HINGE.y - lidRaise());
        ctx.rotate(-lift);
        outlineLatch(ctx);
        drawLid(ctx, shiver);
        ctx.restore();
      }

      const idle = poppedAt === null && frozenAt === null && grab !== 'knob';
      const pulse = idle && wound === 0 ? (stage.time * 0.9) % 1 : 0;
      const cue = idle && wound === 0 ? 1 : 0;
      outlineCrankFront(ctx);
      drawCrankFront(ctx, pulse, cue);
      ctx.restore();
    },
    onPointerDown(point) {
      if (poppedAt !== null || frozenAt !== null) return;
      const l = layout();
      const s = l.scale;
      const angle = knobAngle();
      const knob = toScreen(l, AXLE.x + Math.cos(angle) * ARM, AXLE.y + Math.sin(angle) * ARM);
      const axle = toScreen(l, AXLE.x, AXLE.y);
      const axleDistance = Math.hypot(point.x - axle.x, point.y - axle.y);
      const nearKnob = Math.hypot(point.x - knob.x, point.y - knob.y) <= Math.max(46, 34 * s);
      const inCrank =
        axleDistance <= (ARM + 18) * s + 12 && point.x > toScreen(l, BOX.halfWidth - 6, 0).x;
      downPoint = point;
      moved = false;
      if (nearKnob || inCrank) {
        grab = 'knob';
        if (axleDistance >= DEAD_ZONE) {
          const fingerAngle = Math.atan2(point.y - axle.y, point.x - axle.x);
          const next = arm + wrapAngle(fingerAngle - arm);
          armSnap.value += arm - next;
          arm = next;
          lastAngle = fingerAngle;
        } else {
          lastAngle = arm;
        }
        debt = 0;
        clickTravel = 0;
        stage.sfx.tap(1.2);
        stage.haptic(8);
        return;
      }
      const lidLeft = toScreen(l, HINGE.x, 0).x - 6;
      const lidRight = toScreen(l, -HINGE.x, 0).x + 6;
      const lidTop = toScreen(l, 0, HINGE.y - LID.thickness).y - 18;
      const lidBottom = toScreen(l, 0, HINGE.y + 6).y;
      if (point.x >= lidLeft && point.x <= lidRight && point.y >= lidTop && point.y <= lidBottom) {
        grab = 'lid';
        peekLid();
        return;
      }
      const boxLeft = toScreen(l, -BOX.halfWidth - 6, 0).x;
      const boxRight = toScreen(l, BOX.halfWidth + 6, 0).x;
      if (
        point.x >= boxLeft &&
        point.x <= boxRight &&
        point.y >= lidBottom &&
        point.y <= l.floorY + 10
      ) {
        grab = 'box';
        grabX = point.x - boxX.value * s;
      }
    },
    onPointerMove(point, down) {
      if (!down) {
        release();
        return;
      }
      if (grab === null || poppedAt !== null || frozenAt !== null) return;
      const l = layout();
      if (grab === 'knob') {
        crank(point, l);
        return;
      }
      if (Math.hypot(point.x - downPoint.x, point.y - downPoint.y) > TAP_SLOP) moved = true;
      if (grab === 'box' && moved) {
        const raw = (point.x - grabX) / l.scale;
        boxX.target = Math.tanh(raw / 70) * 60;
      }
    },
    onPointerUp: release,
  };
};
