import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { BranchesController } from './branches.controller.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ServicesController, BranchesController],
  providers: [ServicesService],
})
export class ServicesModule {}
