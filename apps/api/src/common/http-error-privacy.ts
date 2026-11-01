import {
  type ArgumentsHost, BadRequestException, Catch, HttpException, Logger,
  PayloadTooLargeException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Install directly after the standard parsers, before routes. Parser messages can
// contain submitted JSON or header values; never forward their body/message/cause.
export function requestBodyErrorHandler(
  error: unknown, _request: IncomingMessage, _response: ServerResponse, next: (error: unknown) => void,
): void {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  switch (status) {
    case 400: next(new BadRequestException('Invalid request body')); return;
    case 413: next(new PayloadTooLargeException('Request body too large')); return;
    case 415: next(new UnsupportedMediaTypeException('Unsupported request body encoding')); return;
    default: next(error);
  }
}

@Catch()
export class PrivacyExceptionFilter extends BaseExceptionFilter<unknown> {
  private readonly diagnostic = new Logger('HttpErrors');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      // Existing application errors already define their public JSON contracts.
      super.catch(exception, host);
      return;
    }
    // Nest's default handler logs the full exception and trusts plain objects with
    // statusCode/message. Storage/provider errors can contain private input or SQL.
    this.diagnostic.error('Unhandled HTTP request failure');
    super.catch(new HttpException({ statusCode: 500, message: 'Internal server error' }, 500), host);
  }
}
