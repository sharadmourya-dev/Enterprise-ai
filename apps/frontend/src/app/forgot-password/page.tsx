'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, ShieldCheck, CheckCircle2, AlertCircle, Send } from 'lucide-react';
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

export default function ForgotPasswordPage() {
  const { success, error: showErrorToast } = useToast();

  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Please enter your corporate email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setValidationError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);
    try {
      await ApiClient.post('/api/v1/auth/forgot-password', { email: trimmedEmail });
      setIsSubmitted(true);
      success(
        'If an account exists with that email address, password reset instructions have been sent.',
        'Request Received'
      );
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.statusCode === 503) {
        showErrorToast(
          err.message || 'Password reset service is temporarily unavailable. Please try again later.',
          'Service Unavailable'
        );
      } else if (err instanceof ApiClientError && (err.code === 'NETWORK_ERROR' || err.statusCode === 0)) {
        showErrorToast(
          'Unable to reach authentication server. Please check your network connection or try again.',
          'Connection Error'
        );
      } else {
        // Generic non-enumerating confirmation for non-existent accounts or standard responses
        setIsSubmitted(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

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

      {/* Main card */}
      <main className="relative z-10 w-full max-w-md mx-auto my-auto py-8">
        <Card className="border border-subtle shadow-xl backdrop-blur-md bg-surface/90">
          <CardHeader className="text-center px-6 sm:px-8 pt-6 pb-2">
            <div className="w-12 h-12 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center mx-auto mb-3">
              <Mail className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-primary">
              Reset Your Password
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-secondary leading-relaxed">
              Enter your corporate email address. If an active account exists, password recovery instructions will be issued.
            </CardDescription>
          </CardHeader>

          {!isSubmitted ? (
            <form onSubmit={handleSubmit} noValidate>
              <CardContent className="space-y-4 px-6 sm:px-8 pt-2 pb-6">
                {validationError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs font-medium flex items-start gap-2.5 animate-fade-in"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex-1 leading-relaxed">{validationError}</div>
                  </div>
                )}

                <Input
                  label="Corporate Email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  leftIcon={<Mail className="w-4 h-4" />}
                  autoComplete="email"
                  autoFocus
                  required
                  disabled={isSubmitting}
                  id="forgot-password-email-input"
                />
              </CardContent>

              <CardFooter className="flex-col gap-3.5 pt-0 px-6 sm:px-8 pb-6">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full h-11 text-sm font-semibold shadow-sm hover:shadow-md active:scale-[0.99] transition-all"
                  isLoading={isSubmitting}
                  leftIcon={<Send className="w-4 h-4" />}
                  id="forgot-password-submit-btn"
                >
                  Send Recovery Link
                </Button>

                <div className="text-center text-xs text-secondary pt-1">
                  Remember your password?{' '}
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
                  <span>Request Received</span>
                </div>
                <p className="leading-relaxed text-secondary">
                  If an account associated with <strong className="text-primary font-mono">{email}</strong> exists in our directory, password reset instructions have been sent.
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-subtle bg-surface-elevated/50 text-[11px] text-muted space-y-1 leading-relaxed">
                <p className="font-semibold text-secondary">Password Recovery Notice:</p>
                <p>
                  Single-use cryptographic reset tokens expire in 15 minutes. If you do not see the recovery email in your inbox within a few minutes, check your spam folder or contact your administrator.
                </p>
              </div>

              <Link href="/login" className="block pt-2">
                <Button variant="outline" className="w-full h-10 text-xs font-semibold">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                  Return to Sign In
                </Button>
              </Link>
            </div>
          )}
        </Card>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-5xl w-full mx-auto text-center py-4 text-xs text-muted">
        Enterprise AI Knowledge & Support Copilot &bull; Authenticated Directory Services
      </footer>
    </div>
  );
}
