import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthorizationService } from './authorization.service.js';
import type {
  AuthorizedRequest,
  InstitutionContext,
} from './types/authorization-context.js';

const uuidSchema = z.string().uuid();

@Injectable()
export class AuthorizationContextGuard implements CanActivate {
  constructor(private readonly authorizationService: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();

    if (!request.principal) {
      throw new UnauthorizedException('Unauthorized');
    }

    const institutionContext = this.parseInstitutionContext(request.headers);
    request.authorization = await this.authorizationService.resolveForUser(
      request.principal.userId,
      institutionContext,
    );

    return true;
  }

  private parseInstitutionContext(
    headers: AuthorizedRequest['headers'],
  ): InstitutionContext {
    const institutionId = this.parseOptionalUuid(
      headers['x-institution-id'],
    );
    const branchId = this.parseOptionalUuid(headers['x-branch-id']);
    const context: InstitutionContext = {};

    if (institutionId) {
      context.institutionId = institutionId;
    }

    if (branchId) {
      context.branchId = branchId;
    }

    return context;
  }

  private parseOptionalUuid(
    value: string | string[] | undefined,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    const result = uuidSchema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException('Invalid institutional context');
    }

    return result.data;
  }
}
