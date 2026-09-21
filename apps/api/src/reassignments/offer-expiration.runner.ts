import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { ReassignmentsService } from './reassignments.service.js';

@Injectable()
export class OfferExpirationRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OfferExpirationRunner.name);
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private stopped = false;

  constructor(private readonly prisma: PrismaService, private readonly service: ReassignmentsService,
    private readonly config: ConfigService) {}

  onApplicationBootstrap(): void {
    if (this.config.getOrThrow<boolean>('OFFER_EXPIRATION_ENABLED')) this.startCycle();
  }

  private startCycle(): void {
    if (this.stopped || this.active) return;
    this.active = this.processBatch().finally(() => {
      this.active = undefined;
      if (!this.stopped) {
        this.timer = setTimeout(() => this.startCycle(), this.config.getOrThrow<number>('OFFER_EXPIRATION_INTERVAL_MS'));
        this.timer.unref();
      }
    });
  }

  private async processBatch(): Promise<void> {
    try {
      const offers = await this.prisma.appointmentOffer.findMany({
        where: { status: 'PENDING', expiresAt: { lte: new Date() } },
        select: { id: true }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: this.config.getOrThrow<number>('OFFER_EXPIRATION_BATCH_SIZE'),
      });
      for (const offer of offers) {
        if (this.stopped) break;
        try { await this.service.expireOffer(offer.id); }
        catch { this.logger.warn(`Offer expiration deferred: ${offer.id}`); }
      }
    } catch { this.logger.warn('Offer expiration batch unavailable; will retry'); }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }
}
