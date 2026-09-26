import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import { Shell } from '@/components/shell/Shell';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000'),
  ),
  title: { default: 'Nomad Loop Engine', template: '%s · Nomad Loop Engine' },
  description: 'Autonomous exploratory testing: explores web apps like a user, finds bugs, and writes reproducible Playwright tests.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f1ef' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Applies the saved theme before first paint, so a dark-theme viewer never sees a light flash.
const themeScript = `try{if(localStorage.getItem('nomad-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
