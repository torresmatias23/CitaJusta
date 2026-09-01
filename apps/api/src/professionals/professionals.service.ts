import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  BranchStatus,
  InstitutionStatus,
  ProfessionalStatus,
} from '../generated/prisma/client.js';

const professionalSummarySelect = {
  id: true,
  institutionId: true,
  titleOrFunction: true,
  description: true,
  status: true,
  deletedAt: true,
  institution: {
    select: {
      id: true,
      name: true,
      status: true,
      deletedAt: true,
    },
  },
  user: {
    select: {
      firstNames: true,
      lastNames: true,
    },
  },
} as const;

interface ProfessionalSummaryRecord {
  id: string;
  institutionId: string;
  titleOrFunction: string | null;
  description: string | null;
  status: ProfessionalStatus;
  deletedAt: Date | null;
  institution: {
    id: string;
    name: string;
    status: InstitutionStatus;
    deletedAt: Date | null;
  };
  user: {
    firstNames: string;
    lastNames: string;
  };
}

interface BranchAvailabilityRecord {
  id: string;
  institutionId: string;
  status: BranchStatus;
  deletedAt: Date | null;
  institution: {
    id: string;
    status: InstitutionStatus;
    deletedAt: Date | null;
  };
}

interface ServiceAvailabilityRecord {
  id: string;
  institutionId: string;
  active: boolean;
  deletedAt: Date | null;
  institution: {
    id: string;
    status: InstitutionStatus;
    deletedAt: Date | null;
  };
}

