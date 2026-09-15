import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ProfessionalRelationsController } from './professional-relations.controller.js';
import { ProfessionalsController } from './professionals.controller.js';
import { ProfessionalsService } from './professionals.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ProfessionalAdministrationService } from './professional-administration.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [ProfessionalsController, ProfessionalRelationsController],
  providers: [ProfessionalsService, ProfessionalAdministrationService],
})
export class ProfessionalsModule {}
