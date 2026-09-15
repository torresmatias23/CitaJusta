import { Body, Controller, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { AttendanceService } from './attendance.service.js';
import { attendanceContext, parseAttendance } from './attendance.schemas.js';

@Controller('appointments')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Post(':appointmentId/attendance')
  @HttpCode(200)
  @RequirePermissions('appointments.attendance')
  record(@Param() params: unknown, @Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    const input = parseAttendance(params, body, query);
    return this.service.record(input.appointmentId, input.status, attendanceContext(request));
  }
}
