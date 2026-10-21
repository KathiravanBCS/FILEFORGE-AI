import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
import '../styles/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import { AppProvider } from '../providers/app-provider';
export const metadata: Metadata = {
  title: { default: 'FileForge AI — Turn cards into connections', template: '%s · FileForge AI' },
  description:
    'A private, organized workspace for business cards, contacts, and intelligent document processing.',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
