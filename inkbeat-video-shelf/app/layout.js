import './globals.css';

export const metadata = {
  title: 'Shorts shelf',
  description: 'Play and download the cartoon Shorts your agent has rendered.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
