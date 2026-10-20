import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const profileSchema = z.object({ firstName: text(120).optional(), lastName: text(120).optional(), phone: text(30).nullable().optional() })
  .strict().refine(value => Object.keys(value).length > 0);
const preferencesSchema = z.object({ appointmentEmailsEnabled: z.boolean(), offerEmailsEnabled: z.boolean() }).strict();
export type ProfileUpdate = z.infer<typeof profileSchema>;
export type PreferencesUpdate = z.infer<typeof preferencesSchema>;
function parse<T>(schema: z.ZodType<T>, body: unknown, query: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success || !z.object({}).strict().safeParse(query).success) throw new BadRequestException('Invalid account request');
  return result.data;
}
export const parseProfileUpdate = (body: unknown, query: unknown): ProfileUpdate => parse(profileSchema, body, query);
export const parsePreferencesUpdate = (body: unknown, query: unknown): PreferencesUpdate => parse(preferencesSchema, body, query);
