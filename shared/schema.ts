import { z } from 'zod';

export const revealKindSchema = z.enum(['egg', 'jack', 'present', 'cracker', 'globe']);
export type RevealKind = z.infer<typeof revealKindSchema>;
export const REVEAL_KINDS: readonly RevealKind[] = revealKindSchema.options;

export const REVEAL_LABELS: Record<RevealKind, string> = {
  egg: 'Crack the egg',
  jack: 'Wind the jack-in-the-box',
  present: 'Untie the present',
  cracker: 'Pull the cracker',
  globe: 'Shake the snow globe',
};

export const adminPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  reveal: revealKindSchema,
  opened: z.boolean(),
  receiverId: z.string().nullable(),
});
export type AdminPerson = z.infer<typeof adminPersonSchema>;

export const adminStateSchema = z.object({
  title: z.string(),
  note: z.string(),
  drawn: z.boolean(),
  people: z.array(adminPersonSchema),
});
export type AdminState = z.infer<typeof adminStateSchema>;

export const revealResponseSchema = z.object({
  title: z.string(),
  note: z.string(),
  giverName: z.string(),
  receiverName: z.string(),
  reveal: revealKindSchema,
});
export type RevealResponse = z.infer<typeof revealResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() });

export const settingsRequestSchema = z.object({
  title: z.string().trim().max(80),
  note: z.string().trim().max(200),
});
export type SettingsRequest = z.infer<typeof settingsRequestSchema>;

export const addPeopleRequestSchema = z.object({
  names: z.array(z.string().trim().min(1).max(40)).min(1).max(100),
});
export type AddPeopleRequest = z.infer<typeof addPeopleRequestSchema>;

export const updatePersonRequestSchema = z.object({
  reveal: revealKindSchema,
});
export type UpdatePersonRequest = z.infer<typeof updatePersonRequestSchema>;
