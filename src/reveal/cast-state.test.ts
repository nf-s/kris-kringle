import { describe, expect, it } from 'vitest';
import { createCastState } from './cast-state';

const RANKS = Array.from({ length: 19 }, (_, index) => index);

describe('cast inactivity', () => {
  it('stays in its progress poses until someone first interacts', () => {
    const state = createCastState(RANKS);
    state.update(120, 0.5, false);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    expect(state.members.filter((member) => member.wailing)).toHaveLength(10);
  });

  it('waits four seconds, then gently changes all nineteen figures at two-second intervals', () => {
    const state = createCastState(RANKS);
    state.activity();
    state.update(4, 0, false);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    for (let index = 0; index < 19; index++) {
      state.update(0.45, 0, false);
      expect(state.members[index].sadWeight).toBeCloseTo(0.5);
      expect(state.members.slice(0, index).every((member) => member.sadWeight === 1)).toBe(true);
      expect(state.members.slice(index + 1).every((member) => member.sadWeight === 0)).toBe(true);
      state.update(0.45, 0, false);
      expect(state.members[index].sadWeight).toBeCloseTo(1);
      state.update(1.1, 0, false);
    }
    expect(state.members.every((member) => member.sadWeight === 1)).toBe(true);
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
    state.update(4, 0.8, false);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    state.update(0.45, 0.8, false);
    expect(state.members[0].sadWeight).toBeCloseTo(0.5);
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
    state.update(0.033, 0.5, false, 3);
    state.update(0.033, 0.5, false, 0);
    expect(state.members.every((member) => member.sadWeight === 0)).toBe(true);
    state.update(0.033, 0.5, false, 1.45);
    expect(state.members[0].sadWeight).toBeCloseTo(0.5);
    const before = state.members.map((member) => member.sadWeight);
    state.update(60, 0.5, false, 0);
    expect(state.members.map((member) => member.sadWeight)).toEqual(before);
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
