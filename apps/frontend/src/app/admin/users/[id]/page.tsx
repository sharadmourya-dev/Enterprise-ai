'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  User,
  Mail,
  Building,
  Shield,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Key,
  Calendar,
  Lock,
  Layers,
  Power,
} from 'lucide-react';
import {
  Role,
  ClearanceLevel,
  IAdminUserListItem,
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
  Modal,
  ModalFooter,
  Skeleton,
  useToast,
} from '@/components/ui';
import { ApiClient, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { formatUploadedDate } from '@/components/documents/DocumentList';

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user: currentUser, isAdmin } = useAuth();
  const { success, error: showErrorToast, info } = useToast();

  const id = typeof params?.id === 'string' ? params.id : '';

  const [targetUser, setTargetUser] = useState<IAdminUserListItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Status Change Modal
  const [isStatusModalOpen, setIsStatusModalOpen] = useState<boolean>(false);
  const [isSubmittingStatus, setIsSubmittingStatus] = useState<boolean>(false);

  const isSelf = currentUser?.id === id;

  const fetchUserDetails = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setErrorStatus(null);
    setErrorMessage(null);

    try {
      const data = await ApiClient.get<IAdminUserListItem>(`/api/v1/admin/users/${id}`);
      setTargetUser(data);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setErrorStatus(err.statusCode);
        setErrorMessage(err.message);
      } else {
        setErrorStatus(500);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to retrieve employee record');
      }
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchUserDetails();
  }, [fetchUserDetails]);

  const handleToggleStatus = async () => {
    if (!targetUser || isSubmittingStatus) return;

    if (isSelf && targetUser.isActive) {
      showErrorToast('Administrators cannot deactivate their own accounts', 'Self-Deactivation Blocked');
      setIsStatusModalOpen(false);
      return;
    }

    setIsSubmittingStatus(true);
    const newStatus = !targetUser.isActive;

    try {
      const updated = await ApiClient.patch<IAdminUserListItem>(
        `/api/v1/admin/users/${id}/status`,
        { isActive: newStatus }
      );
      setTargetUser(updated);
      success(
        `Account for "${updated.name}" is now ${newStatus ? 'Active' : 'Deactivated'}.`,
        'Status Updated'
      );
      setIsStatusModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update employee account status';
      showErrorToast(msg, 'Status Update Failed');
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  const getRoleVariant = (role: Role): 'brand' | 'default' | 'outline' | 'warning' | 'error' => {
    switch (role) {
      case Role.SUPER_ADMIN:
        return 'error';
      case Role.ADMIN:
        return 'brand';
      case Role.KNOWLEDGE_MANAGER:
        return 'warning';
      case Role.COMPLIANCE_OFFICER:
        return 'outline';
      default:
        return 'default';
    }
  };

  const getClearanceVariant = (clearance: ClearanceLevel): 'default' | 'brand' | 'warning' | 'error' => {
    switch (clearance) {
      case ClearanceLevel.RESTRICTED:
        return 'error';
      case ClearanceLevel.CONFIDENTIAL:
        return 'warning';
      case ClearanceLevel.INTERNAL:
        return 'brand';
      default:
        return 'default';
    }
  };

  return (
    <AppShell adminOnly>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary hover:text-primary transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to User Directory</span>
          </Link>

          {targetUser && (
            <Button
              variant="outline"
              size="sm"
              onClick={fetchUserDetails}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              className="text-xs"
            >
              Refresh
            </Button>
          )}
        </div>

        {/* Loading State */}
        {isLoading && !targetUser && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-64 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          </div>
        )}

        {/* Error State */}
        {errorStatus && (
          <Card className="border-status-error/30 bg-status-error/5 p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-status-error/10 text-status-error flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-primary">
              {errorStatus === 404 ? 'Employee Not Found' : 'Unable to Load Employee Details'}
            </h2>
            <p className="text-xs text-secondary max-w-md mx-auto">
              {errorMessage || 'The requested user profile does not exist or access was denied.'}
            </p>
            <Link href="/admin/users">
              <Button variant="outline" size="sm" className="mt-2">
                Return to User Directory
              </Button>
            </Link>
          </Card>
        )}

        {/* Loaded Profile View */}
        {targetUser && (
          <div className="space-y-6">
            {/* Header Identity Card */}
            <div className="p-6 rounded-2xl border border-subtle bg-surface-elevated/40 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold text-xl border border-brand-primary/20 shrink-0">
                  {targetUser.name
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary truncate">
                      {targetUser.name}
                    </h1>
                    <Badge variant={getRoleVariant(targetUser.role)} size="sm" className="capitalize">
                      {targetUser.role.replace('_', ' ')}
                    </Badge>
                    <Badge variant={getClearanceVariant(targetUser.securityClearance)} size="sm">
                      {targetUser.securityClearance}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted font-mono">
                    <Mail className="w-3.5 h-3.5" />
                    <span>{targetUser.email}</span>
                  </div>
                </div>
              </div>

              {/* Status Indicator & Action Trigger */}
              <div className="flex items-center gap-3 self-start sm:self-center">
                <div className="text-right sm:block hidden">
                  <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                    Account Status
                  </div>
                  <div className="flex items-center justify-end gap-1.5 mt-0.5">
                    {targetUser.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success">
                        <CheckCircle2 className="w-4 h-4" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-error">
                        <XCircle className="w-4 h-4" />
                        Deactivated
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  variant={targetUser.isActive ? 'outline' : 'primary'}
                  size="md"
                  onClick={() => setIsStatusModalOpen(true)}
                  disabled={isSelf && targetUser.isActive}
                  leftIcon={<Power className="w-4 h-4" />}
                  id="toggle-user-status-btn"
                  className={targetUser.isActive ? 'text-status-error border-status-error/30 hover:bg-status-error/10' : ''}
                >
                  {targetUser.isActive ? 'Deactivate Account' : 'Activate Account'}
                </Button>
              </div>
            </div>

            {/* Self-Deactivation Guard Banner */}
            {isSelf && (
              <div className="p-3.5 rounded-xl border border-status-warning/30 bg-status-warning/10 text-status-warning flex items-center gap-2.5 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  You are currently logged in as this administrator. Self-deactivation is disabled to prevent accidental administrative lockout.
                </span>
              </div>
            )}

            {/* Grid Information Panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Profile Details */}
              <Card className="border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <User className="w-4 h-4 text-brand-primary" />
                    Employee Profile
                  </CardTitle>
                  <CardDescription className="text-xs text-secondary">
                    Core organizational identifiers and account lifecycle metadata.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3.5 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-subtle">
                    <span className="text-muted flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5" />
                      Department
                    </span>
                    <span className="font-semibold text-primary">{targetUser.department}</span>
                  </div>

                  <div className="flex items-center justify-between pb-2 border-b border-subtle">
                    <span className="text-muted flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Account ID
                    </span>
                    <span className="font-mono text-[11px] text-secondary">{targetUser.id}</span>
                  </div>

                  <div className="flex items-center justify-between pb-2 border-b border-subtle">
                    <span className="text-muted flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      Registration Date
                    </span>
                    <span className="text-secondary">{formatUploadedDate(targetUser.createdAt)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Last Record Update
                    </span>
                    <span className="text-secondary">{formatUploadedDate(targetUser.updatedAt)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Permissions & Security */}
              <Card className="border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-brand-primary" />
                    Security & Permissions
                  </CardTitle>
                  <CardDescription className="text-xs text-secondary">
                    Clearance hierarchy and effective permission grants.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3.5 text-xs">
                  <div>
                    <span className="text-muted text-[11px] font-semibold uppercase tracking-wider block mb-1.5">
                      Assigned Security Clearance
                    </span>
                    <Badge variant={getClearanceVariant(targetUser.securityClearance)} size="md">
                      {targetUser.securityClearance}
                    </Badge>
                  </div>

                  <div>
                    <span className="text-muted text-[11px] font-semibold uppercase tracking-wider block mb-1.5">
                      Explicitly Granted Permissions ({targetUser.permissions?.length || 0})
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {targetUser.permissions && targetUser.permissions.length > 0 ? (
                        targetUser.permissions.map((p) => (
                          <code
                            key={p}
                            className="px-2 py-0.5 rounded text-[11px] font-mono bg-brand-primary/10 border border-brand-primary/20 text-brand-primary font-medium"
                          >
                            {p}
                          </code>
                        ))
                      ) : (
                        <span className="text-muted italic">No individual permissions assigned</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-muted text-[11px] font-semibold uppercase tracking-wider block mb-1.5">
                      Effective Permission Scope
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {targetUser.role === Role.ADMIN || targetUser.role === Role.SUPER_ADMIN ? (
                        <Badge variant="brand" size="sm">
                          Full Administrative Scope
                        </Badge>
                      ) : (
                        (targetUser.effectivePermissions || []).map((p, idx) => (
                          <code
                            key={`eff-${idx}-${p}`}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-elevated border border-subtle text-secondary"
                          >
                            {p}
                          </code>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        <Modal
          isOpen={isStatusModalOpen}
          onClose={() => !isSubmittingStatus && setIsStatusModalOpen(false)}
          preventClose={isSubmittingStatus}
          title={targetUser?.isActive ? 'Confirm Account Deactivation' : 'Confirm Account Activation'}
          description={
            targetUser?.isActive
              ? `Are you sure you want to deactivate the account for "${targetUser?.name}" (${targetUser?.email})? Active sessions will be terminated and the user will not be able to log in.`
              : `Are you sure you want to activate the account for "${targetUser?.name}" (${targetUser?.email})? The user will be permitted to authenticate and access the copilot.`
          }
          size="md"
        >
          <ModalFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsStatusModalOpen(false)}
              disabled={isSubmittingStatus}
            >
              Cancel
            </Button>
            <Button
              variant={targetUser?.isActive ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleStatus}
              isLoading={isSubmittingStatus}
              id="confirm-toggle-status-btn"
            >
              {targetUser?.isActive ? 'Confirm Deactivation' : 'Confirm Activation'}
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </AppShell>
  );
}
