import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';

const bodySchema = z.object({ status: z.enum(['ATENDIDA', 'INASISTENCIA']) }).strict();
export type AttendanceStatus = z.infer<typeof bodySchema>['status'];

export function parseAttendance(params: unknown, body: unknown, query: unknown) {
  const path = z.object({ appointmentId: z.string().uuid() }).strict().safeParse(params);
  const input = bodySchema.safeParse(body);
  if (!path.success || !input.success || !z.object({}).strict().safeParse(query).success) {
    throw new BadRequestException('Invalid attendance request');
  }
  return { ...path.data, ...input.data };
}

export function attendanceContext(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) {
    throw new UnauthorizedException('Unauthorized');
  }
  if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
  return request.authorization;
}
