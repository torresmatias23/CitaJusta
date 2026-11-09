import { createHmac } from 'node:crypto';
import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { consumePostgresRateLimit, type RateLimitDecision } from '../common/postgres-rate-limit.js';
import { bookingRateLimitPolicy } from './booking-rate-limit.policy.js';

@Injectable()
export class BookingRateLimitService {
  private readonly logger = new Logger(BookingRateLimitService.name);
  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_ACCESS_SECRET'))
      .update('citajusta/booking-rate-limit/key/v1').digest();
  }

  // Only the authenticated principal's userId, never body/query/session/IP.
  async consume(userId: string): Promise<RateLimitDecision> {
    const identifier = createHmac('sha256', this.key)
      .update(JSON.stringify(['citajusta/booking-rate-limit/v1', 'create', userId.toLowerCase()]))
      .digest('hex');
    try {
      return await consumePostgresRateLimit(this.prisma, identifier, bookingRateLimitPolicy);
    } catch (error) {
      this.logger.error('Booking rate limit storage unavailable');
      if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientInitializationError) {
        throw new ServiceUnavailableException('Booking unavailable');
      }
      throw new InternalServerErrorException('Booking unavailable');
    }
  }
}
