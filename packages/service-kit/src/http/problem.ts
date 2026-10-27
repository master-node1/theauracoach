import { HttpException, HttpStatus } from '@nestjs/common';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
  /** RFC 9457 extension members, e.g. `purpose` on CONSENT_REQUIRED. */
  [extension: string]: unknown;
}

const PROBLEM_BASE = 'https://docs.auracoach.app/problems/';

/** An error that renders as RFC 9457 problem details with a stable machine-readable code. */
export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    title: string,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
    /** Extra members for the problem document. Ids and codes only, never user text. */
    readonly extensions?: Record<string, string>,
  ) {
    super(title, status);
  }
}

export function problemType(code: string): string {
  return PROBLEM_BASE + code.toLowerCase().replace(/_/g, '-');
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'UNAVAILABLE',
};

export function defaultCode(status: number): string {
  return DEFAULT_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'ERROR');
}
