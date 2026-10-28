import { describe, expect, it } from 'vitest';
import {
  adminOpsPath,
  auditEventV1,
  auditQuerySchema,
  dlqReplaySchema,
  maskEmail,
  opsServiceOf,
  permissionsFor,
  redactAuditValue,
  roleGrantSchema,
} from '../src';

describe('maskEmail', () => {
  it('keeps enough to confirm a caller and hides the rest', () => {
    expect(maskEmail('priya.sharma@example.com')).toBe('pr***@e***.com');
    expect(maskEmail('ab@gmail.co.in')).toBe('a***@g***.in');
    expect(maskEmail('a@x.org')).toBe('a***@x***.org');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('redactAuditValue', () => {
  it('removes sensitive keys at any depth and keeps ids and codes', () => {
    expect(
      redactAuditValue({
        userId: 'u1',
        email: 'x@example.com',
        nested: { healthNotes: 'knee', role: 'support' },
        list: [{ token: 't' }],
      }),
    ).toEqual({
      userId: 'u1',
      email: '[removed]',
      nested: { healthNotes: '[removed]', role: 'support' },
      list: [{ token: '[removed]' }],
    });
    expect(redactAuditValue(null)).toBeNull();
  });
});

describe('audit query', () => {
  it('defaults to newest first, 50 per page', () => {
    expect(auditQuerySchema.parse({})).toEqual({ order: 'desc', limit: 50 });
  });

  it('accepts filters and refuses bad ones', () => {
    expect(
      auditQuerySchema.parse({ action: 'role', from: '2026-10-27T00:00:00.000+05:30', limit: '5' }),
    ).toMatchObject({ action: 'role', limit: 5 });
    expect(() => auditQuerySchema.parse({ actorId: 'nope' })).toThrow();
    expect(() => auditQuerySchema.parse({ cursor: '1; DROP' })).toThrow();
    expect(() => auditQuerySchema.parse({ limit: '1000' })).toThrow();
    expect(() => auditQuerySchema.parse({ unknown: 'x' })).toThrow();
  });
});

describe('admin operations', () => {
  it('maps services to their ops paths', () => {
    expect(opsServiceOf('notification-service')).toBe('notification');
    expect(adminOpsPath('workout')).toBe('/v1/admin/ops/workout');
  });

  it('needs a reason to replay', () => {
    expect(() => dlqReplaySchema.parse({})).toThrow();
    expect(() => dlqReplaySchema.parse({ reason: ' x ' })).toThrow();
    expect(dlqReplaySchema.parse({ reason: ' fixed consumer ' })).toEqual({
      reason: 'fixed consumer',
    });
  });

  it('gives event:replay to owners only', () => {
    expect(permissionsFor(['owner']).has('event:replay')).toBe(true);
    expect(permissionsFor(['support']).has('event:replay')).toBe(false);
  });

  it('carries an optional reason on role grants and audit events', () => {
    expect(
      roleGrantSchema.parse({ email: 'a@example.com', role: 'support', reason: 'new hire' }),
    ).toMatchObject({ reason: 'new hire' });
    const audit = {
      actorId: null,
      actorRole: 'owner',
      action: 'event.replay',
      entityType: 'dead_letter',
      entityId: 'coach:1-0',
      before: null,
      after: null,
      requestId: null,
    };
    expect(auditEventV1.parse(audit)).toEqual(audit);
    expect(auditEventV1.parse({ ...audit, reason: 'fixed' }).reason).toBe('fixed');
  });
});
