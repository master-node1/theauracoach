import type { Theme } from '@aura/api-client';
import type { ColorScheme } from '@aura/ui-tokens';

/** `system` follows the device; light and dark override it. */
export function schemeFor(theme: Theme, device: string | null | undefined): ColorScheme {
  if (theme === 'light' || theme === 'dark') return theme;
  return device === 'dark' ? 'dark' : 'light';
}
