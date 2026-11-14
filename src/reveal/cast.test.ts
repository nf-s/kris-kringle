import { describe, expect, it } from 'vitest';
import { placeCast, type CastArea, type Placement } from './cast';
import type { Shape } from './engine';

/** A phone held upright, with room for the heading above the band and the hint below it. */
function phone(object: Shape[]): CastArea {
  return { width: 375, height: 650, top: 116, bottom: 570, object };
}

const GLOBE: Shape[] = [
  { x: 187, y: 315, halfWidth: 105, halfHeight: 105, round: true },
  { x: 187, y: 430, halfWidth: 100, halfHeight: 33, round: false },
];
const CRACKER: Shape[] = [
  { x: 187, y: 338, halfWidth: 80, halfHeight: 30, round: false },
  { x: 74, y: 349, halfWidth: 33, halfHeight: 34, round: false },
  { x: 300, y: 327, halfWidth: 33, halfHeight: 34, round: false },
];

/** The middle of a figure's face. */
function face(spot: Placement): { x: number; y: number } {
  return { x: spot.x, y: spot.baseline - spot.height * 0.72 };
}

function inside(point: { x: number; y: number }, shape: Shape): boolean {
  const dx = (point.x - shape.x) / shape.halfWidth;
  const dy = (point.y - shape.y) / shape.halfHeight;
  return shape.round ? dx * dx + dy * dy < 1 : Math.abs(dx) < 1 && Math.abs(dy) < 1;
}

describe('placing the cast', () => {
  it('stands nobody where there is nobody to stand', () => {
    expect(placeCast(0, phone(GLOBE))).toEqual([]);
  });

  it('keeps every face out from behind the object on a phone', () => {
    for (const object of [GLOBE, CRACKER]) {
      const spots = placeCast(18, phone(object));
      expect(spots).toHaveLength(18);
      for (const spot of spots) {
        expect(object.some((shape) => inside(face(spot), shape))).toBe(false);
      }
    }
  });

  it('keeps every figure on the screen and inside the band', () => {
    const area = phone(GLOBE);
    for (const spot of placeCast(18, area)) {
      expect(spot.x - spot.height * 0.25).toBeGreaterThanOrEqual(0);
      expect(spot.x + spot.height * 0.25).toBeLessThanOrEqual(area.width);
      expect(spot.baseline).toBeLessThanOrEqual(area.bottom);
      expect(spot.baseline - spot.height).toBeGreaterThanOrEqual(area.top - 1);
    }
  });

  it('makes the figures larger when there are fewer of them', () => {
    const few = placeCast(6, phone(GLOBE));
    const many = placeCast(18, phone(GLOBE));
    expect(few[0].height).toBeGreaterThan(many[0].height);
  });

  it('does not let a wide object shrink the figures much below what a small one allows', () => {
    const open = Math.max(...placeCast(18, phone([])).map((spot) => spot.height));
    const round = Math.max(...placeCast(18, phone(GLOBE)).map((spot) => spot.height));
    expect(round).toBeGreaterThan(open * 0.75);
    expect(round).toBeGreaterThan(90);
  });

  it('stands the figures evenly either side of the middle when nothing is in the way', () => {
    const area = { width: 1200, height: 800, top: 120, bottom: 720, object: [] };
    const spots = placeCast(12, area);
    for (let index = 0; index < 6; index++) {
      const mirror = spots[11 - index];
      expect(Math.abs(spots[index].x + mirror.x - area.width)).toBeLessThan(12);
      expect(Math.abs(spots[index].baseline - mirror.baseline)).toBeLessThan(12);
    }
  });
});
