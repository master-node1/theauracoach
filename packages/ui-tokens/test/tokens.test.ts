import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colors, cssVariables, lightColors } from '../src';

const DESIGN_TOKENS = join(__dirname, '../../../docs/ux/tokens.json');

/** WCAG relative luminance contrast ratio. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('ui tokens', () => {
  it('light and dark define the same tokens', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it.each(['light', 'dark'] as const)('%s body text meets WCAG AA on every surface', (scheme) => {
    const p = colors[scheme];
    for (const bg of [p.bg, p.surface, p['surface-2']]) {
      expect(contrast(p.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p['text-muted'], bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(p['on-primary'], p.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('emits CSS variables for both schemes', () => {
    const css = cssVariables();
    expect(css).toContain('--color-primary:#0E7C66;');
    expect(css).toContain('--color-primary:#38C6A5;');
    expect(css).toContain('prefers-color-scheme: dark');
  });

  it.skipIf(!existsSync(DESIGN_TOKENS))('matches docs/ux/tokens.json', () => {
    const design = JSON.parse(readFileSync(DESIGN_TOKENS, 'utf8'));
    expect(colors.light).toEqual(design.color.light);
    expect(colors.dark).toEqual(design.color.dark);
  });
});
