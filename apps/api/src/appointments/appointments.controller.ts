import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { AppointmentsService } from './appointments.service.js';
import { parseBookingInput } from './appointments.schemas.js';

@Controller('appointments')
@UseGuards(AccessTokenGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  reserve(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const { agendaSlotId } = parseBookingInput(body);
    return this.appointmentsService.reserve(agendaSlotId, request.principal);
  }
}
