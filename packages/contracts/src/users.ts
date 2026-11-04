import { z } from "zod";
import { notificationSchema } from "./admin.js";
import { sessionResponseSchema } from "./diagnostics.js";

/** Account session list item: base session plus progress counts. */
export const mySessionItemSchema = sessionResponseSchema.extend({
  test_count: z.number().int().nonnegative(),
  tests_recorded: z.number().int().nonnegative(),
  evidence_count: z.number().int().nonnegative(),
});
export type MySessionItem = z.infer<typeof mySessionItemSchema>;

export const listMySessionsResponseSchema = z.object({
  sessions: z.array(mySessionItemSchema),
});
export type ListMySessionsResponse = z.infer<typeof listMySessionsResponseSchema>;

/** One row of the account activity feed: a persisted session event. */
export const activityItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  event_type: z.string(),
  device_type: z.string(),
  model: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const listActivityResponseSchema = z.object({
  activity: z.array(activityItemSchema),
});
export type ListActivityResponse = z.infer<typeof listActivityResponseSchema>;

/** Account-scoped notifications: owned rows plus global announcements. */
export const listMyNotificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  total: z.number().int(),
  unread: z.number().int(),
});
export type ListMyNotificationsResponse = z.infer<
  typeof listMyNotificationsResponseSchema
>;
