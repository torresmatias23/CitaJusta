import { Body, Controller, Get, HttpCode, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { currentPrivacyNotice } from './privacy-notices.js';
import { PrivacyNoticeService } from './privacy-notice.service.js';
import { parsePrivacyAcknowledgement, validatePrivacyRead } from './privacy-notice.schemas.js';

@Controller('privacy-notice')
export class PublicPrivacyNoticeController {
  @Get()
  find(@Query() query: unknown, @Body() body: unknown) {
    validatePrivacyRead(query, body);
    return { data: currentPrivacyNotice };
  }
}

// Account-level information, independent of institutional grants, as with own notifications.
@Controller('users/me/privacy-notice')
@UseGuards(AccessTokenGuard)
export class PrivacyNoticeController {
  constructor(private readonly service: PrivacyNoticeService) {}

  @Get()
  find(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    validatePrivacyRead(query, body);
    return this.service.findMine(request.principal);
  }

  @Post('acknowledgement')
  @HttpCode(200)
  acknowledge(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const input = parsePrivacyAcknowledgement(query, body);
    return this.service.acknowledge(input.versionId, request.principal);
  }
}
