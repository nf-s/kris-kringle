import { clamp, lerp } from './draw';

/** Progress at which the first and the last character start wailing. */
const FIRST_BREAK = 0.08;
const LAST_BREAK = 0.9;
/** Progress must fall this far below a character's breaking point before it calms down. */
const CALM_MARGIN = 0.1;
const IDLE_GRACE_SECONDS = 4;
const SAD_STAGGER_SECONDS = 2;
const SAD_TRANSITION_SECONDS = 0.9;

export const SWITCH_SECONDS = 0.36;

interface MemberState {
  wailing: boolean;
  sinceSwitch: number;
  sadWeight: number;
}

export interface CastState {
  readonly members: readonly MemberState[];
  activity(): void;
  /** `idleDt` is elapsed visible-page time, independent of the capped animation timestep. */
  update(dt: number, progress: number, completed: boolean, idleDt?: number): void;
}

/** Sadness overlays the progress pose without changing its threshold or hysteresis. */
export function createCastState(ranks: readonly number[]): CastState {
  const members = ranks.map((rank) => ({
    breaksAt: ranks.length > 1 ? lerp(FIRST_BREAK, LAST_BREAK, rank / (ranks.length - 1)) : 0.5,
    wailing: false,
    sinceSwitch: SWITCH_SECONDS,
    sadWeight: 0,
  }));
  let started = false;
  let completed = false;
  let idleSeconds = 0;

  return {
    members,
    activity() {
      if (completed) return;
      started = true;
      idleSeconds = 0;
      for (const member of members) member.sadWeight = 0;
    },
    update(dt, progress, complete, idleDt = dt) {
      completed = completed || complete;
      if (completed) {
        started = false;
        idleSeconds = 0;
      } else if (started) idleSeconds += idleDt;

      for (const [index, member] of members.entries()) {
        const calmAt = member.wailing ? member.breaksAt - CALM_MARGIN : member.breaksAt;
        const wailing = completed || progress >= calmAt;
        if (wailing !== member.wailing) {
          member.wailing = wailing;
          member.sinceSwitch = 0;
        }
        member.sinceSwitch += dt;
        member.sadWeight = started
          ? clamp(
              (idleSeconds - IDLE_GRACE_SECONDS - index * SAD_STAGGER_SECONDS) /
                SAD_TRANSITION_SECONDS,
              0,
              1,
            )
          : 0;
      }
    },
  };
}
