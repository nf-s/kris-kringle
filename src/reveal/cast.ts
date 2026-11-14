import {
  CHARACTER_LAYERS,
  CHARACTER_POSES,
  CHARACTER_SPRITE,
  type CharacterPose,
} from '../../shared/schema';
import { SPRITE_HEIGHT, SPRITE_WIDTH, drawFigure, panelOrigin } from '../characters/sprite';
import { clamp, easeOutBack, lerp } from './draw';

/** The stage, and the band of it the cast may stand in, in CSS pixels. */
export interface CastArea {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

/** Where one figure stands. `height` is the height of its whole sprite panel on screen. */
export interface Placement {
  x: number;
  baseline: number;
  height: number;
}

/**
 * The characters gathered round the object. They pray, bobbing and rocking, until the person
 * makes progress, break into wailing one at a time as it rises, and all wail and jig about once
 * the object opens. Every bit of progress makes the whole cast jump.
 */
export interface Cast {
  update(dt: number, progress: number, completed: boolean): void;
  draw(ctx: CanvasRenderingContext2D, area: CastArea, time: number): void;
  destroy(): void;
}

/** Width of the drawn figure as a share of its panel height. */
const FIGURE_WIDTH = 0.5;
/** How far below the middle of the panel the figure's bottom edge sits, as a share of height. */
const BASELINE_DROP = CHARACTER_SPRITE.baseline / CHARACTER_SPRITE.panelHeight - 0.5;
const MAX_HEIGHT = 300;
const MIN_HEIGHT = 56;
/** Share of its own width each figure needs along the ring before they are made smaller. */
const CROWDING = 0.92;
const EDGE_GAP = 4;
const RING_STEPS = 360;
/**
 * Half the width of the object and the distance from its middle to its bottom edge, before the
 * scale every reveal sizes itself by. The object sits in the middle of the stage.
 */
const OBJECT_HALF_WIDTH = 125;
const OBJECT_DROP = 150;
/** Share of a figure's height that may hide behind the object before the ring is opened. */
const HIDDEN_ALLOWED = 0.25;
/** Figures at the back of the ring are drawn a little smaller. */
const BACK_SCALE = 0.88;

/** Progress at which the first and the last character start wailing. */
const FIRST_BREAK = 0.08;
const LAST_BREAK = 0.9;
/** Progress has to fall this far below a character's breaking point before it calms down. */
const CALM_MARGIN = 0.1;
const SWITCH_SECONDS = 0.36;
/** Point in the switch at which the pose changes, hidden by the squash. */
const SWITCH_FLIP = 0.4;
const ENTRANCE_SECONDS = 0.4;
const JIG_RAMP_SECONDS = 0.5;

/** The same ink as the outline drawn round the objects. */
const INK = '#2b2233';
/** Width of the ink line round each figure, in CSS pixels. */
const OUTLINE_WIDTH = 1.8;
/** Size of a figure's outline sheet relative to its sprite sheet. An outline has no fine detail. */
const OUTLINE_SHEET_SCALE = 0.5;
/** Copies of the figure laid in a circle to thicken its silhouette into an outline. */
const OUTLINE_STAMPS = 12;
/** The outline is redrawn when the figures change size on screen by more than this share. */
const OUTLINE_TOLERANCE = 0.15;

const HEAD_TILT: Record<CharacterPose, number> = { praying: 0.055, wailing: 0.075 };
const HEAD_SPEED: Record<CharacterPose, number> = { praying: 1, wailing: 1.9 };
/** Furthest the head may lean before the shear starts to distort the face. */
const MAX_HEAD_TILT = 0.13;
/** How fast the whole figure rocks from side to side, and how far, in radians. */
const ROCK_SPEED: Record<CharacterPose, number> = { praying: 1.3, wailing: 3.1 };
const ROCK: Record<CharacterPose, number> = { praying: 0.035, wailing: 0.05 };
/**
 * Figures this tall move by the shares of their height used below. Smaller figures move further
 * for their size, up to `MAX_MOTION_BOOST` times, so the movement still shows on a phone.
 */
const FULL_MOTION_HEIGHT = 200;
const MAX_MOTION_BOOST = 2;
/** Share of the movement kept when the device asks for reduced motion. */
const REDUCED_MOTION = 0.4;
/** How strongly a rise in progress stirs the cast, and how quickly they settle again. */
const STIR_GAIN = 20;
const STIR_SETTLE = 2.2;

interface Ring {
  rx: number;
  ry: number;
  /** Half the angle left empty at the bottom, where figures would be hidden behind the object. */
  gap: number;
}

function ringFor(area: CastArea, height: number): Ring {
  const band = area.bottom - area.top;
  const rx = Math.max(
    0,
    Math.min(area.width / 2 - (height * FIGURE_WIDTH) / 2 - EDGE_GAP, band * 0.95),
  );
  const ry = Math.max(0, (band - height) / 2);
  const objectScale = clamp(Math.min(area.width / 420, area.height / 640), 0.55, 1.5);
  const objectBottom = area.height / 2 + OBJECT_DROP * objectScale;
  const lowestHead = (area.top + area.bottom) / 2 + ry - height * HIDDEN_ALLOWED;
  if (lowestHead >= objectBottom) return { rx, ry, gap: 0 };
  const clear = OBJECT_HALF_WIDTH * objectScale + (height * FIGURE_WIDTH) / 2;
  return { rx, ry, gap: Math.asin(Math.min(1, clear / Math.max(rx, 1))) };
}

/**
 * Points round the ring with the distance travelled to reach each: clockwise from one side of the
 * gap at the bottom, over the top, to the other side.
 */
function trace(ring: Ring): { angle: number; distance: number }[] {
  const start = Math.PI / 2 + ring.gap;
  const sweep = Math.PI * 2 - ring.gap * 2;
  const points = [{ angle: start, distance: 0 }];
  for (let step = 1; step <= RING_STEPS; step++) {
    const previous = points[step - 1];
    const angle = start + (step / RING_STEPS) * sweep;
    const dx = ring.rx * (Math.cos(angle) - Math.cos(previous.angle));
    const dy = ring.ry * (Math.sin(angle) - Math.sin(previous.angle));
    points.push({ angle, distance: previous.distance + Math.hypot(dx, dy) });
  }
  return points;
}

/**
 * Stands `count` figures evenly round a ring that fills the band, as large as they can be without
 * crowding. Where the bottom of the ring would put figures behind the object, that stretch is
 * left empty. Returned in the order given, which runs clockwise from the bottom left.
 */
export function placeCast(count: number, area: CastArea): Placement[] {
  if (count <= 0) return [];
  const band = area.bottom - area.top;
  let height = clamp(Math.min(band * 0.36, area.width * 0.5), MIN_HEIGHT, MAX_HEIGHT);
  let ring = ringFor(area, height);
  let path = trace(ring);
  /** An open ring has a figure at each end; a closed one shares the gaps out evenly. */
  const gaps = (open: boolean) => (open ? Math.max(1, count - 1) : count);
  while (height > MIN_HEIGHT) {
    const spacing = path[RING_STEPS].distance / gaps(ring.gap > 0);
    if (spacing >= height * FIGURE_WIDTH * CROWDING) break;
    height = Math.max(MIN_HEIGHT, height * 0.96);
    ring = ringFor(area, height);
    path = trace(ring);
  }
  const open = ring.gap > 0;
  const length = path[RING_STEPS].distance;
  const centreY = (area.top + area.bottom) / 2;
  let step = 0;
  return Array.from({ length: count }, (_, index) => {
    const share = open ? (count > 1 ? index / (count - 1) : 0.5) : (index + 0.5) / count;
    const target = share * length;
    while (step < RING_STEPS && path[step + 1].distance < target) step += 1;
    const { angle } = path[step];
    const scale = lerp(BACK_SCALE, 1, (Math.sin(angle) + 1) / 2);
    return {
      x: area.width / 2 + ring.rx * Math.cos(angle),
      baseline: centreY + ring.ry * Math.sin(angle) + height * BASELINE_DROP * scale,
      height: height * scale,
    };
  });
}

/**
 * Every part of a sprite sheet thickened by `width` sprite pixels and filled with ink. Drawn
 * behind the figure, it leaves a line round the whole silhouette however the head is tilted.
 */
function outlineSheet(image: HTMLImageElement, width: number): HTMLCanvasElement | null {
  const sheet = document.createElement('canvas');
  sheet.width = SPRITE_WIDTH * OUTLINE_SHEET_SCALE;
  sheet.height = SPRITE_HEIGHT * OUTLINE_SHEET_SCALE;
  const ctx = sheet.getContext('2d');
  if (!ctx) return null;
  const { panelWidth, panelHeight } = CHARACTER_SPRITE;
  const scale = OUTLINE_SHEET_SCALE;
  for (const pose of CHARACTER_POSES) {
    for (const layer of CHARACTER_LAYERS) {
      const origin = panelOrigin(pose, layer);
      ctx.save();
      ctx.beginPath();
      ctx.rect(origin.x * scale, origin.y * scale, panelWidth * scale, panelHeight * scale);
      ctx.clip();
      for (let stamp = 0; stamp < OUTLINE_STAMPS; stamp++) {
        const angle = (stamp / OUTLINE_STAMPS) * Math.PI * 2;
        ctx.drawImage(
          image,
          origin.x,
          origin.y,
          panelWidth,
          panelHeight,
          (origin.x + Math.cos(angle) * width) * scale,
          (origin.y + Math.sin(angle) * width) * scale,
          panelWidth * scale,
          panelHeight * scale,
        );
      }
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  return sheet;
}

interface Member {
  image: HTMLImageElement | null;
  outline: HTMLCanvasElement | null;
  /** The size on screen, relative to the sprite, that `outline` was drawn for. */
  outlinedAt: number;
  /** Seconds since the image arrived. */
  shownFor: number;
  /** Progress at which this character starts wailing. */
  breaksAt: number;
  wailing: boolean;
  sinceSwitch: number;
  /** Offsets this character's movement from everyone else's. */
  phase: number;
}

/** Squash before the pose changes, then a stretch upwards that settles. */
function switchStretch(sinceSwitch: number): number {
  const t = sinceSwitch / SWITCH_SECONDS;
  if (t >= 1) return 0;
  if (t < SWITCH_FLIP) return -0.16 * Math.sin((t / SWITCH_FLIP) * (Math.PI / 2));
  const u = (t - SWITCH_FLIP) / (1 - SWITCH_FLIP);
  return -0.16 * Math.pow(1 - u, 3) + 0.22 * Math.sin(Math.PI * u) * (1 - u);
}

function sway(time: number, phase: number): number {
  return Math.sin(time * 1.16 + phase) * 0.74 + Math.sin(time * 1.91 + phase * 0.73) * 0.26;
}

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * `images` are the characters' sprite sheets. Each cast stands in its own random order and breaks
 * into wailing in another, so the ring looks different every time a reveal is started.
 */
export function createCast(images: readonly string[]): Cast {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const count = images.length;
  let destroyed = false;
  let sinceComplete: number | null = null;
  /** 0 to 1: how stirred up the cast is by recent progress. */
  let stir = 0;
  let lastProgress = 0;
  let placements: Placement[] = [];
  let placedFor = '';

  const ranks = shuffled(images.map((_, index) => index));

  const members: Member[] = shuffled(images).map((url, index) => {
    const member: Member = {
      image: null,
      outline: null,
      outlinedAt: 0,
      shownFor: 0,
      breaksAt: count > 1 ? lerp(FIRST_BREAK, LAST_BREAK, ranks[index] / (count - 1)) : 0.5,
      wailing: false,
      sinceSwitch: SWITCH_SECONDS,
      phase: index * 1.37,
    };
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    image.decode().then(
      () => {
        if (!destroyed) member.image = image;
      },
      // A character that fails to load is left out; the reveal works without it.
      () => undefined,
    );
    return member;
  });

  /** Back of the ring first, so nearer figures overlap those behind. */
  let drawOrder: number[] = [];

  function place(area: CastArea): void {
    const key = `${area.width}:${area.height}:${area.top}:${area.bottom}`;
    if (key === placedFor) return;
    placedFor = key;
    placements = placeCast(count, area);
    drawOrder = placements
      .map((_, index) => index)
      .sort((a, b) => placements[a].baseline - placements[b].baseline);
  }

  function drawMember(
    ctx: CanvasRenderingContext2D,
    member: Member,
    spot: Placement,
    time: number,
  ): void {
    if (!member.image) return;
    const moving = !still.matches;
    const flipped = !moving || member.sinceSwitch >= SWITCH_SECONDS * SWITCH_FLIP;
    const pose: CharacterPose = member.wailing === flipped ? 'wailing' : 'praying';
    const stretch = moving ? switchStretch(member.sinceSwitch) : 0;
    const entrance = moving ? easeOutBack(member.shownFor / ENTRANCE_SECONDS) : 1;
    const jig = sinceComplete !== null ? clamp(sinceComplete / JIG_RAMP_SECONDS, 0, 1) : 0;
    const wail = pose === 'wailing' ? 1 : 0;
    const { phase } = member;

    const boost = clamp(FULL_MOTION_HEIGHT / spot.height, 1, MAX_MOTION_BOOST);
    const liveliness = moving ? 1 : REDUCED_MOTION;
    /** Scales distances moved, as shares of the figure's height, and angles turned. */
    const reach = liveliness * boost;
    const swing = liveliness * Math.sqrt(boost);

    const tilt = clamp(
      HEAD_TILT[pose] * swing * sway(time * HEAD_SPEED[pose], phase),
      -MAX_HEAD_TILT,
      MAX_HEAD_TILT,
    );
    const bob = (1 - wail) * (0.5 - 0.5 * Math.cos(time * 2.6 + phase)) * 0.028;
    const bounce = wail * Math.abs(Math.sin(time * 5 + phase)) * 0.035;
    const jump = stir * Math.abs(Math.sin(time * 9 + phase * 1.7)) * 0.05;
    const hop = jig * Math.abs(Math.sin(time * 4.2 + phase)) * 0.08;
    const shudder = moving ? wail * Math.sin(time * 23 + phase * 3) * 0.006 : 0;
    const rock = (1 - jig) * Math.sin(time * ROCK_SPEED[pose] + phase) * ROCK[pose];
    const lean = jig * Math.sin(time * 8.4 + phase * 2) * 0.09;

    const size = spot.height / CHARACTER_SPRITE.panelHeight;
    if (Math.abs(size - member.outlinedAt) > member.outlinedAt * OUTLINE_TOLERANCE) {
      member.outline = outlineSheet(member.image, OUTLINE_WIDTH / size);
      member.outlinedAt = size;
    }
    const scale = size * entrance;
    ctx.save();
    ctx.translate(
      spot.x + shudder * reach * spot.height,
      spot.baseline - (bob + bounce + jump + hop) * reach * spot.height,
    );
    ctx.rotate((rock + lean) * swing);
    ctx.scale(scale * (1 - stretch * 0.6), scale * (1 + stretch));
    ctx.translate(-CHARACTER_SPRITE.neckX, -CHARACTER_SPRITE.baseline);
    if (member.outline) drawFigure(ctx, member.outline, pose, tilt, OUTLINE_SHEET_SCALE);
    drawFigure(ctx, member.image, pose, tilt);
    ctx.restore();
  }

  return {
    update(dt, progress, completed) {
      if (completed) sinceComplete = (sinceComplete ?? 0) + dt;
      const gained = Math.max(0, progress - lastProgress);
      lastProgress = progress;
      stir = Math.min(1, stir + gained * STIR_GAIN) * Math.exp(-dt * STIR_SETTLE);
      for (const member of members) {
        const calmAt = member.wailing ? member.breaksAt - CALM_MARGIN : member.breaksAt;
        const wailing = completed || progress >= calmAt;
        if (wailing !== member.wailing) {
          member.wailing = wailing;
          member.sinceSwitch = 0;
        }
        member.sinceSwitch += dt;
        if (member.image) member.shownFor += dt;
      }
    },
    draw(ctx, area, time) {
      place(area);
      for (const index of drawOrder) drawMember(ctx, members[index], placements[index], time);
    },
    destroy() {
      destroyed = true;
      for (const member of members) {
        member.image = null;
        member.outline = null;
      }
    },
  };
}
