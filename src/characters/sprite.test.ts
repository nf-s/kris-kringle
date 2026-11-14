import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_POSES } from '../../shared/schema';
import {
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  drawFigure,
  isCharacterSpriteSize,
  panelOrigin,
} from './sprite';

class SpriteCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => vi.stubGlobal('OffscreenCanvas', SpriteCanvas));
afterEach(() => vi.unstubAllGlobals());

describe('character sprite rows', () => {
  it('appends sad after the two existing poses', () => {
    expect(CHARACTER_POSES).toEqual(['praying', 'wailing', 'sad']);
    expect([SPRITE_WIDTH, SPRITE_HEIGHT]).toEqual([1152, 1440]);
    expect(panelOrigin('praying', 'body')).toEqual({ x: 0, y: 0 });
    expect(panelOrigin('wailing', 'head')).toEqual({ x: 384, y: 480 });
    expect(panelOrigin('sad', 'front')).toEqual({ x: 768, y: 960 });
  });

  it('accepts complete legacy and current sheets and rejects other dimensions', () => {
    expect(isCharacterSpriteSize(1152, 960)).toBe(true);
    expect(isCharacterSpriteSize(1152, 1440)).toBe(true);
    for (const [width, height] of [
      [384, 1440],
      [1152, 480],
      [1152, 1439],
      [1152, 1920],
      [0, 0],
    ]) {
      expect(isCharacterSpriteSize(width, height)).toBe(false);
    }
  });

  it.each([
    { height: 1440, scale: 1, sourceY: 960 },
    { height: 960, scale: 1, sourceY: 0 },
    { height: 1440, scale: 0.5, sourceY: 480 },
    { height: 960, scale: 0.5, sourceY: 0 },
  ])(
    'draws every sad layer from the available row at height $height and scale $scale',
    ({ height, scale, sourceY }) => {
      const ctx = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), transform: vi.fn() };
      const sprite = new OffscreenCanvas(SPRITE_WIDTH * scale, height * scale);
      drawFigure(ctx, sprite, 'sad', 0.02, scale);
      expect(ctx.drawImage).toHaveBeenCalledTimes(3);
      for (const [index, sourceX] of [0, 384, 768].entries()) {
        expect(ctx.drawImage).toHaveBeenNthCalledWith(
          index + 1,
          sprite,
          sourceX * scale,
          sourceY,
          384 * scale,
          480 * scale,
          0,
          0,
          384,
          480,
        );
      }
    },
  );

  it('uses the legacy prayer row when building a sad outline', () => {
    expect(panelOrigin('sad', 'front', 960)).toEqual({ x: 768, y: 0 });
    expect(panelOrigin('wailing', 'front', 960)).toEqual({ x: 768, y: 480 });
  });

  it('uses decoded dimensions even when an image is displayed at another size', () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalHeight = 1440;
        height = 480;
      },
    );
    const ctx = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), transform: vi.fn() };
    const image = new Image();
    drawFigure(ctx, image, 'sad', 0);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, image, 0, 960, 384, 480, 0, 0, 384, 480);
  });
});
