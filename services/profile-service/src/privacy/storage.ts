import type { Provider } from '@nestjs/common';
import { SERVICE_KIT_CONFIG, createObjectStorage } from '@aura/service-kit';
import type { ServiceConfig } from '../config';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** S3 in AWS, a local directory in development (OBJECT_STORAGE). */
export const objectStorageProvider: Provider = {
  provide: OBJECT_STORAGE,
  useFactory: (config: ServiceConfig) => createObjectStorage(config),
  inject: [SERVICE_KIT_CONFIG],
};
