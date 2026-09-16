import { AuditService } from '../audit/audit.service.js';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PolicyInput } from './reassignment-policy.schemas.js';

const policySelect = { id: true, version: true, rankingStrategy: true, offerTtlMinutes: true, createdByUserId: true, createdAt: true } as const;
type Policy = Prisma.ReassignmentPolicyGetPayload<{ select: typeof policySelect }>;
const dto = (policy: Policy) => ({ source: 'CONFIGURED' as const, ...policy, createdAt: policy.createdAt.toISOString() });
export function isPolicyVersionConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const constraintName = 'politicas_reasignacion_institucion_id_version_key';
  if (target === constraintName) return true;
  if (error.meta?.modelName !== 'ReassignmentPolicy') return false;
  if (Array.isArray(target) && target.length === 2 && target.includes('institucion_id') && target.includes('version')) return true;
  const adapter = error.meta.driverAdapterError;
  if (typeof adapter !== 'object' || adapter === null || !('cause' in adapter)) return false;
  const cause = adapter.cause;
  if (typeof cause !== 'object' || cause === null || !('originalCode' in cause) || cause.originalCode !== '23505' ||
      !('kind' in cause) || cause.kind !== 'UniqueConstraintViolation' || !('table' in cause) || cause.table !== 'politicas_reasignacion' ||
      !('constraint' in cause)) return false;
  const constraint = cause.constraint;
  return typeof constraint === 'object' && constraint !== null && 'index' in constraint && constraint.index === constraintName;
}

@Injectable()
export class ReassignmentPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async get(context: AuthorizationContext) {
    await this.authorize(this.prisma, context, 'reassignments.policy.read');
    const institution = await this.current(this.prisma, context.institutionId!);
    return { data: institution.currentReassignmentPolicy ? dto(institution.currentReassignmentPolicy) : {
      source: 'DEFAULT' as const, id: null, version: null, rankingStrategy: 'PRIORITY_THEN_WAITING' as const,
      offerTtlMinutes: this.config.getOrThrow<number>('WAITLIST_OFFER_TTL_MINUTES'),
    } };
  }

  async configure(input: PolicyInput, context: AuthorizationContext) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.authorize(tx, context, 'reassignments.policy.update');
          const institutionId = context.institutionId!;
          const institution = await this.current(tx, institutionId);
          const previous = institution.currentReassignmentPolicy;
          if (previous && previous.rankingStrategy === input.rankingStrategy && previous.offerTtlMinutes === input.offerTtlMinutes) {
            return { created: false, data: dto(previous) };
          }
          const policy = await tx.reassignmentPolicy.create({ data: { id: randomUUID(), institutionId,
            version: (previous?.version ?? 0) + 1, ...input, createdByUserId: context.userId }, select: policySelect });
          const updated = await tx.institution.updateMany({ where: { id: institutionId, currentReassignmentPolicyId: previous?.id ?? null },
            data: { currentReassignmentPolicyId: policy.id } });
          if (updated.count !== 1) throw new ConflictException('Policy changed; retry request');
          await AuditService.record(tx, { institutionId, actorUserId: context.userId, actorType: 'USER',
            actionCode: 'REASSIGNMENT_POLICY_VERSION_CREATED', resourceType: 'REASSIGNMENT_POLICY', resourceId: policy.id, outcome: 'SUCCESS' });
          return { created: true, data: dto(policy) };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!isTransactionConflict(error) && !isPolicyVersionConflict(error)) throw error;
        if (attempt === 0) continue;
        throw new ConflictException('Concurrent policy change; retry request');
      }
    }
  }

  private async current(db: Pick<Prisma.TransactionClient, 'institution'>, institutionId: string) {
    const institution = await db.institution.findFirst({ where: { id: institutionId, status: 'ACTIVE', deletedAt: null },
      select: { currentReassignmentPolicy: { select: policySelect } } });
    if (!institution) throw new NotFoundException('Institution not found');
    return institution;
  }

  private async authorize(db: Pick<Prisma.TransactionClient, 'user' | 'userRole'>, context: AuthorizationContext, permission: string) {
    if (!context.institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId) throw new ForbiddenException('Institutional scope required');
    if (!await db.user.findFirst({ where: { id: context.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) throw new UnauthorizedException('Unauthorized');
    const now = new Date();
    const grant = await db.userRole.count({ where: {
      userId: context.userId, active: true,
      role: { active: true, permissions: { some: { permission: { code: permission } } } },
      AND: [ { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        { OR: [{ role: { scope: 'GLOBAL' } }, { role: { scope: 'INSTITUTION' }, institutionId: context.institutionId }] } ],
    } });
    if (!grant) throw new ForbiddenException('Forbidden');
  }
}
