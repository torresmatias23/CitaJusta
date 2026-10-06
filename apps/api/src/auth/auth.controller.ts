import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import {
  parseLoginInput,
  parseRefreshToken,
  parseRegisterInput,
  parseGoogleCredential,
} from './schemas/auth.schemas.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import type { AuthenticatedRequest } from './types/authenticated-principal.js';

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

  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(@Body() body: unknown) {
    return this.authService.loginGoogle(parseGoogleCredential(body));
  }

  @Post('google/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  async linkGoogle(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    await this.authService.linkGoogle(request.principal.userId, parseGoogleCredential(body));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown): Promise<void> {
    await this.authService.logout(parseRefreshToken(body));
  }
}
