import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ReassignmentPolicyController } from './reassignment-policy.controller.js';
import { ReassignmentPolicyService } from './reassignment-policy.service.js';

@Module({ imports: [AuthModule, AuthorizationModule, DatabaseModule], controllers: [ReassignmentPolicyController], providers: [ReassignmentPolicyService] })
export class ReassignmentPolicyModule {}
