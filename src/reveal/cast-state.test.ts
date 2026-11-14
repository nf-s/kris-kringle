import { describe, expect, it } from 'vitest';
import { createCastState } from './cast-state';

const RANKS = Array.from({ length: 19 }, (_, index) => index);

function random(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function sequence(state: ReturnType<typeof createCastState>): { index: number; time: number }[] {
  const order: { index: number; time: number }[] = [];
  for (let step = 1; step <= 2000; step++) {
    state.update(0.005, 0.5, false);
    for (const [index, member] of state.members.entries()) {
      if (member.sadWeight > 0 && !order.some((entry) => entry.index === index)) {
        order.push({ index, time: step * 0.005 });
      }
    }
  }
  return order;
}

describe('cast inactivity', () => {
  it('stays in its progress poses until someone first interacts', () => {
    const state = createCastState(RANKS);
    state.update(120, 0.5, false);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    expect(state.members.filter((member) => member.wailing)).toHaveLength(10);
  });

  it('starts after three quarters of a second and fades the first figure over a quarter second', () => {
    const state = createCastState(RANKS, random(42));
    state.activity();
    state.update(0.75, 0, false);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    state.update(0.125, 0, false);
    const changing = state.members.filter((member) => member.sadWeight > 0);
    expect(changing).toHaveLength(1);
    expect(changing[0].sadWeight).toBeCloseTo(0.5);
    state.update(0.125, 0, false);
    expect(changing[0].sadWeight).toBe(1);
  });

  it('scatters all nineteen changes around the ring with uneven 150–450ms steps', () => {
    const state = createCastState(RANKS, random(42));
    state.activity();
    const order = sequence(state);
    expect(order).toHaveLength(19);
    expect(new Set(order.map((entry) => entry.index)).size).toBe(19);
    expect(order[0].time).toBeCloseTo(0.75, 2);
    const steps = order.slice(1).map((entry, index) => entry.time - order[index].time);
    expect(steps.every((step) => step >= 0.145 && step <= 0.455)).toBe(true);
    expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(0.1);
    expect(
      order.slice(1).some((entry, index) => {
        const distance = Math.abs(entry.index - order[index].index);
        return distance !== 1 && distance !== 18;
      }),
    ).toBe(true);
    expect(order[18].time + 0.25).toBeGreaterThanOrEqual(3.7);
    expect(order[18].time + 0.25).toBeLessThanOrEqual(9.11);
    expect(state.members.every((member) => member.sadWeight === 1)).toBe(true);
  });

  it('reshuffles each inactivity episode independently of the wailing ranks', () => {
    const state = createCastState(RANKS, random(42));
    const reversed = createCastState([...RANKS].reverse(), random(42));
    state.activity();
    reversed.activity();
    const first = sequence(state);
    expect(sequence(reversed)).toEqual(first);
    state.activity();
    expect(sequence(state).map((entry) => entry.index)).not.toEqual(
      first.map((entry) => entry.index),
    );
  });

  it('restores the current progress poses on activity and restarts the full grace period', () => {
    const state = createCastState(RANKS);
    state.activity();
    state.update(50, 0.5, false);
    expect(state.members.every((member) => member.sadWeight === 1)).toBe(true);
    state.update(0.5, 0.8, false);
    const poses = state.members.map((member) => member.wailing);
    state.activity();
    expect(state.members.map((member) => member.wailing)).toEqual(poses);
    expect(poses.filter(Boolean)).toHaveLength(16);
    state.update(0.75, 0.8, false);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    state.update(0.125, 0.8, false);
    expect(Math.max(...state.members.map((member) => member.sadWeight))).toBeCloseTo(0.5);
  });

  it('clears sadness at completion and never restarts it afterward', () => {
    const state = createCastState(RANKS);
    state.activity();
    state.update(50, 0.5, false);
    state.update(0.016, 1, true);
    expect(state.members.every((member) => member.sadWeight === 0 && member.wailing)).toBe(true);
    state.activity();
    state.update(100, 1, true);
    expect(state.members.every((member) => member.sadWeight === 0 && member.wailing)).toBe(true);
  });

  it('counts only visible time while keeping the animation timestep independent', () => {
    const state = createCastState(RANKS);
    state.activity();
    state.update(0.033, 0.5, false, 0.5);
    state.update(0.033, 0.5, false, 0);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    state.update(0.033, 0.5, false, 0.375);
    expect(Math.max(...state.members.map((member) => member.sadWeight))).toBeCloseTo(0.5);
    const before = state.members.map((member) => member.sadWeight);
    state.update(60, 0.5, false, 0);
    expect(state.members.map((member) => member.sadWeight)).toEqual(before);
  });
});

describe('individual character taps', () => {
  it('toggles one figure immediately without starting or resetting the group idle timer', () => {
    const state = createCastState(RANKS, random(42));
    expect(state.toggle(4)).toBe(true);
    expect(state.members[4].sadWeight).toBe(1);
    state.update(100, 0, false);
    expect(state.members.filter((member) => member.sadWeight > 0)).toHaveLength(1);
    state.toggle(4);
    expect(state.members[4].sadWeight).toBe(0);
    expect(state.toggle(30)).toBe(false);

    state.activity();
    state.update(10, 0.5, false);
    state.toggle(4);
    state.update(10, 0.5, false);
    expect(state.members[4].sadWeight).toBe(0);
    expect(state.members.filter((member) => member.sadWeight === 1)).toHaveLength(18);
  });

  it('resets manual overrides on actual task activity and restores the progress pose', () => {
    const state = createCastState(RANKS, random(42));
    state.update(1, 0.8, false);
    state.toggle(2);
    expect(state.members[2].sadWeight).toBe(1);
    state.activity();
    expect(state.members[2].sadWeight).toBe(0);
    expect(state.members[2].wailing).toBe(true);
    state.update(10, 0.8, false);
    expect(state.members.every((member) => member.sadWeight === 1)).toBe(true);
  });

  it('clears overrides once at completion but allows later individual taps to persist', () => {
    const state = createCastState(RANKS, random(42));
    state.toggle(2);
    state.update(0, 1, true);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    state.toggle(2);
    state.update(20, 1, true);
    expect(state.members[2].sadWeight).toBe(1);
    expect(state.members.filter((member) => member.sadWeight > 0)).toHaveLength(1);
    state.toggle(2);
    expect(state.members[2].sadWeight).toBe(0);
  });
});

describe('progress poses underneath sadness', () => {
  it('keeps the first and last wailing thresholds and all nineteen sequential steps', () => {
    const state = createCastState(RANKS);
    state.update(0, 0.079, false);
    expect(state.members.some((member) => member.wailing)).toBe(false);
    state.update(0, 0.08, false);
    expect(state.members.filter((member) => member.wailing)).toHaveLength(1);
    state.update(0, 0.899, false);
    expect(state.members.filter((member) => member.wailing)).toHaveLength(18);
    state.update(0, 0.9, false);
    expect(state.members.every((member) => member.wailing)).toBe(true);
  });

  it('preserves calming hysteresis as progress falls during inactivity', () => {
    const state = createCastState([0, 1, 2]);
    state.activity();
    state.update(20, 0.5, false);
    expect(state.members[1].wailing).toBe(true);
    state.update(1, 0.4, false);
    expect(state.members[1].wailing).toBe(true);
    state.update(1, 0.38, false);
    expect(state.members[1].wailing).toBe(false);
    state.activity();
    expect(state.members[1].wailing).toBe(false);
    expect(state.members[1].sadWeight).toBe(0);
  });
});
