import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { defaultCode, ProblemDetails, ProblemException, problemType } from './problem';

/** Renders every error as application/problem+json. Never leaks stack traces or internal messages. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl ?? req.url;
    if (req.id) problem.requestId = String(req.id);
    if (problem.status >= 500) this.logger.error({ err: exception }, 'Unhandled error');
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      const status = exception.getStatus();
      return {
        type: problemType(exception.code),
        title: String(exception.message),
        status,
        code: exception.code,
        ...(exception.detail ? { detail: exception.detail } : {}),
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    }
    if (exception instanceof ZodError) {
      return {
        type: problemType('VALIDATION_FAILED'),
        title: 'Request validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        errors: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = defaultCode(status);
      return {
        type: problemType(code),
        title: status >= 500 ? 'Internal error' : titleFor(exception),
        status,
        code,
      };
    }
    return {
      type: problemType('INTERNAL'),
      title: 'Internal error',
      status: 500,
      code: 'INTERNAL',
    };
  }
}

function titleFor(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return exception.message;
}
