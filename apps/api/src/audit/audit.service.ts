import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { institutionalDay } from '../agenda/agenda.schemas.js';
import { auditRecordSchema, decodeCursor, encodeCursor, type AuditRecord, type AuditQuery } from './audit.schemas.js';

const select = { id: true, institutionId: true, branchId: true, actorUserId: true, actorType: true,
  actionCode: true, resourceType: true, resourceId: true, outcome: true, previousState: true, newState: true,
  reasonCode: true, occurredAt: true } as const satisfies Prisma.AuditEventSelect;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Explicit client keeps the audit insert in the caller's transaction without DI cycles.
  static async record(client: Pick<Prisma.TransactionClient, 'auditEvent'>, input: AuditRecord): Promise<void> {
    const data = auditRecordSchema.parse(input);
    await client.auditEvent.create({ data: { id: randomUUID(), ...data }, select: { id: true } });
  }

  async find(query: AuditQuery, context: AuthorizationContext) {
    if (context.branchId && !context.institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId && query.branchId && context.branchId !== query.branchId) throw new NotFoundException('Resource not found');
    const branchId = context.branchId ?? query.branchId;
    if (branchId && !await this.prisma.branch.findFirst({ where: { id: branchId,
      ...(context.institutionId ? { institutionId: context.institutionId } : {}) }, select: { id: true } })) throw new NotFoundException('Resource not found');
    let timeZone = 'UTC';
    if (context.institutionId && (query.from || query.to)) {
      const institution = await this.prisma.institution.findUnique({ where: { id: context.institutionId }, select: { timeZone: true } });
      if (!institution) throw new NotFoundException('Resource not found');
      timeZone = institution.timeZone;
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    // Uncontextualized permissions are granted only by GLOBAL in AuthorizationService.
    // A selected institution/branch always narrows even a GLOBAL grant.
    const where: Prisma.AuditEventWhereInput = {
      ...(context.institutionId ? { institutionId: context.institutionId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { actionCode: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      occurredAt: { ...(query.from ? { gte: institutionalDay(query.from, timeZone).gte } : {}),
        ...(query.to ? { lt: institutionalDay(query.to, timeZone).lt } : {}) },
      ...(cursor ? { OR: [{ occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }] } : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({ where, select, take: query.limit + 1, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { data: page.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      page: { nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null } };
  }
}
