import { describe, expect, it } from 'vitest';
import { flagDefaults } from '../src/lib/features';
import { applyTheme } from '../src/lib/theme';

describe('feature flags', () => {
  it('falls back to settings on unless the environment switches it off', () => {
    expect(flagDefaults({}).settings_v1).toBe(true);
    expect(flagDefaults({ FEATURE_SETTINGS_V1: 'true' }).settings_v1).toBe(true);
    expect(flagDefaults({ FEATURE_SETTINGS_V1: 'false' }).settings_v1).toBe(false);
    expect(flagDefaults({ FEATURE_SETTINGS_V1: '0' }).settings_v1).toBe(false);
  });
});

describe('theme', () => {
  it('forces light or dark and lets system follow the device', () => {
    const root = { dataset: {} as DOMStringMap } as HTMLElement;
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
