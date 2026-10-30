/**
 * Aura design tokens (docs/ux/design-system.md, approved designs in docs/ux/hifi-designs.md).
 * One source for both apps: the web turns them into CSS variables, mobile uses the constants.
 */

export const lightColors = {
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  'surface-2': '#F1F2EE',
  text: '#16181D',
  'text-muted': '#5B606B',
  primary: '#0E7C66',
  'on-primary': '#FFFFFF',
  'primary-soft': '#E2F1EC',
  accent: '#E07A2E',
  'accent-text': '#A4521A',
  'accent-soft': '#FBEBDD',
  protein: '#3D5AFE',
  carbs: '#C77800',
  fat: '#8E44AD',
  fibre: '#2E7D32',
  info: '#1565C0',
  'info-soft': '#E5EEF9',
  warning: '#9A6700',
  'warning-soft': '#FBF1D9',
  danger: '#B3261E',
  border: '#DADCD6',
} as const;

export type ColorToken = keyof typeof lightColors;
export type Palette = Record<ColorToken, string>;

export const darkColors: Palette = {
  bg: '#0F1115',
  surface: '#181B21',
  'surface-2': '#21252D',
  text: '#ECEDEF',
  'text-muted': '#A3A8B3',
  primary: '#38C6A5',
  'on-primary': '#06231D',
  'primary-soft': '#16302A',
  accent: '#F29A57',
  'accent-text': '#F29A57',
  'accent-soft': '#3A2A1D',
  protein: '#8C9EFF',
  carbs: '#FFB74D',
  fat: '#CE93D8',
  fibre: '#81C784',
  info: '#64B5F6',
  'info-soft': '#172434',
  warning: '#F2C94C',
  'warning-soft': '#2E2814',
  danger: '#F2B8B5',
  border: '#2E333C',
};

export const colors = { light: lightColors as Palette, dark: darkColors } as const;
export type ColorScheme = keyof typeof colors;

/** Android Material containers used for the FAB and the navigation-bar indicator. */
export const androidColors = {
  light: {
    'primary-container': '#A7EBD6',
    'on-primary-container': '#00201A',
    'nav-indicator': '#C3E9DD',
  },
  dark: {
    'primary-container': '#0F5244',
    'on-primary-container': '#A7EBD6',
    'nav-indicator': '#1F4A40',
  },
} as const;

export const font = {
  family: "Inter, 'Noto Sans Devanagari', system-ui, sans-serif",
  /** rem on web, multiply by 16 for points on mobile. */
  size: { display: 2, h1: 1.5, h2: 1.25, h3: 1.125, body: 1, small: 0.875, caption: 0.75 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' },
  lineHeight: { body: 1.4, heading: 1.2 },
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
export const radius = { input: 8, button: 12, card: 12, cardLg: 16, sheet: 22, pill: 999 } as const;
export const size = { touchTarget: 48, tabBar: 56 } as const;
export const motion = { microMs: 150, transitionMs: 250 } as const;
export const breakpoint = { tablet: 768, desktop: 1024, contentMax: 1200 } as const;

/**
 * CSS custom properties for the web: light by default, dark when the system asks for it, and
 * `data-theme` on <html> to force either.
 */
export function cssVariables(): string {
  const vars = (p: Palette) =>
    (Object.keys(p) as ColorToken[]).map((k) => `--color-${k}:${p[k]};`).join('');
  const base = `--font-sans:${font.family};--radius-card:${radius.card}px;--radius-card-lg:${radius.cardLg}px;--radius-button:${radius.button}px;--radius-input:${radius.input}px;--touch-target:${size.touchTarget}px;--content-max:${breakpoint.contentMax}px;`;
  return [
    `:root{${base}${vars(colors.light)}color-scheme:light;}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(colors.dark)}color-scheme:dark;}}`,
    `:root[data-theme="dark"]{${vars(colors.dark)}color-scheme:dark;}`,
  ].join('\n');
}

/** The five main tabs (docs/ux/information-architecture.md), with 24px stroke icon paths. */
export const tabs = [
  {
    id: 'today',
    label: 'Today',
    icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
  },
  { id: 'train', label: 'Train', icon: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12' },
  {
    id: 'eat',
    label: 'Eat',
    icon: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
  },
  { id: 'coach', label: 'Coach', icon: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' },
  { id: 'progress', label: 'Progress', icon: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6' },
] as const;
export type TabId = (typeof tabs)[number]['id'];

/** Admin console sections (web only), in sidebar order. */
export const adminSections = [
  'Dashboard',
  'Exercises',
  'Foods',
  'Recipes',
  'Templates',
  'Prompts',
  'Policies',
  'Review queue',
  'Feedback',
  'Users',
  'Usage and cost',
  'Audit log',
  'Roles',
  'Operations',
] as const;
