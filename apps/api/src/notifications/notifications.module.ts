import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { ResendClient } from './resend.client.js';
import { EmailDeliveryService } from './email-delivery.service.js';
import { EmailDeliveryRunner } from './email-delivery.runner.js';
import { AccountRecoveryModule } from '../auth/account-recovery.module.js';

@Module({ imports: [AuthModule, DatabaseModule, AccountRecoveryModule], controllers: [NotificationsController], providers: [NotificationsService, ResendClient, EmailDeliveryService, EmailDeliveryRunner] })
export class NotificationsModule {}
