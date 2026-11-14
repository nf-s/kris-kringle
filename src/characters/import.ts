import { z } from 'zod';
import {
  CHARACTER_IMAGE_TYPES,
  CHARACTER_POSES,
  CHARACTER_SPRITE,
  MAX_CHARACTER_IMAGE_BYTES,
  characterNameSchema,
  type CharacterPose,
} from '../../shared/schema';
import { SPRITE_HEIGHT, SPRITE_WIDTH, panelOrigin } from './sprite';

export interface ImportedCharacter {
  name: string;
  sprite: Blob;
}

/** An import failure with a message that can be shown to the person importing. */
export class CharacterImportError extends Error {}

const MANIFEST_NAME = 'characters.json';
/** Height every head is scaled to, crown to neck, so that all figures match. */
const HEAD_HEIGHT = 168;
const WEBP_QUALITY = 0.9;
/**
 * How far the body carries on up behind the head, in sprite pixels. Without it the soft edges of
 * the two layers leave a hairline between them at the neck.
 */
const NECK_OVERLAP = 5;

const pointSchema = z.tuple([z.number(), z.number()]);
const polygonSchema = z.array(pointSchema).min(3);
type Polygon = z.infer<typeof polygonSchema>;

/**
 * One pose in the artwork. `rectangle` is the figure's place in the image (x, y, width, height);
 * the polygons are measured from that rectangle's top-left corner.
 */
const poseSchema = z
  .object({
    path: z.string().min(1),
    rectangle: z.tuple([
      z.number().nonnegative(),
      z.number().nonnegative(),
      z.number().positive(),
      z.number().positive(),
    ]),
    head: z.object({ points: polygonSchema, neckY: z.number().positive() }),
    /** Parts of the body, such as raised arms, that pass in front of the head. */
    foreground: z.union([polygonSchema, z.array(polygonSchema)]).optional(),
  })
  .refine((pose) => pose.head.neckY < pose.rectangle[3]);
type Pose = z.infer<typeof poseSchema>;

const manifestSchema = z.object({
  characters: z
    .array(
      z.object({
        name: characterNameSchema,
        poses: z.object({ praying: poseSchema, wailing: poseSchema, sad: poseSchema.optional() }),
      }),
    )
    .min(1),
});

function relativePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

function tracePolygon(
  ctx: OffscreenCanvasRenderingContext2D,
  points: Polygon,
  originX: number,
  originY: number,
  scale: number,
): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(originX + x * scale, originY + y * scale);
    else ctx.lineTo(originX + x * scale, originY + y * scale);
  });
  ctx.closePath();
}

function foregroundRegions(pose: Pose): Polygon[] {
  const single = polygonSchema.safeParse(pose.foreground);
  if (single.success) return [single.data];
  const several = z.array(polygonSchema).safeParse(pose.foreground);
  return several.success ? several.data : [];
}

/**
 * Draws one pose as its three panels. The body is scaled so neck to knee is the same on every
 * figure and the head so crown to neck is; both are placed with the neck on the shared neck point.
 */
function drawPose(
  ctx: OffscreenCanvasRenderingContext2D,
  image: ImageBitmap,
  pose: Pose,
  row: CharacterPose,
): void {
  const { panelWidth, panelHeight, neckX, neckY, baseline } = CHARACTER_SPRITE;
  const [sourceX, sourceY, sourceWidth, sourceHeight] = pose.rectangle;
  const neckPoints = pose.head.points.filter((point) => point[1] === pose.head.neckY);
  const sourceNeckX = neckPoints.length
    ? neckPoints.reduce((sum, point) => sum + point[0], 0) / neckPoints.length
    : sourceWidth / 2;
  const bodyScale = (baseline - neckY) / (sourceHeight - pose.head.neckY);
  const headScale = HEAD_HEIGHT / pose.head.neckY;

  function panel(
    layer: 'body' | 'head' | 'front',
    scale: number,
    paint: (left: number, top: number, drawSource: () => void) => void,
  ): void {
    const origin = panelOrigin(row, layer);
    const left = origin.x + neckX - sourceNeckX * scale;
    const top = origin.y + neckY - pose.head.neckY * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(origin.x, origin.y, panelWidth, panelHeight);
    ctx.clip();
    paint(left, top, () =>
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        left,
        top,
        sourceWidth * scale,
        sourceHeight * scale,
      ),
    );
    ctx.restore();
  }

  panel('body', bodyScale, (left, top, drawSource) => {
    drawSource();
    ctx.globalCompositeOperation = 'destination-out';
    tracePolygon(ctx, pose.head.points, left, top - NECK_OVERLAP, bodyScale);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  });
  panel('head', headScale, (left, top, drawSource) => {
    tracePolygon(ctx, pose.head.points, left, top, headScale);
    ctx.clip();
    drawSource();
  });
  for (const region of foregroundRegions(pose)) {
    panel('front', bodyScale, (left, top, drawSource) => {
      tracePolygon(ctx, region, left, top, bodyScale);
      ctx.clip();
      drawSource();
    });
  }
}

