import { Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { parseWaitlistEntry, parseWaitlistListing } from './waitlist.schemas.js';
import { WaitlistService } from './waitlist.service.js';

@Controller('waitlist')
@UseGuards(AccessTokenGuard)
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  enter(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    return this.waitlist.enter(parseWaitlistEntry(body, query), request.principal);
  }

  @Get()
  findMine(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    parseWaitlistListing(query, body);
    return this.waitlist.findMine(request.principal);
  }
}
