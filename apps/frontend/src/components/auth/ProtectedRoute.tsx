'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';
import { useAuth } from '@/context/AuthContext';
import { Skeleton, Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '@/components/ui';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

export interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: Role[];
  adminOnly?: boolean;
  requiredClearance?: ClearanceLevel;
  fallbackUrl?: string;
}

export function ProtectedRoute({
  children,
  requiredRoles,
  adminOnly = false,
  requiredClearance,
  fallbackUrl = '/login',
}: ProtectedRouteProps) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, hasRole, hasClearance, isAdmin } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(fallbackUrl);
    }
  }, [isLoading, isAuthenticated, router, fallbackUrl]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6 animate-pulse" aria-busy="true">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  // Admin access check: Strictly require Role.ADMIN or Role.SUPER_ADMIN
  if (adminOnly && !isAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-status-error/30">
          <CardHeader>
            <div className="w-12 h-12 rounded-xl bg-status-error/10 text-status-error flex items-center justify-center mb-2">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <CardTitle>Administrative Access Denied</CardTitle>
            <CardDescription>
              This section is restricted to authorized System Administrators and Super Administrators.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted">
              Your current profile role: <span className="font-semibold text-primary">{user.role}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => router.push('/')}
            >
              Return to Knowledge Portal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Role list verification
  if (requiredRoles && requiredRoles.length > 0 && !hasRole(...requiredRoles)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-status-warning/30">
          <CardHeader>
            <div className="w-12 h-12 rounded-xl bg-status-warning/10 text-status-warning flex items-center justify-center mb-2">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <CardTitle>Insufficient Role Permissions</CardTitle>
            <CardDescription>
              You do not possess the required role permissions to view this resource.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted">
              Required roles: <span className="font-semibold text-primary">{requiredRoles.join(', ')}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => router.push('/')}
            >
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Security Clearance verification
  if (requiredClearance && !hasClearance(requiredClearance)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-status-warning/30">
          <CardHeader>
            <div className="w-12 h-12 rounded-xl bg-status-warning/10 text-status-warning flex items-center justify-center mb-2">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <CardTitle>Security Clearance Restricted</CardTitle>
            <CardDescription>
              Your security clearance is insufficient to access this classified resource.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted">
              Minimum clearance required: <span className="font-semibold text-primary">{requiredClearance}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => router.push('/')}
            >
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
