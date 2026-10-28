'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, ArrowLeft, KeyRound, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
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
import { ApiClient, ApiClientError } from '@/lib/api-client';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { success, error: showErrorToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError(null);

    if (!currentPassword) {
      setValidationError('Please enter your current password');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setValidationError('New password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setValidationError('New passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await ApiClient.post('/api/v1/auth/change-password', {
        currentPassword,
        newPassword,
      });

      setIsSuccess(true);
      success('Your password has been changed successfully. Active sessions were updated.', 'Password Changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        router.push('/profile');
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof ApiClientError ? err.message : 'Failed to change password. Please verify current credentials.';
      setValidationError(msg);
      showErrorToast(msg, 'Password Change Failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary hover:text-primary transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to User Profile</span>
          </Link>
        </div>

        {/* Change Password Card */}
        <Card className="border-subtle shadow-md">
          <CardHeader className="px-6 sm:px-8 pt-6 pb-2 border-b border-subtle">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-primary">
                  Change Corporate Password
                </CardTitle>
                <CardDescription className="text-xs text-secondary mt-0.5">
                  Update your authentication credentials. Passwords must be at least 8 characters.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          {!isSuccess ? (
            <form onSubmit={handleSubmit} noValidate>
              <CardContent className="space-y-4 px-6 sm:px-8 py-6">
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
                  label="Current Password"
                  type="password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  leftIcon={<Lock className="w-4 h-4" />}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                  id="current-password-input"
                />

                <Input
                  label="New Password (min 8 characters)"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  leftIcon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                  id="new-password-input"
                />

                <Input
                  label="Confirm New Password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  leftIcon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                  id="confirm-new-password-input"
                />
              </CardContent>

              <CardFooter className="flex items-center justify-between border-t border-subtle px-6 sm:px-8 py-4 bg-surface-elevated/30">
                <Link href="/profile">
                  <Button variant="outline" size="sm" type="button" disabled={isSubmitting}>
                    Cancel
                  </Button>
                </Link>

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  isLoading={isSubmitting}
                  leftIcon={<KeyRound className="w-4 h-4" />}
                  id="submit-change-password-btn"
                >
                  Update Password
                </Button>
              </CardFooter>
            </form>
          ) : (
            <div className="p-8 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-status-success/10 text-status-success flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-primary">Password Successfully Updated</h3>
              <p className="text-xs text-secondary max-w-sm mx-auto leading-relaxed">
                Your password change has been saved and older active sessions have been invalidated according to corporate security policy.
              </p>
              <Link href="/profile">
                <Button variant="primary" size="sm" className="mt-2">
                  Return to Profile
                </Button>
              </Link>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
