import {
  CHARACTER_LAYERS,
  CHARACTER_POSES,
  CHARACTER_SPRITE,
  type CharacterLayer,
  type CharacterPose,
} from '../../shared/schema';

export const SPRITE_WIDTH = CHARACTER_SPRITE.panelWidth * CHARACTER_LAYERS.length;
export const SPRITE_HEIGHT = CHARACTER_SPRITE.panelHeight * CHARACTER_POSES.length;

/** Top-left corner of one panel in the sprite sheet. */
export function panelOrigin(pose: CharacterPose, layer: CharacterLayer): { x: number; y: number } {
  return {
    x: CHARACTER_LAYERS.indexOf(layer) * CHARACTER_SPRITE.panelWidth,
    y: CHARACTER_POSES.indexOf(pose) * CHARACTER_SPRITE.panelHeight,
  };
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawLayer(
  ctx: Context,
  sprite: CanvasImageSource,
  pose: CharacterPose,
  layer: CharacterLayer,
  sheetScale: number,
): void {
  const { panelWidth, panelHeight } = CHARACTER_SPRITE;
  const origin = panelOrigin(pose, layer);
  ctx.drawImage(
    sprite,
    origin.x * sheetScale,
    origin.y * sheetScale,
    panelWidth * sheetScale,
    panelHeight * sheetScale,
    0,
    0,
    panelWidth,
    panelHeight,
  );
}

/**
 * Draws a whole figure with the panel's top-left at the origin. `tilt` leans the head sideways
 * about the neck: the top of the head moves `tilt` pixels for every pixel it sits above the neck.
 * `sheetScale` is the size of `sprite` relative to a full sprite sheet.
 */
export function drawFigure(
  ctx: Context,
  sprite: CanvasImageSource,
  pose: CharacterPose,
  tilt: number,
  sheetScale = 1,
): void {
  drawLayer(ctx, sprite, pose, 'body', sheetScale);
  ctx.save();
  ctx.transform(1, 0, tilt, 1, -tilt * CHARACTER_SPRITE.neckY, 0);
  drawLayer(ctx, sprite, pose, 'head', sheetScale);
  ctx.restore();
  drawLayer(ctx, sprite, pose, 'front', sheetScale);
}

/** Draws the praying pose, fitted and centred, into a canvas of any size. */
export function drawThumbnail(canvas: HTMLCanvasElement, sprite: CanvasImageSource): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { panelWidth, panelHeight } = CHARACTER_SPRITE;
  const scale = Math.min(canvas.width / panelWidth, canvas.height / panelHeight);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    (canvas.width - panelWidth * scale) / 2,
    (canvas.height - panelHeight * scale) / 2,
  );
  drawFigure(ctx, sprite, 'praying', 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
