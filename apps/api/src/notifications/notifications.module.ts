import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({ imports: [AuthModule, DatabaseModule], controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
