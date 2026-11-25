import './globals.css';

export const metadata = {
  title: 'Inkbeat video shelf',
  description: 'Choose between 3D Cartoon and 2D Paper Motion styles, browse session folders, play parts in order, or download saved videos.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