async function encode(canvas: OffscreenCanvas): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  // A browser that cannot write WebP answers with PNG instead.
  if (!CHARACTER_IMAGE_TYPES.some((type) => type === blob.type)) {
    throw new CharacterImportError('This browser cannot save the sprite. Try Chrome.');
  }
  if (blob.size > MAX_CHARACTER_IMAGE_BYTES) {
    throw new CharacterImportError('A sprite came out too large to store. Try Chrome.');
  }
  return blob;
}

/**
 * Builds sprite sheets from a prototype folder: `characters.json` plus the images it names.
 * Image paths in the file are relative to the folder holding it.
 */
export async function importCharacters(files: readonly File[]): Promise<ImportedCharacter[]> {
  const manifestFile = files
    .filter((file) => file.name === MANIFEST_NAME)
    .sort((a, b) => relativePath(a).length - relativePath(b).length)
    .at(0);
  if (!manifestFile) throw new CharacterImportError(`The folder has no ${MANIFEST_NAME}.`);

  let json: unknown;
  try {
    json = JSON.parse(await manifestFile.text());
  } catch {
    throw new CharacterImportError(`${MANIFEST_NAME} is not valid JSON.`);
  }
  const manifest = manifestSchema.safeParse(json);
  if (!manifest.success) {
    throw new CharacterImportError(`${MANIFEST_NAME} is not in the expected format.`);
  }
  const names = manifest.data.characters.map((character) => character.name);
  if (new Set(names).size !== names.length) {
    throw new CharacterImportError('Two characters share a name. Give each a different name.');
  }

  const folder = relativePath(manifestFile).slice(0, -MANIFEST_NAME.length);
  const byPath = new Map(files.map((file) => [relativePath(file), file]));
  const images = new Map<string, Promise<ImageBitmap>>();
  function loadImage(path: string): Promise<ImageBitmap> {
    const cached = images.get(path);
    if (cached) return cached;
    const file = byPath.get(folder + path);
    if (!file) throw new CharacterImportError(`${path} is missing from the folder.`);
    const loading = createImageBitmap(file);
    images.set(path, loading);
    return loading;
  }

  const imported: ImportedCharacter[] = [];
  try {
    for (const character of manifest.data.characters) {
      const canvas = new OffscreenCanvas(SPRITE_WIDTH, SPRITE_HEIGHT);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new CharacterImportError('This browser cannot draw the sprites.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const row of CHARACTER_POSES) {
        const pose = character.poses[row] ?? character.poses.praying;
        let image: ImageBitmap;
        try {
          image = await loadImage(pose.path);
        } catch (error) {
          if (error instanceof CharacterImportError) throw error;
          throw new CharacterImportError(`${pose.path} could not be read as an image.`);
        }
        const [x, y, width, height] = pose.rectangle;
        if (x + width > image.width || y + height > image.height) {
          throw new CharacterImportError(`${pose.path} is smaller than its figure rectangle.`);
        }
        drawPose(ctx, image, pose, row);
      }
      imported.push({ name: character.name, sprite: await encode(canvas) });
    }
  } finally {
    for (const image of await Promise.allSettled(images.values())) {
      if (image.status === 'fulfilled') image.value.close();
    }
  }
  return imported;
}
