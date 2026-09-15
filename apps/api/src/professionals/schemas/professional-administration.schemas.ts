import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedRequest } from '../../authorization/types/authorization-context.js';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const ids = z.array(z.string().uuid()).max(100).refine((values) => new Set(values).size === values.length);
const fields = {
  internalCode: nullableText(60),
  titleOrFunction: nullableText(160),
  description: nullableText(10_000),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  branchIds: ids,
  serviceIds: ids,
};
export const createProfessionalSchema = z.object({
  ...fields, userId: z.string().uuid(),
}).strict().refine((value) => value.branchIds.length > 0 && value.serviceIds.length > 0);
export const updateProfessionalSchema = z.object(fields).partial().strict()
  .refine((value) => Object.keys(value).length > 0);
export type CreateProfessionalInput = z.infer<typeof createProfessionalSchema>;
export type UpdateProfessionalInput = z.infer<typeof updateProfessionalSchema>;

export function parseProfessionalInput<T>(schema: z.ZodType<T>, body: unknown, query: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || !z.object({}).strict().safeParse(query).success) {
    throw new BadRequestException('Invalid professional administration request');
  }
  return parsed.data;
}

export function professionalAdministrationContext(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) {
    throw new UnauthorizedException('Unauthorized');
  }
  if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
  return request.authorization;
}
