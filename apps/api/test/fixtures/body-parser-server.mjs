import 'reflect-metadata';
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

// Only this disposable module is loaded: no AppModule, database or background jobs.
class ParserProbeController {
  echo(body) { return body; }
  health() { return { status: 'ok' }; }
}
Controller('parser-probe')(ParserProbeController);
const prototype = ParserProbeController.prototype;
Post()(prototype, 'echo', Object.getOwnPropertyDescriptor(prototype, 'echo'));
HttpCode(200)(prototype, 'echo', Object.getOwnPropertyDescriptor(prototype, 'echo'));
Body()(prototype, 'echo', 0);
Get('health')(prototype, 'health', Object.getOwnPropertyDescriptor(prototype, 'health'));

class ParserProbeModule {}
Module({ controllers: [ParserProbeController] })(ParserProbeModule);

const app = await NestFactory.create(ParserProbeModule, { logger: false });
app.setGlobalPrefix('api/v1');
await app.listen(0, '127.0.0.1');

let shutdown;
function close() { return shutdown ??= app.close(); }
process.once('disconnect', () => { void close(); });
process.once('message', async (message) => {
  if (message !== 'shutdown') throw new Error('Unexpected fixture message');
  await close();
  if (process.connected) process.disconnect();
});
process.send({ port: app.getHttpServer().address().port });
