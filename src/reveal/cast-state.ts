import { clamp, lerp } from './draw';

/** Progress at which the first and the last character start wailing. */
const FIRST_BREAK = 0.08;
const LAST_BREAK = 0.9;
/** Progress must fall this far below a character's breaking point before it calms down. */
const CALM_MARGIN = 0.1;
const IDLE_GRACE_SECONDS = 0.75;
const SAD_STEP_MIN_SECONDS = 0.15;
const SAD_STEP_MAX_SECONDS = 0.45;
const SAD_TRANSITION_SECONDS = 0.25;

export const SWITCH_SECONDS = 0.36;

interface MemberState {
  wailing: boolean;
  sinceSwitch: number;
  sadWeight: number;
}

interface ScheduledMember extends MemberState {
  breaksAt: number;
  sadAt: number;
  manualSad: boolean | null;
}

export interface CastState {
  readonly members: readonly MemberState[];
  activity(): void;
  toggle(index: number): boolean;
  /** `idleDt` is elapsed visible-page time, independent of the capped animation timestep. */
  update(dt: number, progress: number, completed: boolean, idleDt?: number): void;
}

/** Sadness overlays the progress pose without changing its threshold or hysteresis. */
export function createCastState(ranks: readonly number[], random = Math.random): CastState {
  const members: ScheduledMember[] = ranks.map((rank) => ({
    breaksAt: ranks.length > 1 ? lerp(FIRST_BREAK, LAST_BREAK, rank / (ranks.length - 1)) : 0.5,
    wailing: false,
    sinceSwitch: SWITCH_SECONDS,
    sadWeight: 0,
    sadAt: 0,
    manualSad: null,
  }));
  let started = false;
  let completed = false;
  let idleSeconds = 0;
  let scheduled = false;

  function schedule(): void {
    const order = members.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    let next = IDLE_GRACE_SECONDS;
    for (const index of order) {
      members[index].sadAt = next;
      next += lerp(SAD_STEP_MIN_SECONDS, SAD_STEP_MAX_SECONDS, random());
    }
    scheduled = true;
  }

  function clearOverrides(): void {
    for (const member of members) {
      member.manualSad = null;
      member.sadWeight = 0;
    }
  }

  return {
    members,
    activity() {
      if (completed) return;
      started = true;
      idleSeconds = 0;
      scheduled = false;
      clearOverrides();
    },
    toggle(index) {
      const member = members[index];
      if (!member) return false;
      member.manualSad = member.sadWeight === 0;
      member.sadWeight = Number(member.manualSad);
      return true;
    },
    update(dt, progress, complete, idleDt = dt) {
      if (complete && !completed) {
        completed = true;
        started = false;
        idleSeconds = 0;
        clearOverrides();
      } else if (started) idleSeconds += idleDt;
      if (started && !scheduled && idleSeconds >= IDLE_GRACE_SECONDS) schedule();

      for (const member of members) {
        const calmAt = member.wailing ? member.breaksAt - CALM_MARGIN : member.breaksAt;
        const wailing = completed || progress >= calmAt;
        if (wailing !== member.wailing) {
          member.wailing = wailing;
          member.sinceSwitch = 0;
        }
        member.sinceSwitch += dt;
        member.sadWeight =
          member.manualSad !== null
            ? Number(member.manualSad)
            : started && scheduled
              ? clamp((idleSeconds - member.sadAt) / SAD_TRANSITION_SECONDS, 0, 1)
              : 0;
      }
    },
  };
}
