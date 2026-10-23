'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  useToast,
} from '@/components/ui';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { ApiClientError } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const { error: toastError, success: toastSuccess } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your corporate email address');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password');
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ email: trimmedEmail, password });
      toastSuccess('Authenticated successfully', 'Welcome back');
      router.push('/');
    } catch (err: unknown) {
      let displayMsg = 'Invalid email or password. Please try again.';
      if (err instanceof ApiClientError) {
        if (err.code === 'ACCOUNT_LOCKED') {
          displayMsg = 'Account temporarily locked due to consecutive failed attempts. Please retry later.';
        } else if (err.message && err.statusCode < 500) {
          displayMsg = err.message;
        }
      }
      setErrorMessage(displayMsg);
      toastError(displayMsg, 'Authentication Failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-6 lg:p-8 bg-canvas text-primary relative selection:bg-brand-primary/20 selection:text-brand-primary">
      {/* Subtle enterprise background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden flex items-center justify-center opacity-30 dark:opacity-20"
      >
        <div className="w-[640px] h-[420px] bg-brand-primary/20 blur-[130px] rounded-full -translate-y-20" />
      </div>

      {/* Header bar matching the UI reference */}
      <header className="relative z-10 max-w-5xl w-full mx-auto flex items-center justify-between py-2 sm:py-3">
        <Link
          href="/"
          className="flex items-center gap-3 text-primary hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-lg p-1 -ml-1"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white shadow-sm ring-1 ring-white/10 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-primary block leading-snug">
              Enterprise AI
            </span>
            <span className="text-[11px] font-medium text-secondary tracking-wider uppercase block leading-none">
              Knowledge Copilot
            </span>
          </div>
        </Link>
        <ThemeToggle variant="segmented" />
      </header>

      {/* Main authentication card */}
      <main className="relative z-10 max-w-[440px] w-full mx-auto my-auto py-6 sm:py-8">
        <Card variant="elevated" className="border-subtle shadow-xl dark:shadow-2xl/60 overflow-hidden relative">
          {/* Subtle top brand accent line */}
          <div className="h-1 w-full bg-gradient-to-r from-brand-primary/30 via-brand-accent to-brand-primary/30" />

          <CardHeader className="text-center pt-6 pb-4 px-6 sm:px-8 space-y-2">
            <div className="flex items-center justify-center">
              <Badge variant="accent" size="sm" icon={<ShieldCheck className="w-3.5 h-3.5 text-brand-accent" />}>
                SECURE AUTHENTICATION
              </Badge>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight text-primary">
              Sign In to Copilot
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-secondary leading-relaxed">
              Enter your corporate credentials to access authorized enterprise knowledge.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4 px-6 sm:px-8 pt-2 pb-6">
              {errorMessage && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs font-medium flex items-start gap-2.5 animate-fade-in"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 leading-relaxed">{errorMessage}</div>
                </div>
              )}

              <Input
                label="Corporate Email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                autoComplete="email"
                autoFocus
                required
                disabled={isSubmitting}
                className="dark:bg-[#0c1322] dark:border-[#1e2d47] dark:focus:border-brand-primary"
              />

              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                autoComplete="current-password"
                required
                disabled={isSubmitting}
                className="dark:bg-[#0c1322] dark:border-[#1e2d47] dark:focus:border-brand-primary"
              />
            </CardContent>

            <CardFooter className="flex-col gap-3.5 pt-0 px-6 sm:px-8 pb-6">
              <Button
                type="submit"
                variant="primary"
                className="w-full h-11 text-sm font-semibold shadow-sm hover:shadow-md active:scale-[0.99] transition-all"
                isLoading={isSubmitting}
                leftIcon={<LogIn className="w-4 h-4" />}
              >
                Sign In
              </Button>

              <div className="text-center text-xs text-secondary pt-1">
                Don&apos;t have an account yet?{' '}
                <Link
                  href="/register"
                  className="text-brand-primary font-semibold hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary rounded"
                >
                  Register Account
                </Link>
              </div>
            </CardFooter>
          </form>
        </Card>
      </main>

      {/* Footer bar */}
      <footer className="relative z-10 max-w-5xl w-full mx-auto py-3 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted border-t border-subtle/50">
        <div>Enterprise AI Knowledge Copilot &bull; Role-Based Clearance ACLs</div>
        <div className="flex items-center gap-1.5 text-secondary">
          <span className="w-2 h-2 rounded-full bg-status-success inline-block" />
          <span>System Active &bull; Multi-Tenant Isolated</span>
        </div>
      </footer>
    </div>
  );
}
