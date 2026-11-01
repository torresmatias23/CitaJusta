import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { InstitutionalUsersController } from './institutional-users.controller.js';
import { InstitutionalUsersService } from './institutional-users.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [UsersController, InstitutionalUsersController],
  providers: [UsersService, InstitutionalUsersService],
})
export class UsersModule {}
