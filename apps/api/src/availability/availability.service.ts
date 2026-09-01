import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  BranchStatus,
  InstitutionStatus,
  ProfessionalStatus,
  SlotStatus,
} from '../generated/prisma/client.js';
import type { AvailabilityRange } from './schemas/availability-query.schemas.js';

interface AvailabilityContext {
  institutionId: string;
  branchId: string;
  serviceId: string;
}

interface InstitutionAvailabilityRecord {
  id: string;
  status: InstitutionStatus;
  deletedAt: Date | null;
}

interface BranchAvailabilityRecord {
  id: string;
  institutionId: string;
  status: BranchStatus;
  deletedAt: Date | null;
  institution: InstitutionAvailabilityRecord;
}

interface ServiceAvailabilityRecord {
  id: string;
  institutionId: string;
  active: boolean;
  deletedAt: Date | null;
  institution: InstitutionAvailabilityRecord;
}

interface ProfessionalAvailabilityRecord {
  id: string;
  institutionId: string;
  status: ProfessionalStatus;
  deletedAt: Date | null;
  institution: InstitutionAvailabilityRecord;
  branchAssignments: Array<{
    branchId: string;
    active: boolean;
  }>;
  serviceAssignments: Array<{
    serviceId: string;
    active: boolean;
  }>;
}

interface SlotAvailabilityRecord {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: SlotStatus;
  blockedUntilAt: Date | null;
  availability: {
    active: boolean;
    branchId: string;
    serviceId: string;
    professionalId: string;
    attentionPointId: string | null;
    attentionPoint: {
      id: string;
      branchId: string;
      active: boolean;
    } | null;
    professional: ProfessionalAvailabilityRecord & {
      titleOrFunction: string | null;
      user: {
        firstNames: string;
        lastNames: string;
      };
    };
  };
}

