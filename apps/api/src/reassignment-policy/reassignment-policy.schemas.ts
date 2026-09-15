import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';

export const policySchema = z.object({
  rankingStrategy: z.enum(['PRIORITY_THEN_WAITING', 'WAITING_THEN_PRIORITY']),
  offerTtlMinutes: z.number().int().min(1).max(60),
}).strict();
export type PolicyInput = z.infer<typeof policySchema>;
export function parsePolicy(body: unknown, query: unknown) {
  const result = policySchema.safeParse(body);
  if (!result.success || !z.object({}).strict().safeParse(query).success) throw new BadRequestException('Invalid reassignment policy');
  return result.data;
}
export function policyReadInput(body: unknown, query: unknown) {
  if (!z.object({}).strict().safeParse(query).success ||
      (body !== undefined && !z.object({}).strict().safeParse(body).success)) throw new BadRequestException('Invalid reassignment policy request');
}
export function policyContext(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) throw new UnauthorizedException('Unauthorized');
  if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
  if (request.authorization.branchId) throw new ForbiddenException('Institutional scope required');
  return request.authorization;
}
