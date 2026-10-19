import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ResendClient } from '../notifications/resend.client.js';
import { AccountRecoveryCrypto } from './account-recovery.crypto.js';
import { AccountRecoveryController } from './account-recovery.controller.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AccountRecoveryDeliveryService } from './account-recovery-delivery.service.js';

@Module({ imports: [DatabaseModule], controllers: [AccountRecoveryController],
  providers: [AccountRecoveryCrypto, AccountRecoveryService, AccountRecoveryDeliveryService, ResendClient],
  exports: [AccountRecoveryDeliveryService, AccountRecoveryCrypto, AccountRecoveryService] })
export class AccountRecoveryModule {}
