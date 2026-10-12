import type { Metadata, Viewport } from 'next';
import { cssVariables } from '@aura/ui-tokens';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AuraCoach', template: '%s · AuraCoach' },
  description: 'Your trainer and nutrition coach, any time.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

const tokens = cssVariables();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <style id="aura-tokens">{tokens}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
