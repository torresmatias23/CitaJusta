import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { RoleScope } from '../generated/prisma/client.js';
import type {
  AuthorizationContext,
  InstitutionContext,
} from './types/authorization-context.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForUser(
    userId: string,
    context: InstitutionContext,
  ): Promise<AuthorizationContext> {
    const branchInstitutionId = await this.validateInstitutionContext(context);
    const now = new Date();
    const assignments = await this.prisma.userRole.findMany({
      where: {
        userId,
        active: true,
        role: { active: true },
        AND: [
          {
            OR: [{ validFrom: null }, { validFrom: { lte: now } }],
          },
          {
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
        ],
      },
      select: {
        active: true,
        validFrom: true,
        validTo: true,
        institutionId: true,
        branchId: true,
        role: {
          select: {
            code: true,
            scope: true,
            active: true,
            permissions: {
              select: {
                permission: {
                  select: { code: true },
                },
              },
            },
          },
        },
      },
    });
    const roleCodes = new Set<string>();
    const permissions = new Set<string>();

    for (const assignment of assignments) {
      if (
        !this.isCurrentlyActive(assignment, now) ||
        !this.appliesToContext(assignment, context, branchInstitutionId)
      ) {
        continue;
      }

      roleCodes.add(assignment.role.code);

      for (const rolePermission of assignment.role.permissions) {
        permissions.add(rolePermission.permission.code);
      }
    }

    return {
      userId,
      ...context,
      roleCodes: [...roleCodes].sort(),
      permissions: [...permissions].sort(),
    };
  }

  private async validateInstitutionContext(
    context: InstitutionContext,
  ): Promise<string | undefined> {
    if (context.institutionId) {
      const institution = await this.prisma.institution.findUnique({
        where: { id: context.institutionId },
        select: { id: true },
      });

      if (!institution) {
        throw this.invalidContext();
      }
    }

    if (!context.branchId) {
      return undefined;
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: context.branchId },
      select: { institutionId: true },
    });

    if (
      !branch ||
      (context.institutionId &&
        branch.institutionId !== context.institutionId)
    ) {
      throw this.invalidContext();
    }

    return branch.institutionId;
  }

  private isCurrentlyActive(
    assignment: {
      active: boolean;
      validFrom: Date | null;
      validTo: Date | null;
      role: { active: boolean };
    },
    now: Date,
  ): boolean {
    return (
      assignment.active &&
      assignment.role.active &&
      (assignment.validFrom === null || assignment.validFrom <= now) &&
      (assignment.validTo === null || assignment.validTo >= now)
    );
  }

  private appliesToContext(
    assignment: {
      institutionId: string | null;
      branchId: string | null;
      role: { scope: RoleScope };
    },
    context: InstitutionContext,
    branchInstitutionId: string | undefined,
  ): boolean {
    switch (assignment.role.scope) {
      case RoleScope.GLOBAL:
        return true;
      case RoleScope.INSTITUTION:
        return (
          context.institutionId !== undefined &&
          assignment.institutionId === context.institutionId
        );
      case RoleScope.BRANCH:
        return (
          context.branchId !== undefined &&
          assignment.branchId === context.branchId &&
          (assignment.institutionId === null ||
            assignment.institutionId === branchInstitutionId)
        );
    }
  }

  private invalidContext(): BadRequestException {
    return new BadRequestException('Invalid institutional context');
  }
}
