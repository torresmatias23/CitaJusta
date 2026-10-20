import { ConflictException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, UserStatus } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { disabledEmailTypes, emailPreferenceDisabled } from '../notifications/email-preferences.js';
import type { PreferencesUpdate, ProfileUpdate } from './users.schemas.js';

const accountSelect = { id: true, email: true, firstNames: true, lastNames: true, phone: true, status: true,
  appointmentEmailsEnabled: true, offerEmailsEnabled: true } as const satisfies Prisma.UserSelect;
type Account = Prisma.UserGetPayload<{ select: typeof accountSelect }>;
const personalDto = (user: Account) => ({ firstName: user.firstNames, lastName: user.lastNames, phone: user.phone });
const preferencesDto = (user: Account) => ({ appointmentEmailsEnabled: user.appointmentEmailsEnabled, offerEmailsEnabled: user.offerEmailsEnabled });

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getMe(
    principal: AuthenticatedPrincipal,
    authorization: AuthorizationContext,
  ) {
    if (authorization.userId !== principal.userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: principal.userId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: accountSelect,
    });

    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    return {
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstNames,
        lastName: user.lastNames,
        status: user.status,
        phone: user.phone,
        notificationPreferences: preferencesDto(user),
        context: {
          ...(authorization.institutionId
            ? { institutionId: authorization.institutionId }
            : {}),
          ...(authorization.branchId
            ? { branchId: authorization.branchId }
            : {}),
        },
        roles: [...authorization.roleCodes],
        permissions: [...authorization.permissions],
      },
    };
  }

  async updateMe(input: ProfileUpdate, principal: AuthenticatedPrincipal, authorization: AuthorizationContext) {
    this.assertPrincipal(principal, authorization);
    return this.write(async tx => {
      const user = await this.current(tx, principal.userId);
      const data: Prisma.UserUpdateManyMutationInput = {
        ...(input.firstName !== undefined ? { firstNames: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastNames: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      };
      const changed = (input.firstName !== undefined && input.firstName !== user.firstNames) ||
        (input.lastName !== undefined && input.lastName !== user.lastNames) || (input.phone !== undefined && input.phone !== user.phone);
      if (changed) {
        const updated = await tx.user.updateMany({ where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null }, data });
        if (updated.count !== 1) throw new UnauthorizedException('Unauthorized');
        await AuditService.record(tx, { actorUserId: principal.userId, actorType: 'USER', actionCode: 'ACCOUNT_PROFILE_UPDATED', resourceType: 'AUTH', resourceId: principal.userId, outcome: 'SUCCESS' });
      }
      return { data: personalDto(await this.current(tx, principal.userId)) };
    });
  }

  async updatePreferences(input: PreferencesUpdate, principal: AuthenticatedPrincipal, authorization: AuthorizationContext) {
    this.assertPrincipal(principal, authorization);
    return this.write(async tx => {
      const user = await this.current(tx, principal.userId);
      const changed = user.appointmentEmailsEnabled !== input.appointmentEmailsEnabled || user.offerEmailsEnabled !== input.offerEmailsEnabled;
      if (changed) {
        const updated = await tx.user.updateMany({ where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null },
          data: { appointmentEmailsEnabled: input.appointmentEmailsEnabled, offerEmailsEnabled: input.offerEmailsEnabled } });
        if (updated.count !== 1) throw new UnauthorizedException('Unauthorized');
      }
      const types = disabledEmailTypes(input);
      // Execute even when no rows appear pending. Together with the producer's in-transaction
      // preference read, Serializable protects the concurrent enqueue/disable predicate.
      if (types.length) await tx.notificationEmailDelivery.updateMany({ where: { status: { in: ['PENDING', 'PROCESSING'] },
        notification: { recipientUserId: principal.userId, type: { in: types } } },
        data: { status: 'FAILED', lastErrorCode: emailPreferenceDisabled, payload: Prisma.DbNull, claimToken: null, lockedUntil: null } });
      if (changed) await AuditService.record(tx, { actorUserId: principal.userId, actorType: 'USER', actionCode: 'ACCOUNT_EMAIL_PREFERENCES_UPDATED', resourceType: 'AUTH', resourceId: principal.userId, outcome: 'SUCCESS' });
      return { data: preferencesDto(await this.current(tx, principal.userId)) };
    });
  }

  private assertPrincipal(principal: AuthenticatedPrincipal, authorization: AuthorizationContext) {
    if (authorization.userId !== principal.userId) throw new UnauthorizedException('Unauthorized');
  }
  private async current(tx: Prisma.TransactionClient, userId: string): Promise<Account> {
    const user = await tx.user.findFirst({ where: { id: userId, status: UserStatus.ACTIVE, deletedAt: null }, select: accountSelect });
    if (!user) throw new UnauthorizedException('Unauthorized');
    return user;
  }
  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        if (isTransactionConflict(error)) {
          if (attempt < 2) continue;
          throw new ConflictException('Account update conflicted; retry');
        }
        // Do not log adapters' input, SQL or error messages containing personal information.
        if (error instanceof Prisma.PrismaClientInitializationError || (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code))) {
          this.logger.warn('Account storage unavailable'); throw new ServiceUnavailableException('Account temporarily unavailable');
        }
        this.logger.error('Unexpected account update failure'); throw new InternalServerErrorException('Account update unavailable');
      }
    }
    throw new ConflictException('Account update conflicted; retry');
  }
}
