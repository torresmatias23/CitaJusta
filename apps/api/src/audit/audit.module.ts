import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Module({ imports: [AuthModule, AuthorizationModule, DatabaseModule], controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