@Injectable()
export class AgendaAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async findAvailableSlots(
    branchId: string,
    serviceId: string,
    range: AvailabilityRange,
  ) {
    const context = await this.findAvailableContext(branchId, serviceId);

    return this.queryAvailableSlots(context, range);
  }

  async findAvailableSlotsByProfessional(
    branchId: string,
    serviceId: string,
    professionalId: string,
    range: AvailabilityRange,
  ) {
    const context = await this.findAvailableContext(branchId, serviceId);
    await this.requireCompatibleProfessional(context, professionalId);

    return this.queryAvailableSlots(context, range, professionalId);
  }

  private async findAvailableContext(
    branchId: string,
    serviceId: string,
  ): Promise<AvailabilityContext> {
    const serviceBranch = await this.prisma.serviceBranch.findFirst({
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
      !serviceBranch ||
      !serviceBranch.active ||
      serviceBranch.branch.id !== branchId ||
      serviceBranch.service.id !== serviceId ||
      serviceBranch.branch.institutionId !==
        serviceBranch.service.institutionId ||
      !this.isAvailableBranch(serviceBranch.branch) ||
      !this.isAvailableService(serviceBranch.service)
    ) {
      throw new NotFoundException('Service not available at branch');
    }

    return {
      institutionId: serviceBranch.branch.institutionId,
      branchId,
      serviceId,
    };
  }

  private async requireCompatibleProfessional(
    context: AvailabilityContext,
    professionalId: string,
  ): Promise<void> {
    const professional = await this.prisma.professional.findFirst({
      where: {
        id: professionalId,
        institutionId: context.institutionId,
        status: ProfessionalStatus.ACTIVE,
        deletedAt: null,
        institution: {
          status: InstitutionStatus.ACTIVE,
          deletedAt: null,
        },
        branchAssignments: {
          some: {
            branchId: context.branchId,
            active: true,
          },
        },
        serviceAssignments: {
          some: {
            serviceId: context.serviceId,
            active: true,
          },
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
        branchAssignments: {
          where: {
            branchId: context.branchId,
            active: true,
          },
          select: {
            branchId: true,
            active: true,
          },
        },
        serviceAssignments: {
          where: {
            serviceId: context.serviceId,
            active: true,
          },
          select: {
            serviceId: true,
            active: true,
          },
        },
      },
    });

    if (
      !professional ||
      professional.id !== professionalId ||
      professional.institutionId !== context.institutionId ||
      !this.isAvailableProfessional(professional, context)
    ) {
      throw new NotFoundException('Professional not available in context');
    }
  }

  private async queryAvailableSlots(
    context: AvailabilityContext,
    range: AvailabilityRange,
    professionalId?: string,
  ) {
    const now = new Date();
    const effectiveFrom = range.from > now ? range.from : now;

    if (effectiveFrom >= range.to) {
      return { data: [] };
    }

    const slots = await this.prisma.agendaSlot.findMany({
      where: {
        status: SlotStatus.AVAILABLE,
        startsAt: {
          gte: effectiveFrom,
          lt: range.to,
        },
        OR: [
          { blockedUntilAt: null },
          { blockedUntilAt: { lte: now } },
        ],
        availability: {
          active: true,
          branchId: context.branchId,
          serviceId: context.serviceId,
          ...(professionalId ? { professionalId } : {}),
          branch: {
            id: context.branchId,
            institutionId: context.institutionId,
            status: BranchStatus.ACTIVE,
            deletedAt: null,
            institution: {
              status: InstitutionStatus.ACTIVE,
              deletedAt: null,
            },
          },
          service: {
            id: context.serviceId,
            institutionId: context.institutionId,
            active: true,
            deletedAt: null,
            branchAssignments: {
              some: {
                branchId: context.branchId,
                active: true,
              },
            },
            institution: {
              status: InstitutionStatus.ACTIVE,
              deletedAt: null,
            },
          },
          professional: {
            ...(professionalId ? { id: professionalId } : {}),
            institutionId: context.institutionId,
            status: ProfessionalStatus.ACTIVE,
            deletedAt: null,
            institution: {
              status: InstitutionStatus.ACTIVE,
              deletedAt: null,
            },
            branchAssignments: {
              some: {
                branchId: context.branchId,
                active: true,
              },
            },
            serviceAssignments: {
              some: {
                serviceId: context.serviceId,
                active: true,
              },
            },
          },
          OR: [
            { attentionPointId: null },
            {
              attentionPoint: {
                is: {
                  branchId: context.branchId,
                  active: true,
                },
              },
            },
          ],
        },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        blockedUntilAt: true,
        availability: {
          select: {
            active: true,
            branchId: true,
            serviceId: true,
            professionalId: true,
            attentionPointId: true,
            attentionPoint: {
              select: {
                id: true,
                branchId: true,
                active: true,
              },
            },
            professional: {
              select: {
                id: true,
                institutionId: true,
                titleOrFunction: true,
                status: true,
                deletedAt: true,
                institution: {
                  select: {
                    id: true,
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
                branchAssignments: {
                  where: {
                    branchId: context.branchId,
                    active: true,
                  },
                  select: {
                    branchId: true,
                    active: true,
                  },
                },
                serviceAssignments: {
                  where: {
                    serviceId: context.serviceId,
                    active: true,
                  },
                  select: {
                    serviceId: true,
                    active: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      data: slots
        .filter((slot) =>
          this.isAvailableSlot(
            slot,
            context,
            effectiveFrom,
            range.to,
            now,
            professionalId,
          ),
        )
        .map((slot) => ({
          id: slot.id,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          professional: {
            id: slot.availability.professional.id,
            firstNames:
              slot.availability.professional.user.firstNames,
            lastNames:
              slot.availability.professional.user.lastNames,
            titleOrFunction:
              slot.availability.professional.titleOrFunction,
          },
        })),
    };
  }

  private isAvailableSlot(
    slot: SlotAvailabilityRecord,
    context: AvailabilityContext,
    effectiveFrom: Date,
    to: Date,
    now: Date,
    professionalId?: string,
  ): boolean {
    const availability = slot.availability;
    const professional = availability.professional;
    const validAttentionPoint =
      availability.attentionPointId === null ||
      (availability.attentionPoint !== null &&
        availability.attentionPoint.id ===
          availability.attentionPointId &&
        availability.attentionPoint.branchId === context.branchId &&
        availability.attentionPoint.active);

    return (
      slot.status === SlotStatus.AVAILABLE &&
      slot.startsAt >= effectiveFrom &&
      slot.startsAt < to &&
      slot.endsAt > slot.startsAt &&
      (slot.blockedUntilAt === null || slot.blockedUntilAt <= now) &&
      availability.active &&
      availability.branchId === context.branchId &&
      availability.serviceId === context.serviceId &&
      professional.id === availability.professionalId &&
      (professionalId === undefined || professional.id === professionalId) &&
      validAttentionPoint &&
      this.isAvailableProfessional(professional, context)
    );
  }

  private isAvailableProfessional(
    professional: ProfessionalAvailabilityRecord,
    context: AvailabilityContext,
  ): boolean {
    return (
      professional.status === ProfessionalStatus.ACTIVE &&
      professional.deletedAt === null &&
      professional.institutionId === context.institutionId &&
      professional.institution.id === context.institutionId &&
      professional.institution.status === InstitutionStatus.ACTIVE &&
      professional.institution.deletedAt === null &&
      professional.branchAssignments.some(
        (assignment) =>
          assignment.branchId === context.branchId && assignment.active,
      ) &&
      professional.serviceAssignments.some(
        (assignment) =>
          assignment.serviceId === context.serviceId && assignment.active,
      )
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
}
