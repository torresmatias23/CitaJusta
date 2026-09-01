import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { InstitutionsController } from './institutions.controller.js';
import { InstitutionsService } from './institutions.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [InstitutionsController],
  providers: [InstitutionsService],
})
export class InstitutionsModule {}
