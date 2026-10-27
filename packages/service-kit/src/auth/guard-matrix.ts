import type { INestApplicationContext, Type } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { REQUIRED_CONSENT } from './consent.guard';
import { INTERNAL_CALLERS, PUBLIC_ROUTE } from './decorators';
import { REQUIRED_PERMISSIONS } from './permissions.guard';
import { isAdminPath, routeMethod, routePath } from './routes';

/** How one route is protected, read from its decorators. */
export interface GuardMatrixRow {
  route: string;
  access: 'public' | 'internal' | 'user';
  /** Set when a route carries both @Public and @InternalOnly. */
  conflicting: boolean;
  callers: string[];
  permissions: string[];
  consent: string | null;
}

function metadata<T>(key: string, handler: object, controller: Type<unknown>): T | undefined {
  return (
    (Reflect.getMetadata(key, handler) as T | undefined) ?? Reflect.getMetadata(key, controller)
  );
}

/** Every route of a Nest app with its guard metadata (auth LLD §6: guard matrix from route metadata). */
export function describeRoutes(app: INestApplicationContext): GuardMatrixRow[] {
  const rows: GuardMatrixRow[] = [];
  const seen = new Set<Type<unknown>>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (!controller || seen.has(controller)) continue;
      seen.add(controller);
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const isPublic = metadata<boolean>(PUBLIC_ROUTE, handler, controller) === true;
        const callers = metadata<string[]>(INTERNAL_CALLERS, handler, controller);
        rows.push({
          route: `${routeMethod(handler)} ${routePath(controller, handler)}`,
          access: callers ? 'internal' : isPublic ? 'public' : 'user',
          conflicting: isPublic && !!callers,
          callers: callers ?? [],
          permissions: metadata<string[]>(REQUIRED_PERMISSIONS, handler, controller) ?? [],
          consent: metadata<string>(REQUIRED_CONSENT, handler, controller) ?? null,
        });
      }
    }
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Rules every service's routes must follow. Returns one message per broken rule, so a test can
 * `expect(violations).toEqual([])` and show exactly which route is wrong.
 * `publicRoutes` lists the routes that may be @Public, e.g. `GET /health/live`; any other public
 * route is a violation, so adding an unguarded route fails the test until it is reviewed.
 */
export function guardMatrixViolations(
  rows: GuardMatrixRow[],
  options: { publicRoutes: string[] },
): string[] {
  const allowedPublic = new Set(options.publicRoutes);
  const problems: string[] = [];
  for (const row of rows) {
    const path = row.route.slice(row.route.indexOf(' ') + 1);
    const fail = (rule: string) => problems.push(`${row.route}: ${rule}`);
    if (row.conflicting) fail('is both @Public and @InternalOnly');
    if (row.access === 'public' && !allowedPublic.has(row.route)) {
      fail('is @Public but not in the reviewed list of public routes');
    }
    if (row.access === 'internal' && row.callers.length === 0) {
      fail('is @InternalOnly with no allowed callers');
    }
    const internalPath = path === '/internal' || path.startsWith('/internal/');
    if (internalPath && row.access !== 'internal') fail('is under /internal but not @InternalOnly');
    if (row.access === 'internal' && !path.startsWith('/internal/v1/')) {
      fail('is @InternalOnly but not under /internal/v1');
    }
    if (isAdminPath(path)) {
      if (row.access !== 'user') fail('is an admin route but does not take a user token');
      if (row.permissions.length === 0) fail('is an admin route without @Permissions');
    }
    if (row.access !== 'user' && row.permissions.length > 0) {
      fail('has @Permissions but no user token to check them against');
    }
    if (row.access !== 'user' && row.consent) {
      fail('has @RequiresConsent but no user token to check it against');
    }
  }
  for (const route of allowedPublic) {
    if (!rows.some((r) => r.route === route && r.access === 'public')) {
      problems.push(`${route}: listed as public but no such public route exists`);
    }
  }
  return problems;
}

/** The public routes every service has from service-kit. */
export const SERVICE_KIT_PUBLIC_ROUTES = ['GET /health/live', 'GET /health/ready'];
