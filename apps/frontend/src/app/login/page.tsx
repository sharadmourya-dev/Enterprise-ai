'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn, ShieldCheck } from 'lucide-react';
import { Button, Input, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, useToast } from '@/components/ui';
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
    <div className="min-h-screen flex flex-col justify-between p-4 md:p-8 bg-canvas text-primary">
      {/* Header bar with theme switcher */}
      <header className="flex items-center justify-between max-w-md w-full mx-auto">
        <Link href="/" className="flex items-center gap-2.5 text-primary hover:opacity-90 transition-opacity">
          <div className="w-9 h-9 rounded-lg bg-brand-primary flex items-center justify-center text-white shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <span className="font-bold text-base tracking-tight">Enterprise AI</span>
        </Link>
        <ThemeToggle variant="cycle" />
      </header>

      {/* Main card */}
      <main className="max-w-md w-full mx-auto my-8">
        <Card variant="elevated" className="border-subtle shadow-md">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl md:text-2xl font-bold">Sign In to Copilot</CardTitle>
            <CardDescription>
              Enter your corporate credentials to access authorized enterprise knowledge.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              {errorMessage && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs font-medium"
                >
                  {errorMessage}
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
              />
            </CardContent>

            <CardFooter className="flex-col gap-3 pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={isSubmitting}
                leftIcon={<LogIn className="w-4 h-4" />}
              >
                Sign In
              </Button>

              <div className="text-center text-xs text-secondary">
                Don&apos;t have an account yet?{' '}
                <Link
                  href="/register"
                  className="text-brand-primary font-semibold hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                >
                  Register
                </Link>
              </div>
            </CardFooter>
          </form>
        </Card>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-muted py-4">
        Enterprise AI Knowledge &amp; Support Copilot &bull; Protected by strict RBAC and Clearance ACLs
      </footer>
    </div>
  );
}
