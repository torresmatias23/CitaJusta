import { ConflictException, HttpException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { currentPrivacyNotice } from './privacy-notices.js';

const actionCode = 'PRIVACY_NOTICE_ACKNOWLEDGED';
const resourceType = 'PRIVACY_NOTICE';
const select = { occurredAt: true } as const;
function where(userId: string): Prisma.AuditEventWhereInput {
  return { actorUserId: userId, actorType: 'USER', actionCode, resourceType,
    resourceId: currentPrivacyNotice.id, outcome: 'SUCCESS', institutionId: null, branchId: null };
}

@Injectable()
export class PrivacyNoticeService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(principal: AuthenticatedPrincipal) {
    const record = await this.prisma.auditEvent.findFirst({ where: where(principal.userId), select,
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
    return { data: { notice: currentPrivacyNotice, acknowledgedAt: record?.occurredAt.toISOString() ?? null } };
  }

  async acknowledge(versionId: string, principal: AuthenticatedPrincipal) {
    if (versionId !== currentPrivacyNotice.id) throw new ConflictException('Privacy notice version changed; reload it');
    try {
      return await this.prisma.$transaction(async tx => {
        // Serialize acknowledgements for the same identity WITHOUT updating User.
        // ReadCommitted reads a fresh snapshot after a concurrent lock is released.
        const users = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM usuarios WHERE id = ${principal.userId}::uuid FOR UPDATE
        `);
        if (users.length !== 1 || !await tx.user.findFirst({ where: { id: principal.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
          throw new UnauthorizedException('Unauthorized');
        }
        let record = await tx.auditEvent.findFirst({ where: where(principal.userId), select,
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
        if (!record) {
          await AuditService.record(tx, { actorUserId: principal.userId, actorType: 'USER', actionCode,
            resourceType, resourceId: versionId, outcome: 'SUCCESS' });
          record = await tx.auditEvent.findFirst({ where: where(principal.userId), select,
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
        }
        if (!record) throw new InternalServerErrorException('Privacy notice acknowledgement unavailable');
        return { data: { versionId, acknowledgedAt: record.occurredAt.toISOString() } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Privacy notice acknowledgement unavailable');
    }
  }
}
