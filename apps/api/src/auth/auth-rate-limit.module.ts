import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [AuthRateLimitService, AuthRateLimitGuard],
  exports: [AuthRateLimitService, AuthRateLimitGuard],
})
export class AuthRateLimitModule {}
