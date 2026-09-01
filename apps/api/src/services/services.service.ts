import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  BranchStatus,
  InstitutionStatus,
} from '../generated/prisma/client.js';

const serviceSummarySelect = {
  id: true,
  institutionId: true,
  code: true,
  name: true,
  description: true,
  durationMinutes: true,
  active: true,
  deletedAt: true,
  institution: {
    select: {
      id: true,
      name: true,
      status: true,
      deletedAt: true,
    },
  },
  category: {
    select: {
      id: true,
      institutionId: true,
      name: true,
      active: true,
    },
  },
} as const;

interface ServiceSummaryRecord {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  active: boolean;
  deletedAt: Date | null;
  institution: {
    id: string;
    name: string;
    status: InstitutionStatus;
    deletedAt: Date | null;
  };
  category: {
    id: string;
    institutionId: string;
    name: string;
    active: boolean;
  } | null;
}

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const services = await this.prisma.service.findMany({
      where: {
        active: true,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: serviceSummarySelect,
    });

    return {
      data: services
        .filter((service) => this.isAvailableService(service))
        .map((service) => this.mapServiceSummary(service)),
    };
  }

  async findByBranch(branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        status: BranchStatus.ACTIVE,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        institutionId: true,
        status: true,
        deletedAt: true,
        institution: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!branch || !this.isAvailableBranch(branch)) {
      throw new NotFoundException('Branch not found');
    }

    const services = await this.prisma.service.findMany({
      where: {
        institutionId: branch.institutionId,
        active: true,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
        branchAssignments: {
          some: {
            branchId,
            active: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        ...serviceSummarySelect,
        branchAssignments: {
          where: {
            branchId,
            active: true,
          },
          select: {
            branchId: true,
            active: true,
          },
        },
      },
    });

    return {
      data: services
        .filter(
          (service) =>
            service.institutionId === branch.institutionId &&
            this.isAvailableService(service) &&
            service.branchAssignments.some(
              (assignment) =>
                assignment.branchId === branchId && assignment.active,
            ),
        )
        .map((service) => this.mapServiceSummary(service)),
    };
  }

  async findById(serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        active: true,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
      },
      select: {
        ...serviceSummarySelect,
        minimumAdvanceMinutes: true,
        maximumAdvanceDays: true,
        allowsWaitlist: true,
        requiresConfirmation: true,
        requirements: {
          where: { active: true },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            required: true,
            order: true,
            active: true,
          },
        },
      },
    });

    if (!service || !this.isAvailableService(service)) {
      throw new NotFoundException('Service not found');
    }

    const branches = await this.prisma.branch.findMany({
      where: {
        institutionId: service.institutionId,
        status: BranchStatus.ACTIVE,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
        serviceAssignments: {
          some: {
            serviceId,
            active: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        institutionId: true,
        code: true,
        name: true,
        municipality: true,
        region: true,
        status: true,
        deletedAt: true,
        institution: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
        serviceAssignments: {
          where: {
            serviceId,
            active: true,
          },
          select: {
            serviceId: true,
            active: true,
          },
        },
      },
    });

    return {
      data: {
        ...this.mapServiceSummary(service),
        minimumAdvanceMinutes: service.minimumAdvanceMinutes,
        maximumAdvanceDays: service.maximumAdvanceDays,
        allowsWaitlist: service.allowsWaitlist,
        requiresConfirmation: service.requiresConfirmation,
        requirements: service.requirements
          .filter((requirement) => requirement.active)
          .map((requirement) => ({
            id: requirement.id,
            name: requirement.name,
            description: requirement.description,
            required: requirement.required,
            order: requirement.order,
          })),
        branches: branches
          .filter(
            (branch) =>
              branch.institutionId === service.institutionId &&
              this.isAvailableBranch(branch) &&
              branch.serviceAssignments.some(
                (assignment) =>
                  assignment.serviceId === serviceId && assignment.active,
              ),
          )
          .map((branch) => ({
            id: branch.id,
            code: branch.code,
            name: branch.name,
            municipality: branch.municipality,
            region: branch.region,
          })),
      },
    };
  }

  private isAvailableService(service: ServiceSummaryRecord): boolean {
    return (
      service.active &&
      service.deletedAt === null &&
      service.institutionId === service.institution.id &&
      service.institution.status === InstitutionStatus.ACTIVE &&
      service.institution.deletedAt === null
    );
  }

  private isAvailableBranch(branch: {
    status: BranchStatus;
    deletedAt: Date | null;
    institution: {
      status: InstitutionStatus;
      deletedAt: Date | null;
    };
  }): boolean {
    return (
      branch.status === BranchStatus.ACTIVE &&
      branch.deletedAt === null &&
      branch.institution.status === InstitutionStatus.ACTIVE &&
      branch.institution.deletedAt === null
    );
  }

  private mapServiceSummary(service: ServiceSummaryRecord) {
    return {
      id: service.id,
      code: service.code,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      institution: {
        id: service.institution.id,
        name: service.institution.name,
      },
      category:
        service.category?.active === true &&
        service.category.institutionId === service.institutionId
          ? {
              id: service.category.id,
              name: service.category.name,
            }
          : null,
    };
  }
}
