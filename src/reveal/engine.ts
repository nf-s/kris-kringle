import type { Particles } from './particles';
import type { Sfx } from './sfx';

export interface Point {
  x: number;
  y: number;
}

/**
 * What a reveal can see and do. All coordinates are CSS pixels with the origin at the top-left of
 * the stage. `width` and `height` are live and change on resize, so read them every frame.
 */
export interface Stage {
  readonly width: number;
  readonly height: number;
  /** Seconds since the stage started. */
  readonly time: number;
  readonly completed: boolean;
  readonly receiverName: string;
  /** Shared particle system, drawn above the reveal. */
  readonly particles: Particles;
  readonly sfx: Sfx;
  /** Adds screen shake, in pixels. Decays on its own. */
  shake(amount: number): void;
  haptic(pattern: number | number[]): void;
  /** Sets the instruction shown under the stage. */
  setHint(text: string): void;
  /** Sets the progress bar, 0 to 1. */
  setProgress(value: number): void;
  /**
   * Call once the object has opened. Fires the shared finale (confetti, fanfare and the name card
   * in the centre of the screen). After calling it, clear the centre of the stage within ~0.6s.
   */
  complete(origin: Point): void;
}

export interface Reveal {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  onPointerDown?(point: Point): void;
  onPointerMove?(point: Point, down: boolean): void;
  onPointerUp?(point: Point): void;
}

export type RevealFactory = (stage: Stage) => Reveal;
