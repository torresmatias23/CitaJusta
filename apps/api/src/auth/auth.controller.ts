import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import {
  parseLoginInput,
  parseRefreshToken,
  parseRegisterInput,
} from './schemas/auth.schemas.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: unknown) {
    return this.authService.register(parseRegisterInput(body));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: unknown) {
    return this.authService.login(parseLoginInput(body));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: unknown) {
    return this.authService.refresh(parseRefreshToken(body));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown): Promise<void> {
    await this.authService.logout(parseRefreshToken(body));
  }
}
