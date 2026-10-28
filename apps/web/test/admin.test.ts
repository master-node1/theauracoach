import { describe, expect, it } from 'vitest';
import { adminAccess, adminPathPermission, visibleAdminSections } from '../src/lib/admin-access';
import { parseGrafanaPanels } from '../src/lib/config';
import { formatValue, readableAction } from '../src/lib/format';

describe('admin page permissions', () => {
  it('maps each admin page to the permission its API needs', () => {
    expect(adminPathPermission('/admin')).toBeNull();
    expect(adminPathPermission('/admin/roles')).toBe('role:grant');
    expect(adminPathPermission('/admin/users/8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c')).toBe(
      'user:support_read',
    );
    expect(adminPathPermission('/admin/audit/12')).toBe('audit:read');
    expect(adminPathPermission('/admin/usage')).toBe('usage:read');
    expect(adminPathPermission('/admin/operations')).toBe('event:replay');
    expect(adminPathPermission('/admin/rolesx')).toBeNull();
  });

  it('lets support open users but not roles, and asks for MFA first', () => {
    const support = { groups: ['support'], mfa: true };
    expect(adminAccess(support, '/admin')).toBe('ok');
    expect(adminAccess(support, '/admin/users')).toBe('ok');
    expect(adminAccess(support, '/admin/roles')).toBe('forbidden');
    expect(adminAccess({ ...support, mfa: false }, '/admin/users')).toBe('mfa_required');
    expect(adminAccess({ groups: [], mfa: true }, '/admin')).toBe('forbidden');
    expect(adminAccess({ groups: ['owner'], mfa: true }, '/admin/operations')).toBe('ok');
  });

  it('shows Operations to owners only', () => {
    expect(visibleAdminSections(['owner'])).toContain('Operations');
    expect(visibleAdminSections(['support'])).toEqual(['Dashboard', 'Feedback', 'Users']);
  });
});

describe('Grafana panels', () => {
  it('keeps titled http(s) panels and drops anything else', () => {
    expect(
      parseGrafanaPanels(
        'Error rate|https://grafana.example/d-solo/a?panelId=1, Latency|https://grafana.example/d-solo/a?panelId=2,Bad|javascript:alert(1),NoTitle',
      ),
    ).toEqual([
      { title: 'Error rate', url: 'https://grafana.example/d-solo/a?panelId=1' },
      { title: 'Latency', url: 'https://grafana.example/d-solo/a?panelId=2' },
    ]);
    expect(parseGrafanaPanels(undefined)).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats support-view values', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('Yes');
    expect(formatValue(123456)).toBe('1,23,456');
    expect(formatValue('2026-10-27T10:43:09.000Z')).toBe('27 Oct 2026, 16:13 IST');
    expect(formatValue('ACTIVE')).toBe('ACTIVE');
    expect(readableAction('user.support_view')).toBe('User support view');
  });
});
