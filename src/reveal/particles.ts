import { pick, rand, sparkle } from './draw';

export type ParticleShape = 'rect' | 'circle' | 'shard' | 'star';

export interface ParticleOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shape?: ParticleShape;
  /** Seconds. */
  life?: number;
  /** Pixels per second squared, positive is down. */
  gravity?: number;
  /** Fraction of velocity lost per second, 0 to ~5. */
  drag?: number;
  rotation?: number;
  spin?: number;
}

export interface BurstOptions {
  x: number;
  y: number;
  count: number;
  colors: readonly string[];
  shapes?: readonly ParticleShape[];
  speed: readonly [number, number];
  size: readonly [number, number];
  /** Direction of the burst in radians (0 is right, -PI/2 is up). */
  angle?: number;
  /** Total arc in radians around `angle`. Defaults to a full circle. */
  spread?: number;
  life?: readonly [number, number];
  gravity?: number;
  drag?: number;
}

export interface Particles {
  readonly count: number;
  emit(options: ParticleOptions): void;
  burst(options: BurstOptions): void;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shape: ParticleShape;
  age: number;
  life: number;
  gravity: number;
  drag: number;
  rotation: number;
  spin: number;
  flip: number;
  flipSpeed: number;
}

const MAX_PARTICLES = 1400;

export function createParticles(): Particles {
  let particles: Particle[] = [];

  function emit(options: ParticleOptions): void {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      x: options.x,
      y: options.y,
      vx: options.vx,
      vy: options.vy,
      size: options.size,
      color: options.color,
      shape: options.shape ?? 'rect',
      age: 0,
      life: options.life ?? 2,
      gravity: options.gravity ?? 900,
      drag: options.drag ?? 0.8,
      rotation: options.rotation ?? rand(0, Math.PI * 2),
      spin: options.spin ?? rand(-8, 8),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(6, 14),
    });
  }

  function burst(options: BurstOptions): void {
    const spread = options.spread ?? Math.PI * 2;
    const angle = options.angle ?? 0;
    const shapes = options.shapes ?? ['rect'];
    const life = options.life ?? [1.2, 2.4];
    for (let i = 0; i < options.count; i++) {
      const direction = angle + rand(-spread / 2, spread / 2);
      const speed = rand(options.speed[0], options.speed[1]);
      emit({
        x: options.x,
        y: options.y,
        vx: Math.cos(direction) * speed,
        vy: Math.sin(direction) * speed,
        size: rand(options.size[0], options.size[1]),
        color: pick(options.colors),
        shape: pick(shapes),
        life: rand(life[0], life[1]),
        gravity: options.gravity,
        drag: options.drag,
      });
    }
  }

  function update(dt: number): void {
    for (const p of particles) {
      p.age += dt;
      p.vy += p.gravity * dt;
      const damping = Math.max(0, 1 - p.drag * dt);
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      p.flip += p.flipSpeed * dt;
    }
    particles = particles.filter((p) => p.age < p.life);
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    for (const p of particles) {
      const remaining = 1 - p.age / p.life;
      const alpha = Math.min(1, remaining * 3);
      if (p.shape === 'star') {
        sparkle(ctx, p.x, p.y, p.size * (0.6 + 0.4 * Math.sin(p.flip)), p.color, alpha, p.rotation);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'shard') {
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.5, p.size * 0.4);
        ctx.lineTo(p.size * 0.1, -p.size * 0.55);
        ctx.lineTo(p.size * 0.55, p.size * 0.3);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
      }
      ctx.restore();
    }
  }

  return {
    get count() {
      return particles.length;
    },
    emit,
    burst,
    update,
    draw,
  };
}
