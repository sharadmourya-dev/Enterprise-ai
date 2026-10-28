'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Lock, ArrowLeft, ShieldCheck, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react';
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  useToast,
} from '@/components/ui';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { ApiClient, ApiClientError } from '@/lib/api-client';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { success, error: showErrorToast } = useToast();

  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!token) {
      setErrorMessage('Reset token is missing from the URL. Please request a new recovery link.');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await ApiClient.post('/api/v1/auth/reset-password', {
        token: token.trim(),
        newPassword,
      });
      setIsSuccess(true);
      success('Your password has been reset successfully.', 'Password Updated');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof ApiClientError ? err.message : 'Invalid or expired password reset token';
      setErrorMessage(msg);
      showErrorToast(msg, 'Reset Failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border border-subtle shadow-xl backdrop-blur-md bg-surface/90">
      <CardHeader className="text-center px-6 sm:px-8 pt-6 pb-2">
        <div className="w-12 h-12 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center mx-auto mb-3">
          <KeyRound className="w-6 h-6" />
        </div>
        <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-primary">
          Create New Password
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm text-secondary leading-relaxed">
          Enter your new password below to restore access to your account.
        </CardDescription>
      </CardHeader>

      {!isSuccess ? (
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4 px-6 sm:px-8 pt-2 pb-6">
            {!token && (
              <div
                role="alert"
                className="p-3.5 rounded-lg border border-status-warning/30 bg-status-warning/10 text-status-warning text-xs font-medium flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">
                  No recovery token detected in URL query parameter. Please request a new reset link.
                </div>
              </div>
            )}

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
              label="New Password (min 8 characters)"
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              leftIcon={<Lock className="w-4 h-4" />}
              autoComplete="new-password"
              required
              disabled={isSubmitting || !token}
              id="reset-new-password-input"
            />

            <Input
              label="Confirm New Password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              leftIcon={<Lock className="w-4 h-4" />}
              autoComplete="new-password"
              required
              disabled={isSubmitting || !token}
              id="reset-confirm-password-input"
            />
          </CardContent>

          <CardFooter className="flex-col gap-3.5 pt-0 px-6 sm:px-8 pb-6">
            <Button
              type="submit"
              variant="primary"
              className="w-full h-11 text-sm font-semibold shadow-sm hover:shadow-md active:scale-[0.99] transition-all"
              isLoading={isSubmitting}
              disabled={!token}
              id="reset-password-submit-btn"
            >
              Update Password
            </Button>

            <div className="text-center text-xs text-secondary pt-1">
              <Link
                href="/login"
                className="font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary rounded"
              >
                Back to Sign In
              </Link>
            </div>
          </CardFooter>
        </form>
      ) : (
        <div className="px-6 sm:px-8 py-6 space-y-4">
          <div className="p-4 rounded-xl border border-status-success/30 bg-status-success/10 text-xs text-primary space-y-2">
            <div className="flex items-center gap-2 font-semibold text-status-success">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Password Changed Successfully</span>
            </div>
            <p className="leading-relaxed text-secondary">
              Your password has been updated and prior sessions were securely invalidated. Redirecting to sign in...
            </p>
          </div>

          <Link href="/login" className="block pt-2">
            <Button variant="primary" className="w-full h-10 text-xs font-semibold">
              Go to Sign In
            </Button>
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-6 lg:p-8 bg-canvas text-primary relative selection:bg-brand-primary/20 selection:text-brand-primary">
      {/* Background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden flex items-center justify-center opacity-30 dark:opacity-20"
      >
        <div className="w-[640px] h-[420px] bg-brand-primary/20 blur-[130px] rounded-full -translate-y-20" />
      </div>

      {/* Header bar */}
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
        <ThemeToggle />
      </header>

      {/* Main card wrapped in Suspense for searchParams */}
      <main className="relative z-10 w-full max-w-md mx-auto my-auto py-8">
        <Suspense fallback={<Card className="p-8 text-center text-xs text-muted">Loading reset interface...</Card>}>
          <ResetPasswordForm />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-5xl w-full mx-auto text-center py-4 text-xs text-muted">
        Enterprise AI Knowledge & Support Copilot &bull; Authenticated Directory Services
      </footer>
    </div>
  );
}
