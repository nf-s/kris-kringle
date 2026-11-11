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

/** Seconds of full-intensity shaking needed to fill the globe. */
const CHARGE_TIME = 3.2;
const CHARGE_DECAY = 0.05;
const COMPLETE_DELAY = 0.4;
const FLAKE_COUNT = 150;
const FLAKE_WALL = 0.9;
const FLAKE_GRAVITY = 0.4;
const INK = '#2b2233';

interface Layout {
  cx: number;
  cy: number;
  radius: number;
  unit: number;
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

/** Penguin in a hat and scarf, standing with its feet at the origin. */
function drawPenguin(ctx: CanvasRenderingContext2D, flap: number, wide: number): void {
  ctx.fillStyle = PALETTE.gold;
  ellipse(ctx, -0.09, -0.01, 0.08, 0.035);
  ellipse(ctx, 0.09, -0.01, 0.08, 0.035);

  const coat = ctx.createRadialGradient(-0.1, -0.5, 0.02, 0, -0.35, 0.5);
  coat.addColorStop(0, '#5d6f8c');
  coat.addColorStop(0.6, PALETTE.slateDark);
  coat.addColorStop(1, '#131c2b');
  ctx.fillStyle = coat;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 0.21, -0.4);
    ctx.rotate(-side * (0.3 + flap));
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
  for (const side of [-1, 1]) {
    ctx.fillStyle = INK;
    ellipse(ctx, side * 0.075, -0.6, eye, eye);
    ctx.fillStyle = PALETTE.white;
    ellipse(ctx, side * 0.075 - eye * 0.3, -0.6 - eye * 0.35, eye * 0.35, eye * 0.35);
  }
  ctx.fillStyle = PALETTE.gold;
  ellipse(ctx, 0, -0.535, 0.045, 0.03 + 0.012 * wide);
  ctx.fillStyle = PALETTE.goldDeep;
  ctx.fillRect(-0.04, -0.538, 0.08, 0.008);

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

