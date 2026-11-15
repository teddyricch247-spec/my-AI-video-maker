import { Plus_Jakarta_Sans } from 'next/font/google';
import Shell from '@/components/Shell';
import './globals.css';
import './pages.css';

const font = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font', display: 'swap' });

export const metadata = { title: { default: 'vbeat', template: '%s · vbeat' }, description: 'Turn a narration into a finished video, beat by beat.' };
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F6F7FB' }, { media: '(prefers-color-scheme: dark)', color: '#0F1224' }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={font.variable}>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
