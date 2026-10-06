import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { isEmailSender } from '../config/environment.validation.js';

export const emailEligibleTypes = new Set([
  'APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'OFFER_CREATED',
  'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED',
]);
export const emailPayloadSchema = z.object({
  from: z.string().refine(isEmailSender),
  to: z.tuple([z.email()]),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(4000),
}).strict();
export type EmailPayload = z.infer<typeof emailPayloadSchema>;

export class EmailProviderError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    if (!/^(EMAIL|RESEND)_[A-Z0-9_]{1,65}$/.test(code)) throw new TypeError('Invalid email error code');
  }
}

const networkCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError) || !['fetch failed', 'terminated'].includes(error.message)) return false;
  const cause: unknown = error.cause;
  return typeof cause === 'object' && cause !== null && 'code' in cause &&
    typeof cause.code === 'string' && networkCodes.has(cause.code);
}

@Injectable()
export class ResendClient {
  async send(notificationId: string, payload: EmailPayload, apiKey: string, timeoutMs: number): Promise<string> {
    if (!z.uuid().safeParse(notificationId).success || !/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey) || !emailPayloadSchema.safeParse(payload).success) {
      throw new EmailProviderError('EMAIL_CONFIGURATION_INVALID', false);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `citajusta-email/${notificationId}` },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        let body: unknown;
        try { body = await response.json(); } catch (error) {
          if (controller.signal.aborted) throw error;
          if (!(error instanceof SyntaxError)) throw error;
          throw new EmailProviderError('RESEND_INVALID_RESPONSE', true);
        }
        const parsed = z.object({ id: z.uuid() }).safeParse(body);
        if (!parsed.success) throw new EmailProviderError('RESEND_INVALID_RESPONSE', true);
        return parsed.data.id;
      }
      if (response.status === 409) {
        let body: unknown;
        try { body = await response.json(); } catch (error) {
          if (controller.signal.aborted) throw error;
          if (!(error instanceof SyntaxError)) throw error;
        }
        const name = typeof body === 'object' && body !== null && 'name' in body ? body.name : undefined;
        if (name === 'concurrent_idempotent_requests') throw new EmailProviderError('RESEND_CONCURRENT_IDEMPOTENT_REQUESTS', true);
        throw new EmailProviderError(name === 'invalid_idempotent_request' ? 'RESEND_INVALID_IDEMPOTENT_REQUEST' : 'RESEND_HTTP_409', false);
      }
      const retryable = response.status === 408 || response.status === 429 || (response.status >= 500 && response.status <= 599);
      throw new EmailProviderError(`RESEND_HTTP_${response.status}`, retryable);
    } catch (error) {
      if (controller.signal.aborted && error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
        throw new EmailProviderError('RESEND_TIMEOUT', true);
      }
      if (isNetworkError(error)) throw new EmailProviderError('RESEND_NETWORK_ERROR', true);
      throw error; // Programming/storage errors are not provider retries.
    } finally {
      clearTimeout(timer);
    }
  }
}
