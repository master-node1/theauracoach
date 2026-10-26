'use client';

import { useEffect } from 'react';
import type { Theme } from '@aura/api-client';
import { applyTheme } from '@/lib/theme';

/** Applies the signed-in user's saved theme to the whole app. */
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => applyTheme(theme), [theme]);
  return null;
}
