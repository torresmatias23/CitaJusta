import {
  BranchStatus,
  InstitutionStatus,
  ProfessionalStatus,
  type Prisma,
} from '../generated/prisma/client.js';

export interface AvailabilityContext {
  institutionId: string;
  branchId: string;
  serviceId: string;
}

// Shared by availability reads and the conditional booking write.
export function availableAvailabilityWhere(
  context: AvailabilityContext,
  professionalId?: string,
): Prisma.AvailabilityWhereInput {
  return {
    active: true,
    branchId: context.branchId,
    serviceId: context.serviceId,
    ...(professionalId ? { professionalId } : {}),
    branch: {
      id: context.branchId,
      institutionId: context.institutionId,
      status: BranchStatus.ACTIVE,
      deletedAt: null,
      institution: { status: InstitutionStatus.ACTIVE, deletedAt: null },
    },
    service: {
      id: context.serviceId,
      institutionId: context.institutionId,
      active: true,
      deletedAt: null,
      branchAssignments: { some: { branchId: context.branchId, active: true } },
      institution: { status: InstitutionStatus.ACTIVE, deletedAt: null },
    },
    professional: {
      ...(professionalId ? { id: professionalId } : {}),
      institutionId: context.institutionId,
      status: ProfessionalStatus.ACTIVE,
      deletedAt: null,
      institution: { status: InstitutionStatus.ACTIVE, deletedAt: null },
      branchAssignments: { some: { branchId: context.branchId, active: true } },
      serviceAssignments: { some: { serviceId: context.serviceId, active: true } },
    },
    OR: [
      { attentionPointId: null },
      { attentionPoint: { is: { branchId: context.branchId, active: true } } },
    ],
  };
}
