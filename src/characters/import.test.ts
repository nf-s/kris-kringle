import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importCharacters } from './import';

function context() {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    globalCompositeOperation: 'source-over',
  };
}

const canvases: SpriteCanvas[] = [];
class SpriteCanvas {
  ctx = context();
  constructor(
    public width: number,
    public height: number,
  ) {
    canvases.push(this);
  }
  getContext() {
    return this.ctx;
  }
  async convertToBlob() {
    return new Blob(['sprite'], { type: 'image/webp' });
  }
}

const decode = vi.fn(async () => ({ width: 800, height: 1000, close: vi.fn() }));

beforeEach(() => {
  canvases.length = 0;
  decode.mockClear();
  vi.stubGlobal('OffscreenCanvas', SpriteCanvas);
  vi.stubGlobal('createImageBitmap', decode);
});
afterEach(() => vi.unstubAllGlobals());

function pose(path: string, height = 800, neckY = 320) {
  return {
    path,
    rectangle: [0, 0, 400, height],
    head: {
      points: [
        [0, 0],
        [400, 0],
        [400, neckY],
        [0, neckY],
      ],
      neckY,
    },
  };
}

function files(sad?: unknown): File[] {
  const poses = { praying: pose('prayer.png'), wailing: pose('wail.png'), sad };
  return [
    new File(
      [JSON.stringify({ characters: [{ name: 'Sample Character', poses }] })],
      'characters.json',
    ),
    ...['prayer.png', 'wail.png', 'sad.png'].map(
      (name) => new File(['image'], name, { type: 'image/png' }),
    ),
  ];
}

describe('importing character poses', () => {
  it('imports a sad pose into a third row and closes all decoded artwork', async () => {
    const imported = await importCharacters(files(pose('sad.png')));
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe('Sample Character');
    expect(imported[0].sprite.type).toBe('image/webp');
    expect(canvases.map(({ width, height }) => [width, height])).toEqual([[1152, 1440]]);
    expect(decode).toHaveBeenCalledTimes(3);
    const imageResults = await Promise.all(decode.mock.results.map((result) => result.value));
    const canvas = canvases[0];
    expect(canvas.ctx.drawImage.mock.calls.map((call) => call[0])).toEqual([
      imageResults[0],
      imageResults[0],
      imageResults[1],
      imageResults[1],
      imageResults[2],
      imageResults[2],
    ]);
    expect(canvas.ctx.rect).toHaveBeenCalledWith(0, 960, 384, 480);
    expect(canvas.ctx.rect).toHaveBeenCalledWith(384, 960, 384, 480);
    for (const image of imageResults) expect(image.close).toHaveBeenCalledOnce();
  });

  it('fills the sad row with prayer artwork when importing a legacy manifest', async () => {
    await importCharacters(files());
    expect(decode).toHaveBeenCalledTimes(2);
    const imageResults = await Promise.all(decode.mock.results.map((result) => result.value));
    expect(canvases[0].ctx.drawImage.mock.calls.map((call) => call[0])).toEqual([
      imageResults[0],
      imageResults[0],
      imageResults[1],
      imageResults[1],
      imageResults[0],
      imageResults[0],
    ]);
    expect(canvases[0].ctx.rect).toHaveBeenCalledWith(0, 960, 384, 480);
  });

  it('rejects a supplied malformed sad pose instead of silently using prayer', async () => {
    await expect(importCharacters(files({ path: 'sad.png' }))).rejects.toThrow(
      'not in the expected format',
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it('reports missing supplied sad artwork instead of silently using prayer', async () => {
    await expect(importCharacters(files(pose('missing.png')))).rejects.toThrow(
      'missing.png is missing from the folder',
    );
  });

  it('rejects neck anchors at or below the knees before drawing', async () => {
    await expect(importCharacters(files(pose('sad.png', 800, 800)))).rejects.toThrow(
      'not in the expected format',
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects rectangles outside decoded artwork and releases loaded images', async () => {
    await expect(importCharacters(files(pose('sad.png', 1001)))).rejects.toThrow(
      'smaller than its figure rectangle',
    );
    const imageResults = await Promise.all(decode.mock.results.map((result) => result.value));
    for (const image of imageResults) expect(image.close).toHaveBeenCalledOnce();
  });
});
