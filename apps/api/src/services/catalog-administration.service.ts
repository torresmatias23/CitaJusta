import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CreateBranchInput, UpdateBranchInput, CreateServiceInput, UpdateServiceInput } from './catalog-administration.schemas.js';

export const CATALOG_PERMISSIONS = {
  createBranch: 'branches.create',
  updateBranch: 'branches.update',
  createService: 'services.create',
  updateService: 'services.update',
} as const;

const branchSelect = {
  id: true, code: true, name: true, addressLine1: true, addressLine2: true,
  municipality: true, region: true, country: true, latitude: true, longitude: true,
  phone: true, email: true, status: true,
} satisfies Prisma.BranchSelect;
const serviceSelect = {
  id: true, code: true, name: true, description: true, categoryId: true,
  durationMinutes: true, minimumAdvanceMinutes: true, maximumAdvanceDays: true,
  allowsWaitlist: true, requiresConfirmation: true, active: true,
  branchAssignments: {
    where: { active: true }, orderBy: { branchId: 'asc' }, select: { branchId: true },
  },
} satisfies Prisma.ServiceSelect;

@Injectable()
export class CatalogAdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  createBranch(input: CreateBranchInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institutionId = await this.authorize(tx, context, CATALOG_PERMISSIONS.createBranch);
      const branch = await tx.branch.create({
        data: { ...input, id: randomUUID(), institutionId }, select: branchSelect,
      });
      return { data: this.branchDto(branch) };
    });
  }

  updateBranch(id: string, input: UpdateBranchInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institutionId = await this.authorize(tx, context, CATALOG_PERMISSIONS.updateBranch, id);
      if (!await tx.branch.findFirst({ where: { id, institutionId, deletedAt: null }, select: { id: true } })) {
        throw new NotFoundException('Branch not found');
      }
      const branch = await tx.branch.update({
        where: { id, institutionId, deletedAt: null }, data: input, select: branchSelect,
      });
      return { data: this.branchDto(branch) };
    });
  }

  createService(input: CreateServiceInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institutionId = await this.authorize(tx, context, CATALOG_PERMISSIONS.createService);
      await this.validateServiceRelations(tx, institutionId, input);
      this.validateAdvance(input.minimumAdvanceMinutes ?? 0, input.maximumAdvanceDays ?? null);
      const { branchIds, ...fields } = input;
      const service = await tx.service.create({
        data: {
          ...fields, id: randomUUID(), institutionId,
          branchAssignments: { create: (branchIds ?? []).map((branchId) => ({ branchId })) },
        }, select: serviceSelect,
      });
      return { data: this.serviceDto(service) };
    });
  }

  updateService(id: string, input: UpdateServiceInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institutionId = await this.authorize(tx, context, CATALOG_PERMISSIONS.updateService);
      const existing = await tx.service.findFirst({
        where: { id, institutionId, deletedAt: null },
        select: { minimumAdvanceMinutes: true, maximumAdvanceDays: true },
      });
      if (!existing) throw new NotFoundException('Service not found');
      await this.validateServiceRelations(tx, institutionId, input);
      this.validateAdvance(input.minimumAdvanceMinutes ?? existing.minimumAdvanceMinutes,
        input.maximumAdvanceDays === undefined ? existing.maximumAdvanceDays : input.maximumAdvanceDays);
      const { branchIds, ...fields } = input;
      await tx.service.update({ where: { id, institutionId, deletedAt: null }, data: fields, select: { id: true } });
      if (branchIds !== undefined) {
        // Keep assignment records and their dependent history; only toggle availability.
        await tx.serviceBranch.updateMany({ where: { serviceId: id, branchId: { notIn: branchIds } }, data: { active: false } });
        for (const branchId of branchIds) {
          await tx.serviceBranch.upsert({
            where: { serviceId_branchId: { serviceId: id, branchId } },
            create: { serviceId: id, branchId }, update: { active: true },
          });
        }
      }
      const service = await tx.service.findUniqueOrThrow({ where: { id }, select: serviceSelect });
      return { data: this.serviceDto(service) };
    });
  }

  private async authorize(tx: Prisma.TransactionClient, context: AuthorizationContext, permission: string, branchId?: string) {
    const institutionId = context.institutionId;
    if (!institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId && context.branchId !== branchId) {
      if (branchId) throw new NotFoundException('Branch not found');
      throw new ForbiddenException('Institution-wide authorization required');
    }
    const now = new Date();
    // Revalidate the same RBAC grants inside the write transaction, not role names.
    const grant = await tx.userRole.count({
      where: {
        userId: context.userId, active: true,
        user: { status: 'ACTIVE', deletedAt: null },
        role: { active: true, permissions: { some: { permission: { code: permission } } } },
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          { OR: [
            { role: { scope: 'GLOBAL' } },
            { role: { scope: 'INSTITUTION' }, institutionId },
            ...(branchId && context.branchId === branchId ? [{
              role: { scope: 'BRANCH' as const }, branchId,
              OR: [{ institutionId: null }, { institutionId }],
            }] : []),
          ] },
        ],
      },
    });
    if (!grant) throw new ForbiddenException('Forbidden');
    if (!await tx.institution.findFirst({ where: { id: institutionId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
      throw new NotFoundException('Institution not found');
    }
    return institutionId;
  }

  private async validateServiceRelations(tx: Prisma.TransactionClient, institutionId: string, input: UpdateServiceInput) {
    if (input.categoryId && !await tx.serviceCategory.findFirst({
      where: { id: input.categoryId, institutionId, active: true }, select: { id: true },
    })) throw new NotFoundException('Service category not found');
    if (input.branchIds !== undefined) {
      const count = await tx.branch.count({
        where: { id: { in: input.branchIds }, institutionId, deletedAt: null, status: 'ACTIVE' },
      });
      if (count !== input.branchIds.length) throw new NotFoundException('Branch not found');
    }
  }

  private validateAdvance(minimumMinutes: number, maximumDays: number | null) {
    if (maximumDays !== null && minimumMinutes > maximumDays * 1440) {
      throw new BadRequestException('Invalid service advance window');
    }
  }

  private branchDto(branch: Prisma.BranchGetPayload<{ select: typeof branchSelect }>) {
    return { ...branch, latitude: branch.latitude?.toString() ?? null, longitude: branch.longitude?.toString() ?? null };
  }

  private serviceDto(service: Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>) {
    const { branchAssignments, ...fields } = service;
    return { ...fields, branchIds: branchAssignments.map((assignment) => assignment.branchId) };
  }

  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isTransactionConflict(error)) {
          if (attempt === 0) continue;
          throw new ConflictException('Concurrent catalog update; retry request');
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Catalog code already exists in this institution');
        }
        throw error;
      }
    }
  }
}
