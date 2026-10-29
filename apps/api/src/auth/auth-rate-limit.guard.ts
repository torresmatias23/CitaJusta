import { applyDecorators, HttpException, HttpStatus, Injectable, SetMetadata, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import type { AuthRateLimitOperation } from './auth-rate-limit.policy.js';

const operationMetadata = Symbol('auth-rate-limit-operation');

function equivalentAddress(address: string): string {
  // Normalize the IPv4-mapped representation commonly returned by dual-stack sockets.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
  return mapped && isIP(mapped[1]) === 4 ? mapped[1] : address.toLowerCase();
}

/**
 * A forwarded address is useful only if the *TCP peer* is an authorized proxy.
 * Nginx overwrites X-Forwarded-For with a single address in this deployment.
 * Untrusted peers and malformed headers always fall back to the socket peer.
 */
export function authRateLimitClientAddress(
  peer: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxyAddresses: readonly string[],
): string | undefined {
  if (!peer || !isIP(peer)) return peer;
  const matches = trustedProxyAddresses.some(address =>
    isIP(address) !== 0 && equivalentAddress(address) === equivalentAddress(peer));
  if (!matches || typeof forwardedFor !== 'string' || forwardedFor !== forwardedFor.trim() || !isIP(forwardedFor)) {
    return peer;
  }
  return forwardedFor;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly trustedProxyHost: string | undefined;
  private cachedProxyAddresses: readonly string[] = [];
  private cachedUntil = 0;
  private resolvingProxy: Promise<readonly string[]> | undefined;

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: AuthRateLimitService,
    config: ConfigService,
  ) {
    this.trustedProxyHost = config.get<string>('AUTH_RATE_LIMIT_TRUSTED_PROXY_HOST');
  }

  private async trustedProxyAddresses(): Promise<readonly string[]> {
    if (!this.trustedProxyHost) return [];
    if (Date.now() < this.cachedUntil) return this.cachedProxyAddresses;
    // The Compose service 'web' may start after the API. Re-resolve briefly so
    // container replacement is handled without fixed Docker IP assumptions.
    this.resolvingProxy ??= lookup(this.trustedProxyHost, { all: true })
      .then(records => records.map(record => record.address))
      .catch(() => [])
      .finally(() => { this.resolvingProxy = undefined; });
    const addresses = await this.resolvingProxy;
    this.cachedProxyAddresses = addresses;
    this.cachedUntil = Date.now() + (addresses.length ? 5000 : 1000);
    return addresses;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation = this.reflector.get<AuthRateLimitOperation>(operationMetadata, context.getHandler());
    if (!operation) throw new Error('Missing authentication rate limit policy');
    const http = context.switchToHttp();
    const request = http.getRequest<IncomingMessage>();
    const address = authRateLimitClientAddress(
      request.socket.remoteAddress,
      request.headers['x-forwarded-for'],
      await this.trustedProxyAddresses(),
    );
    const decision = await this.limiter.consume(operation, address);
    if (!decision.allowed) {
      const response = http.getResponse<ServerResponse>();
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      response.setHeader('Cache-Control', 'no-store');
      throw new HttpException('Too many authentication requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

export function AuthRateLimit(operation: AuthRateLimitOperation) {
  return applyDecorators(SetMetadata(operationMetadata, operation), UseGuards(AuthRateLimitGuard));
}
