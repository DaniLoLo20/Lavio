import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'Lavio - Control inteligente para tu autolavado', template: '%s · Lavio' },
  description: 'Lavio: control inteligente para tu autolavado. Órdenes, clientes, inventario y reportes desde cualquier dispositivo.',
  applicationName: 'Lavio',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Lavio', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#1d7df0', width: 'device-width', initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem('al_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
