import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CreateProfessionalInput, UpdateProfessionalInput } from './schemas/professional-administration.schemas.js';

export const PROFESSIONAL_PERMISSIONS = { create: 'professionals.create', update: 'professionals.update' } as const;
const professionalSelect = (institutionId: string) => ({
  id: true, userId: true, internalCode: true, titleOrFunction: true, description: true,
  status: true, createdAt: true, updatedAt: true,
  branchAssignments: {
    where: { active: true, branch: { institutionId } },
    orderBy: { branchId: 'asc' }, select: { branchId: true },
  },
  serviceAssignments: {
    where: { active: true, service: { institutionId } },
    orderBy: { serviceId: 'asc' }, select: { serviceId: true },
  },
} as const satisfies Prisma.ProfessionalSelect);

@Injectable()
export class ProfessionalAdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateProfessionalInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institutionId = await this.authorize(tx, context, PROFESSIONAL_PERMISSIONS.create);
      // Users are global identities; registration here grants no role or account access.
      if (!await tx.user.findFirst({ where: { id: input.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
        throw new NotFoundException('User not available');
      }
      await this.validateRelations(tx, institutionId, input);
      const { branchIds, serviceIds, ...fields } = input;
      const professional = await tx.professional.create({
        data: {
          ...fields, id: randomUUID(), institutionId,
          branchAssignments: { create: branchIds.map((branchId) => ({ branchId })) },
          serviceAssignments: { create: serviceIds.map((serviceId) => ({ serviceId })) },
        }, select: professionalSelect(institutionId),
      });
      return { data: this.dto(professional) };
    });
  }

  update(id: string, input: UpdateProfessionalInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institutionId = await this.authorize(tx, context, PROFESSIONAL_PERMISSIONS.update);
      if (!await tx.professional.findFirst({ where: { id, institutionId, deletedAt: null }, select: { id: true } })) {
        throw new NotFoundException('Professional not found');
      }
      await this.validateRelations(tx, institutionId, input);
      const { branchIds, serviceIds, ...fields } = input;
      // Explicit timestamp also records an association-only edit on the parent.
      await tx.professional.update({ where: { id, institutionId, deletedAt: null }, data: { ...fields, updatedAt: new Date() }, select: { id: true } });
      if (branchIds !== undefined) {
        await tx.professionalBranch.updateMany({ where: { professionalId: id, branchId: { notIn: branchIds } }, data: { active: false } });
        for (const branchId of branchIds) {
          await tx.professionalBranch.upsert({
            where: { professionalId_branchId: { professionalId: id, branchId } },
            create: { professionalId: id, branchId }, update: { active: true },
          });
        }
      }
      if (serviceIds !== undefined) {
        await tx.professionalService.updateMany({ where: { professionalId: id, serviceId: { notIn: serviceIds } }, data: { active: false } });
        for (const serviceId of serviceIds) {
          await tx.professionalService.upsert({
            where: { professionalId_serviceId: { professionalId: id, serviceId } },
            create: { professionalId: id, serviceId }, update: { active: true },
          });
        }
      }
      return { data: this.dto(await tx.professional.findUniqueOrThrow({ where: { id }, select: professionalSelect(institutionId) })) };
    });
  }

  private async authorize(tx: Prisma.TransactionClient, context: AuthorizationContext, permission: string) {
    const institutionId = context.institutionId;
    if (!institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId) throw new ForbiddenException('Institution-wide authorization required');
    const now = new Date();
    const grant = await tx.userRole.count({ where: {
      userId: context.userId, active: true, user: { status: 'ACTIVE', deletedAt: null },
      role: { active: true, permissions: { some: { permission: { code: permission } } } },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        { OR: [{ role: { scope: 'GLOBAL' } }, { role: { scope: 'INSTITUTION' }, institutionId }] },
      ],
    } });
    if (!grant) throw new ForbiddenException('Forbidden');
    if (!await tx.institution.findFirst({ where: { id: institutionId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
      throw new NotFoundException('Institution not found');
    }
    return institutionId;
  }

  private async validateRelations(tx: Prisma.TransactionClient, institutionId: string, input: UpdateProfessionalInput) {
    if (input.branchIds !== undefined && await tx.branch.count({ where: {
      id: { in: input.branchIds }, institutionId, status: 'ACTIVE', deletedAt: null,
    } }) !== input.branchIds.length) throw new NotFoundException('Branch not found');
    if (input.serviceIds !== undefined && await tx.service.count({ where: {
      id: { in: input.serviceIds }, institutionId, active: true, deletedAt: null,
    } }) !== input.serviceIds.length) throw new NotFoundException('Service not found');
  }

  private dto(row: Prisma.ProfessionalGetPayload<{ select: ReturnType<typeof professionalSelect> }>) {
    const { branchAssignments, serviceAssignments, createdAt, updatedAt, ...fields } = row;
    return { ...fields, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(),
      branchIds: branchAssignments.map((item) => item.branchId), serviceIds: serviceAssignments.map((item) => item.serviceId) };
  }

  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isTransactionConflict(error)) {
          if (attempt === 0) continue;
          throw new ConflictException('Concurrent professional update; retry request');
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Professional or assignment already exists in this institution');
        }
        throw error;
      }
    }
  }
}
