import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailDeliveryService } from './email-delivery.service.js';
import { AccountRecoveryDeliveryService } from '../auth/account-recovery-delivery.service.js';

@Injectable()
export class EmailDeliveryRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailDeliveryRunner.name);
  private timer?: NodeJS.Timeout;
  private activePromise?: Promise<void>;
  private stopped = false;
  constructor(private readonly service: EmailDeliveryService, private readonly config: ConfigService,
    @Optional() private readonly recovery?: AccountRecoveryDeliveryService) {}

  onApplicationBootstrap(): void {
    if (this.recovery || this.config.getOrThrow<boolean>('EMAIL_DELIVERY_ENABLED')) this.startCycle();
  }

  private startCycle(): void {
    if (this.stopped || this.activePromise || this.timer) return;
    this.activePromise = Promise.allSettled([this.service.processBatch(),
      this.recovery?.cleanupExpiredBatch().then(() => this.recovery?.processBatch())]).then(results => {
      if (results.some(result => result.status === 'rejected')) this.logger.warn('Email delivery cycle failed; inspect durable delivery state.');
    }).finally(() => {
      this.activePromise = undefined;
      if (!this.stopped) {
        this.timer = setTimeout(() => { this.timer = undefined; this.startCycle(); }, this.config.getOrThrow<number>('EMAIL_DELIVERY_INTERVAL_MS'));
        this.timer.unref();
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.activePromise;
  }
}
