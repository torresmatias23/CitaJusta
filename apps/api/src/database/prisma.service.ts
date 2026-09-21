import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown
{
  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      }),
    });
  }

  // Disconnect after runners have drained their work during onModuleDestroy.
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
