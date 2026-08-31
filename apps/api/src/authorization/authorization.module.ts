import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthorizationContextGuard } from './authorization-context.guard.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionsGuard } from './permissions.guard.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    AuthorizationService,
    AuthorizationContextGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthorizationService,
    AuthorizationContextGuard,
    PermissionsGuard,
  ],
})
export class AuthorizationModule {}
