import {
  Controller,
  Get,
  Body,
  Patch,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { UsersService } from './users.service.js';
import { parseProfileUpdate, parsePreferencesUpdate } from './users.schemas.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  @UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
  updateMe(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization) throw new UnauthorizedException('Unauthorized');
    return this.usersService.updateMe(parseProfileUpdate(body, query), request.principal, request.authorization);
  }

  @Put('me/notification-preferences')
  @UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
  updatePreferences(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization) throw new UnauthorizedException('Unauthorized');
    return this.usersService.updatePreferences(parsePreferencesUpdate(body, query), request.principal, request.authorization);
  }

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
