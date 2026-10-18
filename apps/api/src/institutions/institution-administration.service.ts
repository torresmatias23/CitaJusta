import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CreateInstitutionInput, UpdateInstitutionInput } from './institution-administration.schemas.js';

export const institutionPermissions = ['institutions.read', 'institutions.create', 'institutions.update'] as const;
const select = { id: true, name: true, legalName: true, taxIdentifier: true, contactEmail: true, phone: true,
  timeZone: true, status: true, createdAt: true, updatedAt: true } as const satisfies Prisma.InstitutionSelect;
type Institution = Prisma.InstitutionGetPayload<{ select: typeof select }>;
const dto = ({ createdAt, updatedAt, ...row }: Institution) => ({ ...row, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() });

@Injectable()
export class InstitutionAdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(tx: Prisma.TransactionClient, context: AuthorizationContext, permission: string) {
    // Never combine an institutional permission with an unrelated GLOBAL role.
    if (context.institutionId || context.branchId) throw new ForbiddenException('Unscoped global authorization required');
    if (!await tx.user.findFirst({ where: { id: context.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
      throw new UnauthorizedException('Unauthorized');
    }
    const now = new Date();
    const grants = await tx.userRole.findMany({ where: {
      userId: context.userId, active: true, institutionId: null, branchId: null,
      role: { scope: 'GLOBAL', active: true },
      AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] }],
    }, select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } });
    const permissions = new Set(grants.flatMap(grant => grant.role.permissions.map(link => link.permission.code)));
    if (!permissions.has(permission)) throw new ForbiddenException('Forbidden');
    return permissions;
  }

  list(context: AuthorizationContext) {
    return this.transaction(async tx => {
      const permissions = await this.authorize(tx, context, 'institutions.read');
      const rows = await tx.institution.findMany({ where: { deletedAt: null }, select, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      return { data: rows.map(dto), permissions: { create: permissions.has('institutions.create'), update: permissions.has('institutions.update') } };
    }, false);
  }

  create(input: CreateInstitutionInput, context: AuthorizationContext) {
    return this.transaction(async tx => {
      await this.authorize(tx, context, 'institutions.create');
      const institution = await tx.institution.create({ data: { ...input, id: randomUUID(), status: 'ACTIVE' }, select });
      await AuditService.record(tx, { institutionId: institution.id, actorUserId: context.userId, actorType: 'USER',
        actionCode: 'INSTITUTION_CREATED', resourceType: 'INSTITUTION', resourceId: institution.id, outcome: 'SUCCESS' });
      return { data: dto(institution) };
    });
  }

  update(id: string, input: UpdateInstitutionInput, context: AuthorizationContext) {
    return this.transaction(async tx => {
      await this.authorize(tx, context, 'institutions.update');
      if (!await tx.institution.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Institution not found');
      const institution = await tx.institution.update({ where: { id, deletedAt: null }, data: input, select });
      await AuditService.record(tx, { institutionId: id, actorUserId: context.userId, actorType: 'USER',
        actionCode: 'INSTITUTION_UPDATED', resourceType: 'INSTITUTION', resourceId: id, outcome: 'SUCCESS' });
      return { data: dto(institution) };
    });
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, write = true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(work, { isolationLevel: write ? 'Serializable' : 'RepeatableRead' }); }
      catch (error) {
        if (error instanceof HttpException) throw error;
        if (isTransactionConflict(error)) {
          if (attempt === 0) continue;
          throw new ConflictException('Concurrent institution change; retry request');
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && error.meta?.modelName === 'Institution') {
          throw new ConflictException('Institution identifier already exists');
        }
        throw new InternalServerErrorException('Institution operation unavailable');
      }
    }
  }
}
