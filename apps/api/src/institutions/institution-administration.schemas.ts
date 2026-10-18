import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const fields = z.object({
  name: text(180),
  legalName: text(220).nullable().optional(),
  taxIdentifier: text(30).nullable().optional(),
  contactEmail: z.string().trim().email().max(254).transform(value => value.toLowerCase()).nullable().optional(),
  phone: text(30).nullable().optional(),
}).strict();
const timeZone = text(80).regex(/^[A-Za-z][A-Za-z0-9_+./-]*$/).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
});
export const createInstitutionSchema = fields.extend({ timeZone: timeZone.optional() }).strict();
// Changing a zone or state can affect existing agendas; neither operation is part of RF-005 here.
export const updateInstitutionSchema = fields.partial().refine(value => Object.keys(value).length > 0);
export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;
export type UpdateInstitutionInput = z.infer<typeof updateInstitutionSchema>;
const empty = z.object({}).strict();
export function parseInstitutionAdministration<T>(schema: z.ZodType<T>, body: unknown, query: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || !empty.safeParse(query).success) throw new BadRequestException('Invalid institution request');
  return parsed.data;
}
export function parseInstitutionAdministrationRead(body: unknown, query: unknown) {
  parseInstitutionAdministration(empty, body ?? {}, query);
}
export function institutionAdministrationContext(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) {
    throw new UnauthorizedException('Unauthorized');
  }
  return request.authorization;
}
