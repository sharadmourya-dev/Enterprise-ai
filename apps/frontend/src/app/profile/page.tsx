'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  User,
  Mail,
  Building,
  Shield,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  KeyRound,
  LogOut,
  ArrowRight,
  MessageSquare,
  FileText,
  RefreshCw,
  Clock,
  Layers,
} from 'lucide-react';
import {
  Role,
  ClearanceLevel,
  ISafeUser,
} from '@enterprise-ai/shared-types';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Skeleton,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { ApiClient } from '@/lib/api-client';
import { formatUploadedDate } from '@/components/documents/DocumentList';

export default function ProfilePage() {
  const { user, role, clearance, isAdmin, logout } = useAuth();
  const { success, info } = useToast();

  const [profile, setProfile] = useState<ISafeUser | null>(user);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Optionally fetch fresh profile data on mount
  useEffect(() => {
    let isMounted = true;

    async function loadFreshProfile() {
      if (!user) return;
      setIsLoading(true);
      try {
        const data = await ApiClient.get<ISafeUser>('/api/v1/auth/me');
        if (isMounted && data) {
          setProfile(data);
        }
      } catch {
        // Fallback to auth context cached user
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadFreshProfile();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleRefreshProfile = async () => {
    setIsLoading(true);
    try {
      const data = await ApiClient.get<ISafeUser>('/api/v1/auth/me');
      if (data) {
        setProfile(data);
        success('User credentials refreshed successfully');
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    info('You have been logged out safely', 'Session Ended');
  };

  const activeUser = profile || user;

  const getClearanceDescription = (level?: ClearanceLevel | null) => {
    switch (level) {
      case ClearanceLevel.RESTRICTED:
        return 'Restricted: Highest tier authorization. Grants full access to highly confidential documents and executive corporate records.';
      case ClearanceLevel.CONFIDENTIAL:
        return 'Confidential: Advanced authorization. Permits viewing confidential company-wide and departmental intelligence.';
      case ClearanceLevel.INTERNAL:
      default:
        return 'Internal: Standard enterprise access to operational guidelines, team documentation, and public knowledge.';
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary">
                User Profile &amp; Clearance
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-secondary">
              Review your enterprise identity, assigned security clearance, and access entitlements.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshProfile}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-4 h-4" />}
              id="profile-refresh-btn"
              data-testid="profile-refresh-btn"
            >
              Refresh Credentials
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              leftIcon={<LogOut className="w-4 h-4" />}
              className="text-secondary hover:text-status-error"
              id="profile-logout-btn"
              data-testid="profile-logout-btn"
            >
              Sign Out
            </Button>
          </div>
        </div>

        {/* Profile Content */}
        {isLoading && !activeUser ? (
          <div className="space-y-6">
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        ) : !activeUser ? (
          <Card className="p-8 text-center border-subtle max-w-md mx-auto space-y-3">
            <User className="w-10 h-10 text-muted mx-auto" />
            <h3 className="text-base font-semibold text-primary">No Active Profile</h3>
            <p className="text-xs text-secondary">Please sign in to view your user profile and security credentials.</p>
            <Link href="/login">
              <Button variant="primary" size="sm">
                Sign In
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* User Identity Banner Card */}
            <Card className="border-subtle bg-gradient-to-r from-surface to-surface-elevated overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* User Avatar */}
                  <div className="w-16 h-16 rounded-2xl bg-brand-primary/15 border border-brand-primary/25 text-brand-primary flex items-center justify-center font-bold text-2xl shadow-inner shrink-0">
                    {activeUser.name ? activeUser.name.charAt(0).toUpperCase() : 'U'}
                  </div>

                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg sm:text-xl font-bold text-primary truncate" id="profile-user-name">
                        {activeUser.name}
                      </h2>
                      <Badge variant="success" size="sm">
                        Active Account
                      </Badge>
                      {isAdmin && (
                        <Badge variant="brand" size="sm">
                          Administrator
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-secondary flex items-center gap-1.5 font-mono truncate" id="profile-user-email">
                      <Mail className="w-3.5 h-3.5 text-muted shrink-0" />
                      {activeUser.email}
                    </p>
                    <p className="text-xs text-muted flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5 text-muted shrink-0" />
                      Department: <strong className="text-primary font-medium">{activeUser.department}</strong>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Grid: Account Details & Security Clearance */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Account Details */}
              <Card className="border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <User className="w-4 h-4 text-brand-primary" />
                    Account Details
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Verified enterprise identity properties
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-1.5 border-b border-subtle">
                      <span className="text-muted font-medium">User Identifier</span>
                      <span className="font-mono text-primary truncate max-w-[180px]">{activeUser.id}</span>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-subtle">
                      <span className="text-muted font-medium">Assigned Role</span>
                      <Badge variant={isAdmin ? 'brand' : 'default'} size="sm">
                        {activeUser.role}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between py-1.5 border-b border-subtle">
                      <span className="text-muted font-medium">Department</span>
                      <span className="font-semibold text-primary">{activeUser.department}</span>
                    </div>

                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-muted font-medium">Account Created</span>
                      <span className="text-primary">{formatUploadedDate(typeof activeUser.createdAt === 'string' ? activeUser.createdAt : new Date(activeUser.createdAt).toISOString())}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-4 px-6 border-t border-subtle">
                  <Link href="/profile/change-password" className="w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      leftIcon={<KeyRound className="w-3.5 h-3.5 text-brand-primary" />}
                      id="profile-change-password-btn"
                    >
                      Change Password
                    </Button>
                  </Link>
                </CardFooter>
              </Card>

              {/* Security Clearance & Authorization */}
              <Card className="border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-brand-primary" />
                    Security Clearance
                  </CardTitle>
                  <CardDescription className="text-xs">
                    RAG retrieval and knowledge base scope governance
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-surface-elevated border border-subtle space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted font-medium">Clearance Level</span>
                      <Badge
                        variant={
                          activeUser.securityClearance === ClearanceLevel.RESTRICTED
                            ? 'error'
                            : activeUser.securityClearance === ClearanceLevel.CONFIDENTIAL
                            ? 'info'
                            : 'default'
                        }
                        size="md"
                        id="profile-clearance-badge"
                      >
                        {(activeUser.securityClearance || 'INTERNAL').toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-secondary leading-relaxed">
                      {getClearanceDescription(activeUser.securityClearance)}
                    </p>
                  </div>

                  <div>
                    <span className="text-muted font-medium block mb-2">Granted Granular Permissions</span>
                    {activeUser.permissions && activeUser.permissions.length > 0 ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {activeUser.permissions.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-brand-primary/10 text-brand-primary border border-brand-primary/20"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-secondary font-medium">Role Default Permissions</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Workspace Quick Actions */}
              <Card className="md:col-span-2 border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-primary" />
                    Workspace Navigation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Link
                      href="/chat"
                      className="p-3.5 rounded-xl border border-subtle bg-surface-elevated hover:border-brand-primary/40 hover:bg-surface-elevated/80 transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5">
                        <MessageSquare className="w-4 h-4 text-brand-primary" />
                        <span className="text-xs font-semibold text-primary">Copilot Chat</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
                    </Link>

                    <Link
                      href="/documents"
                      className="p-3.5 rounded-xl border border-subtle bg-surface-elevated hover:border-brand-primary/40 hover:bg-surface-elevated/80 transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5">
                        <FileText className="w-4 h-4 text-brand-primary" />
                        <span className="text-xs font-semibold text-primary">Documents</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
                    </Link>

                    {isAdmin ? (
                      <Link
                        href="/documents"
                        className="p-3.5 rounded-xl border border-subtle bg-surface-elevated hover:border-brand-primary/40 hover:bg-surface-elevated/80 transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2.5">
                          <ShieldCheck className="w-4 h-4 text-brand-primary" />
                          <span className="text-xs font-semibold text-primary">Document Repository</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    ) : (
                      <Link
                        href="/"
                        className="p-3.5 rounded-xl border border-subtle bg-surface-elevated hover:border-brand-primary/40 hover:bg-surface-elevated/80 transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-brand-primary" />
                          <span className="text-xs font-semibold text-primary">Overview Dashboard</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
