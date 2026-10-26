import { LoggerModule } from 'nestjs-pino';
import type { BaseConfig } from '../config/config';
import { traceLogFields } from '../telemetry/trace-context';
import { requestId } from './request-id';

/** Paths never written to logs (platform LLD §2). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'req.body',
  '*.email',
  '*.notes',
  '*.notesEnc',
  '*.freeText',
];

export function loggerModule(config: Pick<BaseConfig, 'LOG_LEVEL' | 'SERVICE_NAME' | 'NODE_ENV'>) {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: config.LOG_LEVEL,
      base: { service: config.SERVICE_NAME },
      // Every line logged inside a request or event handler carries its trace (platform LLD §2).
      mixin: traceLogFields,
      genReqId: requestId,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
      },
    },
  });
}
