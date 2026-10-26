'use client';

import React, { useState, useEffect } from 'react';
import {
  Role,
  Permission,
  IAdminUserListItem,
  IPermissionMeta,
  ROLE_PERMISSIONS,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import {
  Modal,
  ModalFooter,
  Button,
  Badge,
  useToast,
} from '@/components/ui';
import {
  Shield,
  ShieldAlert,
  Lock,
  Check,
  AlertTriangle,
  AlertCircle,
  Info,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

export interface UserPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: IAdminUserListItem | null;
  availablePermissions: IPermissionMeta[];
  onSuccess: (updatedUser: IAdminUserListItem) => void;
}

export function UserPermissionModal({
  isOpen,
  onClose,
  user,
  availablePermissions,
  onSuccess,
}: UserPermissionModalProps) {
  const { user: currentAdmin } = useAuth();
  const toast = useToast();

  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSensitiveWarning, setShowSensitiveWarning] = useState(false);

  // Initialize selected permissions when user changes
  useEffect(() => {
    if (user) {
      setSelectedPermissions(user.permissions as Permission[]);
      setShowSensitiveWarning(false);
      setErrorMessage(null);
    }
  }, [user]);

  if (!user) return null;

  const isSelf = currentAdmin?.id === user.id;
  const isSuperAdminCaller = currentAdmin?.role === Role.SUPER_ADMIN;
  const isTargetAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
  const isRestrictedTarget = isTargetAdmin && !isSuperAdminCaller;
  const canModify = !isSelf && !isRestrictedTarget;

  // Determine if a permission is inherited by role
  const isRoleInherited = (permId: Permission): boolean => {
    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return true;
    }
    const roleDefaults = ROLE_PERMISSIONS[user.role] || [];
    return roleDefaults.includes(permId);
  };

  const handleToggle = (permId: Permission) => {
    if (!canModify || isRoleInherited(permId)) return;
    setErrorMessage(null);

    setSelectedPermissions((prev) => {
      const exists = prev.includes(permId);
      const next = exists ? prev.filter((p) => p !== permId) : [...prev, permId];

      // Check if newly toggled item is sensitive
      const meta = availablePermissions.find((p) => p.id === permId);
      if (meta?.isSensitive) {
        setShowSensitiveWarning(true);
      }

      return next;
    });
  };

  const handleSave = async () => {
    if (!canModify) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await ApiClient.patch<IAdminUserListItem>(
        `/admin/users/${user.id}/permissions`,
        { permissions: selectedPermissions }
      );

      toast.success(
        `Permissions for ${user.name} have been updated successfully.`,
        'Permissions Saved'
      );
      onSuccess(response);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update permissions';
      setErrorMessage(msg);
      toast.error(msg, 'Permission Update Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (isSubmitting) return;
    setErrorMessage(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      preventClose={isSubmitting}
      size="lg"
      title="Manage User Permissions"
      description="Grant or revoke explicitly assigned system capabilities for this account."
    >
      <div className="space-y-6">
        {/* User Card Summary */}
        <div className="p-4 rounded-xl border border-border-default bg-surface-elevated flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-primary/15 text-brand-primary font-semibold flex items-center justify-center text-sm ring-2 ring-white/10 shrink-0">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-text-primary text-sm">{user.name}</div>
              <div className="text-xs text-text-secondary font-mono">{user.email}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="brand" size="sm" className="capitalize">
              {user.role.replace('_', ' ')}
            </Badge>
            <Badge variant="outline" size="sm">
              {user.department}
            </Badge>
            <Badge variant="default" size="sm" className="capitalize">
              {user.securityClearance}
            </Badge>
          </div>
        </div>

        {/* Self Modification Warning */}
        {isSelf && (
          <div
            role="alert"
            className="p-3.5 rounded-lg border border-status-warning/30 bg-status-warning/10 text-status-warning text-xs font-medium flex items-start gap-2.5"
          >
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Self-Modification Prohibited</span>
              Administrators cannot grant or revoke their own permissions. Please ask another privileged administrator.
            </div>
          </div>
        )}

        {/* Admin Hierarchy Warning */}
        {isRestrictedTarget && (
          <div
            role="alert"
            className="p-3.5 rounded-lg border border-status-warning/30 bg-status-warning/10 text-status-warning text-xs font-medium flex items-start gap-2.5"
          >
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Super Admin Elevation Required</span>
              Only Super Administrators have authority to modify permissions on Administrator or Super Administrator accounts.
            </div>
          </div>
        )}

        {/* Permissions List */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Configurable Permissions
          </div>

          <div className="divide-y divide-border-subtle rounded-xl border border-border-default overflow-hidden bg-surface-card">
            {availablePermissions.map((perm) => {
              const inherited = isRoleInherited(perm.id);
              const isChecked = inherited || selectedPermissions.includes(perm.id);
              const isSensitive = perm.isSensitive;

              return (
                <div
                  key={perm.id}
                  className={cn(
                    'p-4 flex items-start justify-between gap-4 transition-colors',
                    inherited ? 'bg-surface-elevated/40' : 'hover:bg-surface-elevated/60',
                    !canModify && 'opacity-70 cursor-not-allowed'
                  )}
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">
                        {perm.label}
                      </span>
                      <code className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-canvas border border-border-default text-text-secondary">
                        {perm.id}
                      </code>
                      {inherited && (
                        <Badge variant="brand" size="sm" className="gap-1 py-0 h-5 text-[10px]">
                          <Lock className="w-2.5 h-2.5" />
                          Role Default
                        </Badge>
                      )}
                      {isSensitive && (
                        <Badge variant="warning" size="sm" className="gap-1 py-0 h-5 text-[10px]">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Sensitive
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {perm.description}
                    </p>
                    {inherited && (
                      <p className="text-[11px] text-brand-primary flex items-center gap-1 font-medium">
                        <Info className="w-3 h-3" />
                        Granted unconditionally by role policy for {user.role.replace('_', ' ')}.
                      </p>
                    )}
                  </div>

                  {/* Toggle / Switch */}
                  <div className="shrink-0 pt-1">
                    {inherited ? (
                      <div className="w-9 h-5 rounded-full bg-brand-primary/40 flex items-center px-0.5 cursor-not-allowed justify-end">
                        <div className="w-4 h-4 rounded-full bg-brand-primary shadow-xs flex items-center justify-center text-white text-[10px]">
                          <Check className="w-2.5 h-2.5" />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isChecked}
                        aria-label={`Toggle permission: ${perm.label} (${perm.id})`}
                        disabled={!canModify}
                        onClick={() => handleToggle(perm.id)}
                        className={cn(
                          'w-10 h-6 rounded-full transition-colors relative flex items-center p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                          isChecked ? 'bg-brand-primary' : 'bg-surface-elevated border border-border-default',
                          !canModify && 'opacity-60 cursor-not-allowed'
                        )}
                      >
                        <span
                          className={cn(
                            'w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center text-brand-primary text-[10px]',
                            isChecked ? 'translate-x-4' : 'translate-x-0'
                          )}
                        >
                          {isChecked && <Check className="w-3 h-3 text-brand-primary" />}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error Alert Notice */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs font-medium flex items-start gap-2.5 animate-fade-in"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block">Update Failed</span>
              {errorMessage}
            </div>
          </div>
        )}

        {/* Sensitive Change Advisory Notice */}
        {showSensitiveWarning && (
          <div className="p-3.5 rounded-lg border border-status-warning/30 bg-status-warning/10 text-status-warning text-xs font-medium flex items-start gap-2.5 animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block">Sensitive Permission Update</span>
              You have modified sensitive access permissions. All additions and revocations are cryptographically recorded into the immutable audit hash chain.
            </div>
          </div>
        )}

        <ModalFooter className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!canModify || isSubmitting}
            isLoading={isSubmitting}
            leftIcon={<UserCheck className="w-4 h-4" />}
            id="save-permissions-btn"
          >
            Save Permissions
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
