'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, User, Building, UserPlus, ShieldCheck } from 'lucide-react';
import { Button, Input, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, useToast } from '@/components/ui';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { ApiClientError } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const { register, login, isAuthenticated, isLoading: authLoading } = useAuth();
  const { error: toastError, success: toastSuccess } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedDepartment = department.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setErrorMessage('Full name must be at least 2 characters long');
      return;
    }
    if (!trimmedEmail) {
      setErrorMessage('Please enter a valid corporate email address');
      return;
    }
    if (!trimmedDepartment || trimmedDepartment.length < 2) {
      setErrorMessage('Department is required (e.g. Engineering, Legal, Operations)');
      return;
    }
    if (!password || password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      // NOTE: Strictly passes email, password, name, department. No role/clearance escalation possible.
      await register({
        name: trimmedName,
        email: trimmedEmail,
        department: trimmedDepartment,
        password,
      });

      toastSuccess('Account created successfully. Signing in...', 'Welcome');

      // Auto login with new credentials
      await login({ email: trimmedEmail, password });
      router.push('/');
    } catch (err: unknown) {
      let displayMsg = 'Registration failed. Please check your information and try again.';
      if (err instanceof ApiClientError) {
        if (err.code === 'USER_EXISTS' || err.statusCode === 409) {
          displayMsg = 'An account with this email address already exists.';
        } else if (err.message && err.statusCode < 500) {
          displayMsg = err.message;
        }
      }
      setErrorMessage(displayMsg);
      toastError(displayMsg, 'Registration Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 md:p-8 bg-canvas text-primary">
      {/* Header bar */}
      <header className="flex items-center justify-between max-w-lg w-full mx-auto">
        <Link href="/" className="flex items-center gap-2.5 text-primary hover:opacity-90 transition-opacity">
          <div className="w-9 h-9 rounded-lg bg-brand-primary flex items-center justify-center text-white shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <span className="font-bold text-base tracking-tight">Enterprise AI</span>
        </Link>
        <ThemeToggle variant="cycle" />
      </header>

      {/* Main card */}
      <main className="max-w-lg w-full mx-auto my-6">
        <Card variant="elevated" className="border-subtle shadow-md">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl md:text-2xl font-bold">Create Corporate Account</CardTitle>
            <CardDescription>
              Register your employee profile to access role-authorized knowledge search.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-3.5">
              {errorMessage && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs font-medium"
                >
                  {errorMessage}
                </div>
              )}

              <Input
                label="Full Name"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                leftIcon={<User className="w-4 h-4" />}
                autoComplete="name"
                required
                disabled={isSubmitting}
              />

              <Input
                label="Corporate Email"
                type="email"
                placeholder="jane.doe@enterprise.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                autoComplete="email"
                required
                disabled={isSubmitting}
              />

              <Input
                label="Department"
                placeholder="Engineering, Finance, HR..."
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                leftIcon={<Building className="w-4 h-4" />}
                required
                disabled={isSubmitting}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Password (min 8 chars)"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftIcon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                />

                <Input
                  label="Confirm Password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  leftIcon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </CardContent>

            <CardFooter className="flex-col gap-3 pt-3">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={isSubmitting}
                leftIcon={<UserPlus className="w-4 h-4" />}
              >
                Register Account
              </Button>

              <div className="text-center text-xs text-secondary">
                Already registered?{' '}
                <Link
                  href="/login"
                  className="text-brand-primary font-semibold hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                >
                  Sign In
                </Link>
              </div>
            </CardFooter>
          </form>
        </Card>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-muted py-4">
        Default role is standard User with Internal security clearance. Privilege changes must be granted by an Administrator.
      </footer>
    </div>
  );
}
