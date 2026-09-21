import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ReassignmentsController } from './reassignments.controller.js';
import { ReassignmentsService } from './reassignments.service.js';
import { ReassignmentSupervisionService } from './reassignment-supervision.service.js';
import { RecipientOffersService } from './recipient-offers.service.js';
import { OfferExpirationRunner } from './offer-expiration.runner.js';

@Module({ imports: [AuthModule, AuthorizationModule, DatabaseModule], controllers: [ReassignmentsController], providers: [ReassignmentsService, ReassignmentSupervisionService, RecipientOffersService, OfferExpirationRunner] })
export class ReassignmentsModule {}
