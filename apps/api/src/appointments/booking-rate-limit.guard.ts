import { HttpException, HttpStatus, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { BookingRateLimitService } from './booking-rate-limit.service.js';

@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: BookingRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const decision = await this.limiter.consume(request.principal.userId);
    if (!decision.allowed) {
      const response = http.getResponse<ServerResponse>();
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      response.setHeader('Cache-Control', 'no-store');
      throw new HttpException('Too many booking requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
