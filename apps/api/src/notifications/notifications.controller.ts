import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { NotificationsService } from './notifications.service.js';
import { emptyInput, parseNotificationId, parseNotificationQuery } from './notifications.schemas.js';

@Controller('notifications')
@UseGuards(AccessTokenGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('me')
  findMine(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    emptyInput(body); return this.service.findMine(parseNotificationQuery(query), request.principal);
  }

  @Get('me/unread-count')
  unreadCount(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    emptyInput(query); emptyInput(body); return this.service.unreadCount(request.principal);
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  read(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    emptyInput(query); emptyInput(body); return this.service.read(parseNotificationId(params), request.principal);
  }
}
