import 'reflect-metadata';
import { bootstrapHttp } from '@aura/service-kit';
import { AppModule } from './app.module';
import { loadServiceConfig } from './config';

const config = loadServiceConfig();
void bootstrapHttp(AppModule.register(config), config.PORT);
