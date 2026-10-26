// Telemetry first: it must load before http, express, ioredis and Prisma.
import '@aura/service-kit/telemetry/register';
import 'reflect-metadata';
import { bootstrapHttp } from '@aura/service-kit';
import { AppModule } from './app.module';
import { loadServiceConfig } from './config';

const config = loadServiceConfig();
void bootstrapHttp(AppModule.register(config), config.PORT);
