import { colors, type ColorScheme, type Palette } from '@aura/ui-tokens';
import { useColorScheme } from 'react-native';
import { useMe } from './preferences';
import { schemeFor } from './settings/scheme';

/** The colour scheme in use: the user's saved theme, or the device's when it is `system`. */
export function useScheme(): ColorScheme {
  return schemeFor(useMe().theme, useColorScheme());
}

export function usePalette(): Palette {
  return colors[useScheme()];
}
