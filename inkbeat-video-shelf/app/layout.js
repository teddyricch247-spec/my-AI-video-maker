import './globals.css';

export const metadata = {
  title: 'Shorts shelf',
  description: 'Browse session folders, play parts in order, download, or delete saved videos from Supabase.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
