import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';
import { WaitlistPreferencesService } from './waitlist-preferences.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InstitutionalWaitlistController } from './institutional-waitlist.controller.js';
import { InstitutionalWaitlistService } from './institutional-waitlist.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [WaitlistController, InstitutionalWaitlistController],
  providers: [WaitlistService, WaitlistPreferencesService, InstitutionalWaitlistService],
})
export class WaitlistModule {}