@Injectable()
export class ProfessionalsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const professionals = await this.prisma.professional.findMany({
      where: {
        status: ProfessionalStatus.ACTIVE,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
      },
      orderBy: [
        { user: { lastNames: 'asc' } },
        { user: { firstNames: 'asc' } },
        { id: 'asc' },
      ],
      select: professionalSummarySelect,
    });

    return {
      data: professionals
        .filter((professional) =>
          this.isAvailableProfessional(professional),
        )
        .map((professional) => this.mapProfessional(professional)),
    };
  }

  async findById(professionalId: string) {
    const professional = await this.prisma.professional.findFirst({
      where: {
        id: professionalId,
        status: ProfessionalStatus.ACTIVE,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
      },
      select: professionalSummarySelect,
    });

    if (!professional || !this.isAvailableProfessional(professional)) {
      throw new NotFoundException('Professional not found');
    }

    const [services, branches] = await Promise.all([
      this.prisma.service.findMany({
        where: {
          institutionId: professional.institutionId,
          active: true,
          deletedAt: null,
          institution: {
            status: InstitutionStatus.ACTIVE,
            deletedAt: null,
          },
          professionalAssignments: {
            some: {
              professionalId,
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
          description: true,
          durationMinutes: true,
          active: true,
          deletedAt: true,
          institution: {
            select: {
              id: true,
              status: true,
              deletedAt: true,
            },
          },
          professionalAssignments: {
            where: {
              professionalId,
              active: true,
            },
            select: {
              professionalId: true,
              customDurationMinutes: true,
              active: true,
            },
          },
        },
      }),
      this.prisma.branch.findMany({
        where: {
          institutionId: professional.institutionId,
          status: BranchStatus.ACTIVE,
          deletedAt: null,
          institution: {
            status: InstitutionStatus.ACTIVE,
            deletedAt: null,
          },
          professionalAssignments: {
            some: {
              professionalId,
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
              id: true,
              status: true,
              deletedAt: true,
            },
          },
          professionalAssignments: {
            where: {
              professionalId,
              active: true,
            },
            select: {
              professionalId: true,
              active: true,
            },
          },
        },
      }),
    ]);

    return {
      data: {
        ...this.mapProfessional(professional),
        services: services
          .filter(
            (service) =>
              service.institutionId === professional.institutionId &&
              this.isAvailableService(service) &&
              service.professionalAssignments.some(
                (assignment) =>
                  assignment.professionalId === professionalId &&
                  assignment.active,
              ),
          )
          .map((service) => {
            const assignment = service.professionalAssignments.find(
              (candidate) =>
                candidate.professionalId === professionalId &&
                candidate.active,
            );

            return {
              id: service.id,
              code: service.code,
              name: service.name,
              description: service.description,
              durationMinutes: service.durationMinutes,
              customDurationMinutes:
                assignment?.customDurationMinutes ?? null,
            };
          }),
        branches: branches
          .filter(
            (branch) =>
              branch.institutionId === professional.institutionId &&
              this.isAvailableBranch(branch) &&
              branch.professionalAssignments.some(
                (assignment) =>
                  assignment.professionalId === professionalId &&
                  assignment.active,
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

  async findByBranch(branchId: string) {
    const branch = await this.findAvailableBranch(branchId);
    const professionals = await this.prisma.professional.findMany({
      where: {
        institutionId: branch.institutionId,
        status: ProfessionalStatus.ACTIVE,
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
      orderBy: [
        { user: { lastNames: 'asc' } },
        { user: { firstNames: 'asc' } },
        { id: 'asc' },
      ],
      select: {
        ...professionalSummarySelect,
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
      data: professionals
        .filter(
          (professional) =>
            professional.institutionId === branch.institutionId &&
            this.isAvailableProfessional(professional) &&
            professional.branchAssignments.some(
              (assignment) =>
                assignment.branchId === branchId && assignment.active,
            ),
        )
        .map((professional) => this.mapProfessional(professional)),
    };
  }

  async findByService(serviceId: string) {
    const service = await this.findAvailableService(serviceId);
    const professionals = await this.prisma.professional.findMany({
      where: {
        institutionId: service.institutionId,
        status: ProfessionalStatus.ACTIVE,
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
      orderBy: [
        { user: { lastNames: 'asc' } },
        { user: { firstNames: 'asc' } },
        { id: 'asc' },
      ],
      select: {
        ...professionalSummarySelect,
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
      data: professionals
        .filter(
          (professional) =>
            professional.institutionId === service.institutionId &&
            this.isAvailableProfessional(professional) &&
            professional.serviceAssignments.some(
              (assignment) =>
                assignment.serviceId === serviceId && assignment.active,
            ),
        )
        .map((professional) => this.mapProfessional(professional)),
    };
  }

  async findByBranchAndService(branchId: string, serviceId: string) {
    const availability = await this.prisma.serviceBranch.findFirst({
      where: {
        branchId,
        serviceId,
        active: true,
        branch: {
          status: BranchStatus.ACTIVE,
          deletedAt: null,
          institution: {
            status: InstitutionStatus.ACTIVE,
            deletedAt: null,
          },
        },
        service: {
          active: true,
          deletedAt: null,
          institution: {
            status: InstitutionStatus.ACTIVE,
            deletedAt: null,
          },
        },
      },
      select: {
        active: true,
        branch: {
          select: {
            id: true,
            institutionId: true,
            status: true,
            deletedAt: true,
            institution: {
              select: {
                id: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
        service: {
          select: {
            id: true,
            institutionId: true,
            active: true,
            deletedAt: true,
            institution: {
              select: {
                id: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (
      !availability ||
      !availability.active ||
      availability.branch.id !== branchId ||
      availability.service.id !== serviceId ||
      availability.branch.institutionId !==
        availability.service.institutionId ||
      !this.isAvailableBranch(availability.branch) ||
      !this.isAvailableService(availability.service)
    ) {
      throw new NotFoundException('Service not available at branch');
    }

    const institutionId = availability.branch.institutionId;
    const professionals = await this.prisma.professional.findMany({
      where: {
        institutionId,
        status: ProfessionalStatus.ACTIVE,
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
        serviceAssignments: {
          some: {
            serviceId,
            active: true,
          },
        },
      },
      orderBy: [
        { user: { lastNames: 'asc' } },
        { user: { firstNames: 'asc' } },
        { id: 'asc' },
      ],
      select: {
        ...professionalSummarySelect,
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
      data: professionals
        .filter(
          (professional) =>
            professional.institutionId === institutionId &&
            this.isAvailableProfessional(professional) &&
            professional.branchAssignments.some(
              (assignment) =>
                assignment.branchId === branchId && assignment.active,
            ) &&
            professional.serviceAssignments.some(
              (assignment) =>
                assignment.serviceId === serviceId && assignment.active,
            ),
        )
        .map((professional) => this.mapProfessional(professional)),
    };
  }

  private async findAvailableBranch(
    branchId: string,
  ): Promise<BranchAvailabilityRecord> {
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
            id: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!branch || !this.isAvailableBranch(branch)) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  private async findAvailableService(
    serviceId: string,
  ): Promise<ServiceAvailabilityRecord> {
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
        id: true,
        institutionId: true,
        active: true,
        deletedAt: true,
        institution: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!service || !this.isAvailableService(service)) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  private isAvailableProfessional(
    professional: ProfessionalSummaryRecord,
  ): boolean {
    return (
      professional.status === ProfessionalStatus.ACTIVE &&
      professional.deletedAt === null &&
      professional.institutionId === professional.institution.id &&
      professional.institution.status === InstitutionStatus.ACTIVE &&
      professional.institution.deletedAt === null
    );
  }

  private isAvailableBranch(branch: BranchAvailabilityRecord): boolean {
    return (
      branch.status === BranchStatus.ACTIVE &&
      branch.deletedAt === null &&
      branch.institutionId === branch.institution.id &&
      branch.institution.status === InstitutionStatus.ACTIVE &&
      branch.institution.deletedAt === null
    );
  }

  private isAvailableService(service: ServiceAvailabilityRecord): boolean {
    return (
      service.active &&
      service.deletedAt === null &&
      service.institutionId === service.institution.id &&
      service.institution.status === InstitutionStatus.ACTIVE &&
      service.institution.deletedAt === null
    );
  }

  private mapProfessional(professional: ProfessionalSummaryRecord) {
    return {
      id: professional.id,
      firstNames: professional.user.firstNames,
      lastNames: professional.user.lastNames,
      titleOrFunction: professional.titleOrFunction,
      description: professional.description,
      institution: {
        id: professional.institution.id,
        name: professional.institution.name,
      },
    };
  }
}
