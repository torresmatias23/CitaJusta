import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const recipientOfferSelect = {
  id: true, status: true, createdAt: true, expiresAt: true, respondedAt: true,
  candidate: { select: { waitlistEntry: { select: { institutionId: true, serviceId: true, userId: true } } } },
  reassignment: { select: {
    institutionId: true, serviceId: true,
    agendaSlot: { select: {
      startsAt: true, endsAt: true,
      availability: { select: {
        service: { select: { id: true, name: true, institutionId: true } },
        branch: { select: { id: true, name: true, institutionId: true } },
        professional: { select: {
          id: true, institutionId: true, user: { select: { firstNames: true, lastNames: true } },
        } },
      } },
    } },
  } },
} as const satisfies Prisma.AppointmentOfferSelect;

@Injectable()
export class RecipientOffersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(principal: AuthenticatedPrincipal) {
    try {
      const offers = await this.prisma.appointmentOffer.findMany({
        where: { candidate: { userId: principal.userId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: recipientOfferSelect,
      });
      return { data: offers.filter((offer) => {
        const process = offer.reassignment;
        const { branch, service, professional } = process.agendaSlot.availability;
        const entry = offer.candidate.waitlistEntry;
        // Keep historical states/catalogs; exclude inconsistent cross-tenant relations only.
        return entry.userId === principal.userId && entry.institutionId === process.institutionId &&
          entry.serviceId === process.serviceId && service.id === process.serviceId &&
          service.institutionId === process.institutionId && branch.institutionId === process.institutionId &&
          professional.institutionId === process.institutionId;
      }).map((offer) => {
        const slot = offer.reassignment.agendaSlot;
        const { service, branch, professional } = slot.availability;
        return {
          id: offer.id, status: offer.status,
          createdAt: offer.createdAt.toISOString(), expiresAt: offer.expiresAt.toISOString(),
          respondedAt: offer.respondedAt?.toISOString() ?? null,
          startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(),
          service: { id: service.id, name: service.name },
          branch: { id: branch.id, name: branch.name },
          professional: { id: professional.id, firstNames: professional.user.firstNames, lastNames: professional.user.lastNames },
        };
      }) };
    } catch (error) {
      throw new InternalServerErrorException('Unable to list offers', { cause: error });
    }
  }
}
