import {
  CHARACTER_LAYERS,
  CHARACTER_POSES,
  CHARACTER_SPRITE,
  type CharacterPose,
} from '../../shared/schema';
import { SPRITE_HEIGHT, SPRITE_WIDTH, drawFigure, panelOrigin } from '../characters/sprite';
import { clamp, easeOutBack, lerp } from './draw';
import type { Shape } from './engine';

/** The stage, the band of it the cast may stand in, and the object in the middle, in CSS pixels. */
export interface CastArea {
  width: number;
  height: number;
  top: number;
  bottom: number;
  /** The object the cast stands behind. No face is placed where these shapes would cover it. */
  object: readonly Shape[];
}

/** Where one figure stands. `height` is the height of its whole sprite panel on screen. */
export interface Placement {
  x: number;
  baseline: number;
  height: number;
}

/**
 * The characters gathered round the object. They pray until the person makes progress, break
 * into wailing one at a time as it rises, and all wail and jig about once the object opens.
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
/**
 * The face, as shares of the panel height: how far its top and its chin sit above the figure's
 * bottom edge, and half its width.
 */
const FACE = {
  top:
    (CHARACTER_SPRITE.baseline - CHARACTER_SPRITE.panelHeight * 0.05) /
    CHARACTER_SPRITE.panelHeight,
  chin: (CHARACTER_SPRITE.baseline - CHARACTER_SPRITE.neckY) / CHARACTER_SPRITE.panelHeight,
  halfWidth: 0.17,
};
const MAX_HEIGHT = 300;
const MIN_HEIGHT = 56;
/**
 * Share of its own width each figure needs along the ring before they are made smaller. Less
 * than this and one figure's shoulder starts to cover the next one's face.
 */
const CROWDING = 0.84;
const EDGE_GAP = 4;
const RING_STEPS = 360;
/** Shapes the ring may take, from an oval to nearly a box. See `trace`. */
const RING_SHAPES: readonly number[] = [2, 2.6, 3.4, 5];
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

const HEAD_TILT: Record<CharacterPose, number> = { praying: 0.035, wailing: 0.052 };
const HEAD_SPEED: Record<CharacterPose, number> = { praying: 1, wailing: 1.9 };

/** True where `shape` covers any of the box from (left, top) to (right, bottom). */
function covers(shape: Shape, left: number, top: number, right: number, bottom: number): boolean {
  const dx = Math.max(left - shape.x, 0, shape.x - right) / shape.halfWidth;
  const dy = Math.max(top - shape.y, 0, shape.y - bottom) / shape.halfHeight;
  return shape.round ? dx * dx + dy * dy < 1 : dx < 1 && dy < 1;
}

/** True where the object would cover part of the face of a figure standing at `spot`. */
function faceHidden(spot: Placement, object: readonly Shape[]): boolean {
  const left = spot.x - spot.height * FACE.halfWidth;
  const right = spot.x + spot.height * FACE.halfWidth;
  const top = spot.baseline - spot.height * FACE.top;
  const bottom = spot.baseline - spot.height * FACE.chin;
  return object.some((shape) => covers(shape, left, top, right, bottom));
}

/** A place on the ring, with the distance along the ring's usable stretches to reach it. */
interface Stop extends Placement {
  distance: number;
}

interface Ring {
  stops: Stop[];
  /** Length of ring the stops cover between them. */
  length: number;
}

/**
 * The places round a ring that fills the band where a figure `height` tall keeps its face clear
 * of the object, clockwise from the bottom. `squareness` is 2 for an oval and more for a ring
 * with flatter sides and tighter corners. Where the object leaves no such place, every place
 * round the ring is given.
 */
function trace(area: CastArea, height: number, squareness: number): Ring {
  const band = area.bottom - area.top;
  const rx = Math.max(
    0,
    Math.min(area.width / 2 - (height * FIGURE_WIDTH) / 2 - EDGE_GAP, band * 0.95),
  );
  const ry = Math.max(0, (band - height) / 2);
  const centreY = (area.top + area.bottom) / 2;
  const spots = Array.from({ length: RING_STEPS }, (_, step): Placement => {
    const angle = Math.PI / 2 + (step / RING_STEPS) * Math.PI * 2;
    const across = Math.abs(Math.cos(angle)) / Math.max(rx, 1);
    const down = Math.abs(Math.sin(angle)) / Math.max(ry, 1);
    const reach = Math.pow(
      Math.pow(across, squareness) + Math.pow(down, squareness),
      -1 / squareness,
    );
    const y = reach * Math.sin(angle);
    const scale = lerp(BACK_SCALE, 1, (y / Math.max(ry, 1) + 1) / 2);
    return {
      x: area.width / 2 + reach * Math.cos(angle),
      baseline: centreY + y + height * BASELINE_DROP * scale,
      height: height * scale,
    };
  });
  const clear = spots.map((spot) => !faceHidden(spot, area.object));
  const usable = clear.some(Boolean) ? clear : spots.map(() => true);
  const stops: Stop[] = [];
  let length = 0;
  for (let step = 0; step < RING_STEPS; step++) {
    if (!usable[step]) continue;
    const before = (step + RING_STEPS - 1) % RING_STEPS;
    // The first place only joins on to the last where the ring closes, which is added below.
    if (step > 0 && usable[before]) {
      length += Math.hypot(
        spots[step].x - spots[before].x,
        spots[step].baseline - spots[before].baseline,
      );
    }
    stops.push({ ...spots[step], distance: length });
  }
  if (usable[0] && usable[RING_STEPS - 1]) {
    length += Math.hypot(
      spots[0].x - spots[RING_STEPS - 1].x,
      spots[0].baseline - spots[RING_STEPS - 1].baseline,
    );
  }
  return { stops, length };
}

