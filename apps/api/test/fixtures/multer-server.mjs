import 'reflect-metadata';
import { Body, Controller, Get, HttpCode, Module, Post, UploadedFile, UploadedFiles, UseInterceptors, BadRequestException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

// Disposable loopback-only module: memory storage, no AppModule, database or jobs.
const filters = { pending: 0, completed: 0, rejected: 0 };
class UploadProbeController {
  single(file, body) {
    return { name: file.originalname, content: file.buffer.toString('utf8'), label: body.label };
  }
  race(files) { return { count: files.length }; }
  health() { return { status: 'ok', filters }; }
}
Controller('upload-probe')(UploadProbeController);
const prototype = UploadProbeController.prototype;
function decorate(method, decorators) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  for (const decorator of decorators) decorator(prototype, method, descriptor);
}
decorate('single', [Post('single'), HttpCode(200), UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 64, files: 1, fields: 1, parts: 2 },
}))]);
UploadedFile()(prototype, 'single', 0);
Body()(prototype, 'single', 1);
decorate('race', [Post('race'), HttpCode(200), UseInterceptors(FilesInterceptor('files', 2, {
  limits: { fileSize: 65_536, files: 2, parts: 3 },
  fileFilter(_request, file, callback) {
    if (file.originalname === 'pending.txt') {
      filters.pending++;
      setTimeout(() => { filters.completed++; callback(null, true); }, 150);
    } else {
      filters.rejected++;
      callback(new BadRequestException('Rejected test upload'));
    }
  },
}))]);
UploadedFiles()(prototype, 'race', 0);
decorate('health', [Get('health')]);

class UploadProbeModule {}
Module({ controllers: [UploadProbeController] })(UploadProbeModule);
const app = await NestFactory.create(UploadProbeModule, { logger: false, abortOnError: false });
app.setGlobalPrefix('api/v1');
await app.listen(0, '127.0.0.1');

let shutdown;
function close() { return shutdown ??= app.close(); }
process.once('disconnect', () => { void close(); });
process.once('message', async message => {
  if (message !== 'shutdown') throw new Error('Unexpected fixture message');
  await close();
  if (process.connected) process.disconnect();
});
process.send({ port: app.getHttpServer().address().port });
