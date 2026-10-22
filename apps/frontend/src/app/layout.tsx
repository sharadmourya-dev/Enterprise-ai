import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider, ThemeScript } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/context/AuthContext';

export const metadata: Metadata = {
  title: 'Enterprise AI Knowledge & Support Copilot',
  description:
    'Secure, role-authorized enterprise knowledge search and support copilot with verifiable citations and audit tracking.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-canvas text-primary antialiased">
        <ThemeProvider defaultTheme="system">
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