/** The largest figures that fit round a ring of one shape without crowding, and that ring. */
function fit(count: number, area: CastArea, squareness: number): { height: number; ring: Ring } {
  const band = area.bottom - area.top;
  let height = clamp(Math.min(band * 0.36, area.width * 0.5), MIN_HEIGHT, MAX_HEIGHT);
  let ring = trace(area, height, squareness);
  while (height > MIN_HEIGHT && ring.length / count < height * FIGURE_WIDTH * CROWDING) {
    height = Math.max(MIN_HEIGHT, height * 0.96);
    ring = trace(area, height, squareness);
  }
  return { height, ring };
}

/**
 * Stands `count` figures evenly round a ring that fills the band, as large as they can be without
 * crowding. Stretches of the ring where the object would cover a face are left empty, and the
 * figures are made smaller until the rest has room for them. The ring is an oval unless a
 * squarer one, which keeps further from the object, lets the figures be larger. Returned
 * clockwise from the bottom.
 */
export function placeCast(count: number, area: CastArea): Placement[] {
  if (count <= 0) return [];
  let { height, ring } = fit(count, area, RING_SHAPES[0]);
  for (const squareness of RING_SHAPES.slice(1)) {
    const squarer = fit(count, area, squareness);
    if (squarer.height <= height) continue;
    height = squarer.height;
    ring = squarer.ring;
  }
  let stop = 0;
  return Array.from({ length: count }, (_, index) => {
    const target = ((index + 0.5) / count) * ring.length;
    while (stop < ring.stops.length - 1 && ring.stops[stop + 1].distance <= target) stop += 1;
    const { x, baseline, height: size } = ring.stops[stop];
    return { x, baseline, height: size };
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

/** `images` are the characters' sprite sheets, in the order they stand round the ring. */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Each cast stands in its own random order and breaks into wailing in another, so the ring looks
 * different every time a reveal is started.
 */
export function createCast(images: readonly string[]): Cast {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const count = images.length;
  let destroyed = false;
  let sinceComplete: number | null = null;
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
    const object = area.object
      .map((shape) => `${shape.x},${shape.y},${shape.halfWidth},${shape.halfHeight},${shape.round}`)
      .join(';');
    const key = `${area.width}:${area.height}:${area.top}:${area.bottom}:${object}`;
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
    const jig =
      moving && sinceComplete !== null ? clamp(sinceComplete / JIG_RAMP_SECONDS, 0, 1) : 0;
    const fretting = moving && pose === 'wailing' ? 1 : 0;

    const tilt = moving ? HEAD_TILT[pose] * sway(time * HEAD_SPEED[pose], member.phase) : 0;
    const breath = moving ? Math.sin(time * 1.3 + member.phase) * 0.006 : 0;
    const shudder = fretting * Math.sin(time * 23 + member.phase * 3) * 0.006;
    const bounce = fretting * Math.abs(Math.sin(time * 5 + member.phase)) * 0.02;
    const hop = jig * Math.abs(Math.sin(time * 4.2 + member.phase)) * 0.07;
    const lean = jig * Math.sin(time * 8.4 + member.phase * 2) * 0.09;

    const size = spot.height / CHARACTER_SPRITE.panelHeight;
    if (Math.abs(size - member.outlinedAt) > member.outlinedAt * OUTLINE_TOLERANCE) {
      member.outline = outlineSheet(member.image, OUTLINE_WIDTH / size);
      member.outlinedAt = size;
    }
    const scale = size * entrance;
    ctx.save();
    ctx.translate(
      spot.x + shudder * spot.height,
      spot.baseline - (breath + bounce + hop) * spot.height,
    );
    ctx.rotate(lean);
    ctx.scale(scale * (1 - stretch * 0.6), scale * (1 + stretch));
    ctx.translate(-CHARACTER_SPRITE.neckX, -CHARACTER_SPRITE.baseline);
    if (member.outline) drawFigure(ctx, member.outline, pose, tilt, OUTLINE_SHEET_SCALE);
    drawFigure(ctx, member.image, pose, tilt);
    ctx.restore();
  }

  return {
    update(dt, progress, completed) {
      if (completed) sinceComplete = (sinceComplete ?? 0) + dt;
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
