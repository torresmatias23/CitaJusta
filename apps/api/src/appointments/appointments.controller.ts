import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { AppointmentsService } from './appointments.service.js';
import { AppointmentCalendarService } from './appointment-calendar.service.js';
import {
  parseBookingInput,
  parseCancellationInput,
  parseMyAppointmentsInput,
  parseCalendarInput,
} from './appointments.schemas.js';

@Controller('appointments')
@UseGuards(AccessTokenGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService, private readonly calendar: AppointmentCalendarService) {}

  @Post(':appointmentId/google-calendar')
  @HttpCode(HttpStatus.OK)
  exportCalendar(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { appointmentId, code } = parseCalendarInput(params, query, body);
    return this.calendar.export(appointmentId, code, request.principal, request.headers);
  }

  @Get('me')
  findMine(
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    parseMyAppointmentsInput(query, body);
    return this.appointmentsService.findMine(request.principal);
  }

  @Post()
  reserve(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { agendaSlotId } = parseBookingInput(body);
    return this.appointmentsService.reserve(agendaSlotId, request.principal);
  }

  @Post(':appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param() params: unknown,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { appointmentId } = parseCancellationInput(params, query, body);
    return this.appointmentsService.cancel(appointmentId, request.principal);
  }
}
