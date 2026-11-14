import { z } from 'zod';
import {
  MAX_CHARACTERS,
  MAX_CHARACTER_IMAGE_BYTES,
  characterImageTypeSchema,
  characterNameSchema,
  type CharacterImageType,
  type CharacterList,
} from '../shared/schema';

export const storedCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
});
export type StoredCharacter = z.infer<typeof storedCharacterSchema>;

/** Every character in the library, oldest first. */
export const characterLibrarySchema = z.array(storedCharacterSchema);

export const characterImageSchema = z.object({
  type: characterImageTypeSchema,
  bytes: z.instanceof(ArrayBuffer),
});
export type CharacterImage = z.infer<typeof characterImageSchema>;

/** A validated upload. `image` is null when an update keeps the current image. */
export interface CharacterForm {
  name: string;
  image: { type: CharacterImageType; file: File } | null;
}

const formFieldsSchema = z.object({
  name: z.unknown().optional(),
  image: z.unknown().optional(),
});

const NAME_ERROR = 'Name must be 1 to 40 characters';
const TYPE_ERROR = 'Image must be WebP or PNG';
const SIZE_ERROR = `Image must be at most ${MAX_CHARACTER_IMAGE_BYTES / 1_000_000} MB`;

/** Validates a multipart character form. Returns an error message on failure. */
export function parseCharacterForm(body: unknown, requireImage: boolean): CharacterForm | string {
  const fields = formFieldsSchema.safeParse(body);
  if (!fields.success) return 'Invalid form';
  const name = characterNameSchema.safeParse(fields.data.name);
  if (!name.success) return NAME_ERROR;
  if (fields.data.image === undefined && !requireImage) return { name: name.data, image: null };
  const file = z.instanceof(File).safeParse(fields.data.image);
  if (!file.success) return 'Choose an image';
  const type = characterImageTypeSchema.safeParse(file.data.type);
  if (!type.success) return TYPE_ERROR;
  if (file.data.size === 0 || file.data.size > MAX_CHARACTER_IMAGE_BYTES) return SIZE_ERROR;
  return { name: name.data, image: { type: type.data, file: file.data } };
}

export function toCharacterList(library: readonly StoredCharacter[]): CharacterList {
  return { characters: library.map(({ id, name }) => ({ id, name })) };
}

export function characterIds(library: readonly StoredCharacter[]): Set<string> {
  return new Set(library.map((character) => character.id));
}

/** Appends a character. Returns an error message when the library is full. */
export function addCharacter(
  library: readonly StoredCharacter[],
  character: StoredCharacter,
): StoredCharacter[] | string {
  if (library.length >= MAX_CHARACTERS) return `The library holds at most ${MAX_CHARACTERS}`;
  return [...library, character];
}

/** Returns null if the character does not exist. */
export function renameCharacter(
  library: readonly StoredCharacter[],
  id: string,
  name: string,
): StoredCharacter[] | null {
  if (!library.some((character) => character.id === id)) return null;
  return library.map((character) => (character.id === id ? { ...character, name } : character));
}

/** Returns null if the character does not exist. */
export function removeCharacter(
  library: readonly StoredCharacter[],
  id: string,
): StoredCharacter[] | null {
  if (!library.some((character) => character.id === id)) return null;
  return library.filter((character) => character.id !== id);
}
