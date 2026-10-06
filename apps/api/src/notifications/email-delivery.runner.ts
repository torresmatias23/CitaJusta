import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailDeliveryService } from './email-delivery.service.js';

@Injectable()
export class EmailDeliveryRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailDeliveryRunner.name);
  private timer?: NodeJS.Timeout;
  private activePromise?: Promise<void>;
  private stopped = false;
  constructor(private readonly service: EmailDeliveryService, private readonly config: ConfigService) {}

  onApplicationBootstrap(): void {
    if (this.config.getOrThrow<boolean>('EMAIL_DELIVERY_ENABLED')) this.startCycle();
  }

  private startCycle(): void {
    if (this.stopped || this.activePromise) return;
    this.activePromise = this.service.processBatch().catch(() => {
      this.logger.warn('Email delivery cycle failed; inspect durable delivery state.');
    }).finally(() => {
      this.activePromise = undefined;
      if (!this.stopped) {
        this.timer = setTimeout(() => this.startCycle(), this.config.getOrThrow<number>('EMAIL_DELIVERY_INTERVAL_MS'));
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
