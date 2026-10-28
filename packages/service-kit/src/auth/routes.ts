import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

/** Joins controller and handler paths the way Nest does, e.g. `/v1/admin/roles/:userId`. */
export function joinRoutePath(controllerPath: unknown, handlerPath: unknown): string {
  const first = (p: unknown) => (Array.isArray(p) ? String(p[0] ?? '') : String(p ?? ''));
  const joined = `/${first(controllerPath)}/${first(handlerPath)}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/** The declared path of a route handler, read from its decorators rather than the request URL. */
export function routePath(controller: Type<unknown>, handler: object): string {
  return joinRoutePath(
    Reflect.getMetadata(PATH_METADATA, controller),
    Reflect.getMetadata(PATH_METADATA, handler),
  );
}

export function routeMethod(handler: object): string {
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
  return method === undefined ? 'GET' : RequestMethod[method];
}

/** Admin API routes need MFA and declared permissions (auth LLD §4). */
export function isAdminPath(path: string): boolean {
  return path === '/v1/admin' || path.startsWith('/v1/admin/');
}
