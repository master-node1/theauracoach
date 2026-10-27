import { describe, expect, it } from 'vitest';
import { featureEnabled } from '../src/lib/features';
import { applyTheme } from '../src/lib/theme';

describe('feature flags', () => {
  it('turns settings on unless the environment switches it off', () => {
    expect(featureEnabled('SETTINGS_V1', {})).toBe(true);
    expect(featureEnabled('SETTINGS_V1', { FEATURE_SETTINGS_V1: 'true' })).toBe(true);
    expect(featureEnabled('SETTINGS_V1', { FEATURE_SETTINGS_V1: 'false' })).toBe(false);
    expect(featureEnabled('SETTINGS_V1', { FEATURE_SETTINGS_V1: '0' })).toBe(false);
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
