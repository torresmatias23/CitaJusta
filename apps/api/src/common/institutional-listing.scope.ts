import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export async function institutionalListingScope(
  prisma: PrismaService, context: AuthorizationContext, permission: string, requestedBranch?: string,
) {
  if (!context.permissions.includes(permission)) throw new ForbiddenException('Forbidden');
  if (!context.institutionId) throw new BadRequestException('Institutional context required');
  const institutionId = context.institutionId;
  if (context.branchId && requestedBranch && context.branchId.toLowerCase() !== requestedBranch.toLowerCase()) {
    throw new NotFoundException('Resource not found');
  }
  const branchId = context.branchId ?? requestedBranch;
  if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, institutionId }, select: { id: true } })) {
    throw new NotFoundException('Resource not found');
  }
  return { institutionId, branchId };
}

// A preference for another branch is not an administrative ownership grant.
export function institutionalWaitlistWhere(institutionId: string, branchId?: string): Prisma.WaitlistEntryWhereInput {
  return {
    institutionId, deletedAt: null, service: { institutionId }, priority: { institutionId },
    user: { deletedAt: null },
    ...(branchId ? { branchId, branch: { institutionId } }
      : { OR: [{ branchId: null }, { branch: { institutionId } }] }),
  };
}
