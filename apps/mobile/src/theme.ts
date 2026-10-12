import { colors, type Palette } from '@aura/ui-tokens';
import { useColorScheme } from 'react-native';

export function usePalette(): Palette {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
