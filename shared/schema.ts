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

/** The event that existed before multiple events were supported. Its data is never moved. */
export const MAIN_EVENT_ID = 'main';

export const adminPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  reveal: revealKindSchema,
  /** True once the person has finished their reveal for the current draw. */
  opened: z.boolean(),
  receiverId: z.string().nullable(),
  /** Ids of people this person must not draw. */
  exclusions: z.array(z.string()).default([]),
  /** Times (ms since epoch) the link was loaded for the current draw. */
  views: z.array(z.number()).default([]),
  /** Times (ms since epoch) the reveal was finished for the current draw. */
  completions: z.array(z.number()).default([]),
});
export type AdminPerson = z.infer<typeof adminPersonSchema>;

export const adminStateSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  drawn: z.boolean(),
  people: z.array(adminPersonSchema),
});
export type AdminState = z.infer<typeof adminStateSchema>;

export const eventSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  peopleCount: z.number(),
  drawn: z.boolean(),
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

export const eventListSchema = z.object({ events: z.array(eventSummarySchema) });
export type EventList = z.infer<typeof eventListSchema>;

export const revealResponseSchema = z.object({
  title: z.string(),
  note: z.string(),
  giverName: z.string(),
  receiverName: z.string(),
  reveal: revealKindSchema,
});
export type RevealResponse = z.infer<typeof revealResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() });

export const createEventRequestSchema = z.object({
  title: z.string().trim().min(1).max(80),
});
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

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

/** Every person's full exclusion list, keyed by person id. People left out have none. */
export const exclusionsRequestSchema = z.object({
  exclusions: z.record(z.string(), z.array(z.string()).max(200)),
});
export type ExclusionsRequest = z.infer<typeof exclusionsRequestSchema>;
