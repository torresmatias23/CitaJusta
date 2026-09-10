import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ReassignmentsController } from './reassignments.controller.js';
import { ReassignmentsService } from './reassignments.service.js';

@Module({ imports: [AuthModule, AuthorizationModule, DatabaseModule], controllers: [ReassignmentsController], providers: [ReassignmentsService] })
export class ReassignmentsModule {}
