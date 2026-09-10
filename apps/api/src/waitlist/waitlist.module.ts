import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';
import { WaitlistPreferencesService } from './waitlist-preferences.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WaitlistController],
  providers: [WaitlistService, WaitlistPreferencesService],
})
export class WaitlistModule {}
