import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AccountRecoveryService, parseRecoveryRequest, parseRecoveryReset } from './account-recovery.service.js';

@Controller('auth')
export class AccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryService) {}
  @Post('forgot-password')
  @HttpCode(202)
  request(@Body() body: unknown) { return this.recovery.request(parseRecoveryRequest(body).email); }
  @Post('reset-password')
  @HttpCode(200)
  reset(@Body() body: unknown) {
    const input = parseRecoveryReset(body);
    return this.recovery.reset(input.token, input.password);
  }
}
