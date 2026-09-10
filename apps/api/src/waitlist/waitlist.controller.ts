import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { parseWaitlistEntry, parseWaitlistEntryParams, parseWaitlistListing, parseWaitlistPreferences } from './waitlist.schemas.js';
import { WaitlistService } from './waitlist.service.js';
import { WaitlistPreferencesService } from './waitlist-preferences.service.js';

@Controller('waitlist')
@UseGuards(AccessTokenGuard)
export class WaitlistController {
  constructor(
    private readonly waitlist: WaitlistService,
    private readonly preferences: WaitlistPreferencesService,
  ) {}

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

  @Get(':waitlistEntryId/preferences')
  getPreferences(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { waitlistEntryId } = parseWaitlistEntryParams(params);
    parseWaitlistListing(query, body);
    return this.preferences.get(waitlistEntryId, request.principal);
  }

  @Put(':waitlistEntryId/preferences')
  putPreferences(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { waitlistEntryId } = parseWaitlistEntryParams(params);
    return this.preferences.replace(waitlistEntryId, parseWaitlistPreferences(body, query), request.principal);
  }

  @Post(':waitlistEntryId/withdraw')
  @HttpCode(200)
  withdraw(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { waitlistEntryId } = parseWaitlistEntryParams(params);
    parseWaitlistListing(query, body);
    return this.preferences.withdraw(waitlistEntryId, request.principal);
  }
}
