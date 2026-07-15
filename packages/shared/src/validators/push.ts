import { z } from "zod";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const pushPrefsSchema = z
  .object({
    minBand: z.enum(["high", "critical"]),
    quietStart: hhmm.nullable(),
    quietEnd: hhmm.nullable(),
    timezone: z.string().min(1).max(64).nullable(),
  })
  .refine((v) => (v.quietStart === null) === (v.quietEnd === null), {
    message: "quietStart and quietEnd must both be set or both null",
  })
  .refine((v) => v.quietStart === null || v.timezone !== null, {
    message: "timezone is required when quiet hours are set",
  });
export type PushPrefsInput = z.infer<typeof pushPrefsSchema>;
