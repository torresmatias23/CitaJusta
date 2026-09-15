import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AgendaController } from './agenda.controller.js';
import { AgendaService } from './agenda.service.js';

@Module({ imports: [AuthModule, AuthorizationModule, DatabaseModule], controllers: [AgendaController], providers: [AgendaService] })
export class AgendaModule {}
