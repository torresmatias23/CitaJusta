import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  BranchStatus,
  InstitutionStatus,
} from '../generated/prisma/client.js';

@Injectable()
export class InstitutionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const institutions = await this.prisma.institution.findMany({
      where: {
        status: InstitutionStatus.ACTIVE,
        deletedAt: null,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        timeZone: true,
        status: true,
        deletedAt: true,
      },
    });

    return {
      data: institutions
        .filter(
          (institution) =>
            institution.status === InstitutionStatus.ACTIVE &&
            institution.deletedAt === null,
        )
        .map((institution) => ({
          id: institution.id,
          name: institution.name,
          timeZone: institution.timeZone,
        })),
    };
  }

  async findById(institutionId: string) {
    const institution = await this.prisma.institution.findFirst({
      where: {
        id: institutionId,
        status: InstitutionStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        contactEmail: true,
        phone: true,
        timeZone: true,
        status: true,
        deletedAt: true,
      },
    });

    if (
      !institution ||
      institution.status !== InstitutionStatus.ACTIVE ||
      institution.deletedAt !== null
    ) {
      throw new NotFoundException('Institution not found');
    }

    return {
      data: {
        id: institution.id,
        name: institution.name,
        legalName: institution.legalName,
        contactEmail: institution.contactEmail,
        phone: institution.phone,
        timeZone: institution.timeZone,
      },
    };
  }

  async findBranches(institutionId: string) {
    const institution = await this.prisma.institution.findFirst({
      where: {
        id: institutionId,
        status: InstitutionStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        status: true,
        deletedAt: true,
        branches: {
          where: {
            status: BranchStatus.ACTIVE,
            deletedAt: null,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            institutionId: true,
            code: true,
            name: true,
            addressLine1: true,
            addressLine2: true,
            municipality: true,
            region: true,
            country: true,
            phone: true,
            email: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !institution ||
      institution.status !== InstitutionStatus.ACTIVE ||
      institution.deletedAt !== null
    ) {
      throw new NotFoundException('Institution not found');
    }

    return {
      data: institution.branches
        .filter(
          (branch) =>
            branch.institutionId === institutionId &&
            branch.status === BranchStatus.ACTIVE &&
            branch.deletedAt === null,
        )
        .map((branch) => ({
          id: branch.id,
          institutionId: branch.institutionId,
          code: branch.code,
          name: branch.name,
          addressLine1: branch.addressLine1,
          addressLine2: branch.addressLine2,
          municipality: branch.municipality,
          region: branch.region,
          country: branch.country,
          phone: branch.phone,
          email: branch.email,
        })),
    };
  }
}