  ctx.fillStyle = PALETTE.red;
  ctx.beginPath();
  ctx.ellipse(0, -0.73, 0.165, 0.14, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.roundRect(-0.185, -0.76, 0.37, 0.065, 0.032);
  ctx.fill();
  ellipse(ctx, 0, -0.885, 0.05, 0.05);
}

function drawScene(ctx: CanvasRenderingContext2D, lean: number, flap: number, wide: number): void {
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
  ellipse(ctx, -0.08, 0.63, 0.26, 0.04);
  ellipse(ctx, 0.5, 0.65, 0.18, 0.03);
  ellipse(ctx, -0.56, 0.63, 0.12, 0.025);

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

  // Gift.
  ctx.fillStyle = PALETTE.red;
  ctx.fillRect(-0.645, 0.49, 0.17, 0.14);
  ctx.fillStyle = PALETTE.redDeep;
  ctx.fillRect(-0.645, 0.49, 0.17, 0.03);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(-0.58, 0.49, 0.04, 0.14);
  ellipse(ctx, -0.59, 0.47, 0.035, 0.025);
  ellipse(ctx, -0.53, 0.47, 0.035, 0.025);

  ctx.save();
  ctx.translate(-0.08, 0.63);
  ctx.rotate(lean);
  drawPenguin(ctx, flap, wide);
  ctx.restore();
}

function drawBase(ctx: CanvasRenderingContext2D): void {
  const lacquer = ctx.createLinearGradient(-0.92, 0, 0.92, 0);
  lacquer.addColorStop(0, PALETTE.redDeep);
  lacquer.addColorStop(0.2, PALETTE.red);
  lacquer.addColorStop(0.36, PALETTE.redLight);
  lacquer.addColorStop(0.6, PALETTE.red);
  lacquer.addColorStop(1, PALETTE.redDeep);
  for (const band of [false, true]) {
    const top = band ? 1.23 : 0.78;
    const half = 0.7 + ((top - 0.78) / 0.52) * 0.22;
    ctx.beginPath();
    ctx.moveTo(-half, top);
    ctx.lineTo(half, top);
    ctx.lineTo(0.92, 1.3);
    ctx.quadraticCurveTo(0.92, 1.4, 0.8, 1.4);
    ctx.lineTo(-0.8, 1.4);
    ctx.quadraticCurveTo(-0.92, 1.4, -0.92, 1.3);
    ctx.closePath();
    ctx.fillStyle = band ? metal(ctx, 0.92) : lacquer;
    ctx.fill();
  }
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
  ctx.beginPath();
  ctx.roundRect(-0.75, 0.72, 1.5, 0.125, 0.06);
  ctx.fill();
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

export const createGlobe: RevealFactory = (stage) => {
  const offsetX = new Spring(0, 320, 20);
  const offsetY = new Spring(0, 320, 20);
  const tilt = new Spring(0, 140, 10);
  const flakes: Flake[] = Array.from({ length: FLAKE_COUNT }, makeFlake);
  let grab: Point | null = null;
  let lastPointer: Point = { x: 0, y: 0 };
  let travel = 0;
  let speed = 0;
  let intensity = 0;
  let charge = 0;
  let shown = 0;
  let milestone = 0;
  let jingle = 0;
  let hapticWait = 0;
  let previousVx = 0;
  let previousVy = 0;
  let hint = 'Shake the snow globe';
  let nextWiggle = 2.5;
  let poppedAt: number | null = null;

  stage.setHint(hint);

  function layout(): Layout {
    const unit = clamp(Math.min(stage.width / 420, stage.height / 640), 0.55, 1.5);
    return { cx: stage.width / 2, cy: stage.height * 0.52 - 26 * unit, radius: 118 * unit, unit };
  }

  function showHint(text: string): void {
    if (text === hint) return;
    hint = text;
    stage.setHint(text);
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

  function updateFlakes(dt: number, l: Layout): void {
    const pushX = clamp((offsetX.velocity - previousVx) / dt / l.radius, -45, 45);
    const pushY = clamp((offsetY.velocity - previousVy) / dt / l.radius, -45, 45);
    previousVx = offsetX.velocity;
    previousVy = offsetY.velocity;
    const stir = Math.hypot(pushX, pushY) * 0.6 + intensity * 3;
    const swirl = clamp(tilt.value * 9, -3, 3);
    for (const flake of flakes) {
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
        flake.vx *= Math.exp(-8 * dt);
      }
    }
  }

  function updateShake(dt: number, l: Layout): void {
    speed = lerp(speed, travel / dt / l.unit, 1 - Math.exp(-dt * 10));
    travel = 0;
    intensity = grab === null ? 0 : clamp((speed - 200) / 900, 0, 1);
    if (intensity > 0.05) charge += (intensity * dt) / CHARGE_TIME;
    else charge -= CHARGE_DECAY * dt;
    charge = clamp(charge, 0, 1);
    if (Math.abs(charge - shown) > 0.004) {
      shown = charge;
      stage.setProgress(charge);
    }
    if (charge > 0.7) showHint('Nearly there');
    else if (charge > 0.03) showHint('Keep shaking');

    jingle += intensity * dt;
    if (jingle > 0.16) {
      jingle = 0;
      stage.sfx.tap(rand(1.5, 2.4));
    }
    hapticWait -= dt;
    if (intensity > 0.7 && hapticWait <= 0) {
      hapticWait = 0.16;
      stage.haptic(12);
    }
    const step = Math.floor(charge * 4);
    if (step > milestone && charge < 1) {
      milestone = step;
      stage.sfx.chime(step - 1);
    }
    if (charge >= 1) pop(l);
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
    const lean = -tilt.value * 0.5 + Math.sin(stage.time * 22) * 0.05 * intensity;
    const flap = intensity * 0.9 + Math.sin(stage.time * 2.2) * 0.06;
    drawScene(ctx, lean, flap, intensity);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    for (const flake of flakes) ellipse(ctx, flake.x, flake.y, flake.size, flake.size);
    ctx.restore();
    glow(ctx, 0, 0.1, 1, GOLD_GLOW_RGB, 0.5 * charge);
    drawGlassShine(ctx);
  }

  return {
    update(dt) {
      if (dt <= 0) return;
      const l = layout();
      offsetX.update(dt);
      offsetY.update(dt);
      tilt.target = clamp((offsetX.velocity / l.unit) * 0.0007, -0.4, 0.4);
      tilt.update(dt);
      if (poppedAt !== null) {
        if (stage.time - poppedAt > COMPLETE_DELAY) stage.complete({ x: l.cx, y: l.cy });
        return;
      }
      if (charge === 0 && grab === null) {
        nextWiggle -= dt;
        if (nextWiggle < 0) {
          tilt.velocity += rand(-2.4, 2.4);
          nextWiggle = rand(2.2, 3.6);
        }
      }
      updateFlakes(dt, l);
      updateShake(dt, l);
    },
    draw(ctx) {
      const l = layout();
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
      const bob = poppedAt === null ? Math.sin(stage.time * 1.6) * 2.5 * l.unit : 0;
      const drop = easeInCubic((elapsed - 0.2) / 0.6) * l.radius * 1.4;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(l.cx + offsetX.value, l.cy + offsetY.value + bob + drop);
      ctx.rotate(tilt.value);
      ctx.scale(l.radius, l.radius);
      glow(ctx, 0, 0, 1.3 + 0.5 * charge, GOLD_GLOW_RGB, 0.55 * charge);
      const glass = 1 - clamp(elapsed / 0.3, 0, 1);
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
      stage.sfx.tap(1.3);
      stage.haptic(8);
    },
    onPointerMove(point, down) {
      if (!down || grab === null) return;
      travel += Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y);
      lastPointer = point;
      const reach = Math.min(stage.width, stage.height) * 0.3;
      const dx = point.x - grab.x;
      const dy = point.y - grab.y;
      const scale = Math.min(1, reach / Math.max(1, Math.hypot(dx, dy)));
      offsetX.target = dx * scale;
      offsetY.target = dy * scale;
    },
    onPointerUp() {
      grab = null;
      offsetX.target = 0;
      offsetY.target = 0;
    },
  };
};
