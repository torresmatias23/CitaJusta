import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthRateLimit } from './auth-rate-limit.guard.js';
import { AccountRecoveryService, parseRecoveryRequest, parseRecoveryReset } from './account-recovery.service.js';

@Controller('auth')
export class AccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryService) {}
  @Post('forgot-password')
  @AuthRateLimit('forgot-password')
  @HttpCode(202)
  request(@Body() body: unknown) { return this.recovery.request(parseRecoveryRequest(body).email); }
  @Post('reset-password')
  @AuthRateLimit('reset-password')
  @HttpCode(200)
  reset(@Body() body: unknown) {
    const input = parseRecoveryReset(body);
    return this.recovery.reset(input.token, input.password);
  }
}
