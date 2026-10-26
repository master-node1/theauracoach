import type { Theme } from '@aura/api-client';

/** Applies a theme preference: `system` follows the device, the others force it (ui-tokens cssVariables). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
