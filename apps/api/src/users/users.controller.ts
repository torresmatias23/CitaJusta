import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
  getMe(@Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization) {
      throw new UnauthorizedException('Unauthorized');
    }

    return this.usersService.getMe(
      request.principal,
      request.authorization,
    );
  }
}
