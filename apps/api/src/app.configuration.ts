import { RequestMethod, type INestApplication } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PrivacyExceptionFilter, requestBodyErrorHandler } from './common/http-error-privacy.js';

export function configureApplication(app: INestApplication): void {
  const express: { disable(setting: string): void } = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');

  // Register before Nest's parsers/guards so their error responses keep the headers.
  app.use((_request: IncomingMessage, response: ServerResponse, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  // Current versioned routes handle credentials or require authentication,
  // including institutional catalogs. Health and static resources are outside it.
  app.use('/api/v1', (_request: IncomingMessage, response: ServerResponse, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Same Express JSON/urlencoded parsers and default limits as Nest's init.
  // Register now to place the sanitizing error middleware before Nest maps errors.
  // Nest detects these parsers during init and does not register them twice.
  const adapter = app.getHttpAdapter();
  adapter.registerParserMiddleware('', false);
  app.use(requestBodyErrorHandler);
  app.useGlobalFilters(new PrivacyExceptionFilter(adapter));

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
}
