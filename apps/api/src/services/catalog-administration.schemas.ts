import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const integer = z.number().int().max(2_147_483_647);
const branch = z.object({
  code: text(50),
  name: text(160),
  addressLine1: nullableText(220),
  addressLine2: nullableText(220),
  municipality: nullableText(120),
  region: nullableText(120),
  country: text(80).optional(),
  latitude: z.number().min(-90).max(90).multipleOf(0.0000001).nullable().optional(),
  longitude: z.number().min(-180).max(180).multipleOf(0.0000001).nullable().optional(),
  phone: nullableText(30),
  email: z.string().trim().email().max(254).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict();
const service = z.object({
  code: text(50),
  name: text(180),
  description: nullableText(10_000),
  categoryId: z.string().uuid().nullable().optional(),
  durationMinutes: integer.positive(),
  minimumAdvanceMinutes: integer.nonnegative().optional(),
  maximumAdvanceDays: integer.positive().nullable().optional(),
  allowsWaitlist: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
  active: z.boolean().optional(),
  branchIds: z.array(z.string().uuid()).max(100)
    .refine((ids) => new Set(ids).size === ids.length).optional(),
}).strict();

export const createBranchSchema = branch;
export const updateBranchSchema = branch.partial().refine((data) => Object.keys(data).length > 0);
export const createServiceSchema = service;
export const updateServiceSchema = service.partial().refine((data) => Object.keys(data).length > 0);
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export function parseCatalogRead(body: unknown, query: unknown): void {
  parseCatalogInput(z.object({}).strict(), body ?? {}, query);
}

export function parseCatalogInput<T>(schema: z.ZodType<T>, body: unknown, query: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success || !z.object({}).strict().safeParse(query).success) {
    throw new BadRequestException('Invalid catalog request');
  }
  return result.data;
}

export function catalogContext(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization ||
      request.principal.userId !== request.authorization.userId) {
    throw new UnauthorizedException('Unauthorized');
  }
  if (!request.authorization.institutionId) {
    throw new BadRequestException('Institutional context required');
  }
  return request.authorization;
}
