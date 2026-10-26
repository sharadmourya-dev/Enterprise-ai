'use client';

import React from 'react';
import {
  Role,
  IAdminUserListItem,
  IPermissionMeta,
  ClearanceLevel,
} from '@enterprise-ai/shared-types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Skeleton,
} from '@/components/ui';
import {
  Users,
  Shield,
  Key,
  ChevronLeft,
  ChevronRight,
  Search,
  Lock,
  CheckCircle2,
  XCircle,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UserDirectoryTableProps {
  users: IAdminUserListItem[];
  isLoading: boolean;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onSelectUser: (user: IAdminUserListItem) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}

export function UserDirectoryTable({
  users,
  isLoading,
  total,
  page,
  limit,
  totalPages,
  onPageChange,
  onSelectUser,
  onResetFilters,
  hasActiveFilters,
}: UserDirectoryTableProps) {
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

  const getClearanceVariant = (
    clearance: ClearanceLevel
  ): 'default' | 'brand' | 'warning' | 'error' => {
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

  const startRecord = (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, total);

  return (
    <Card className="border border-border-default shadow-xs overflow-hidden">
      <CardHeader className="border-b border-border-subtle bg-surface-card px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-primary" />
            Enterprise User Directory
          </CardTitle>
          <CardDescription className="text-xs text-text-secondary">
            {total} total account{total === 1 ? '' : 's'} registered in directory
          </CardDescription>
        </div>

        {total > 0 && (
          <div className="text-xs text-text-secondary font-medium">
            Showing <span className="text-text-primary font-semibold">{startRecord}</span>–
            <span className="text-text-primary font-semibold">{endRecord}</span> of{' '}
            <span className="text-text-primary font-semibold">{total}</span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-4 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-2 border-b border-border-subtle/50">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-9 h-9 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="w-36 h-4 rounded" />
                    <Skeleton className="w-48 h-3 rounded" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="w-20 h-6 rounded" />
                  <Skeleton className="w-24 h-6 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-surface-elevated text-text-secondary mx-auto flex items-center justify-center">
              <Search className="w-6 h-6" />
            </div>
            <div className="text-base font-semibold text-text-primary">No users found</div>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">
              {hasActiveFilters
                ? 'No corporate accounts matched your search terms or filter criteria.'
                : 'No registered user accounts exist in the enterprise directory.'}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={onResetFilters} className="mt-2">
                Reset Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" id="user-directory-table">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-elevated/40 text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                  <th className="py-3 px-6">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Security Clearance</th>
                  <th className="py-3 px-4">Permissions</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-xs">
                {users.map((u) => {
                  const initials = u.name
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                  const activePermCount = u.permissions?.length || 0;
                  const effectiveCount = u.effectivePermissions?.length || 0;

                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-surface-elevated/50 transition-colors group"
                      id={`user-row-${u.id}`}
                    >
                      {/* Name & Email */}
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary font-semibold flex items-center justify-center text-xs ring-1 ring-border-default shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-text-primary truncate">
                              {u.name}
                            </div>
                            <div className="text-[11px] text-text-secondary truncate font-mono">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <Badge variant={getRoleVariant(u.role)} size="sm" className="capitalize">
                          {u.role.replace('_', ' ')}
                        </Badge>
                      </td>

                      {/* Department */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-medium text-text-primary text-xs">
                          {u.department}
                        </span>
                      </td>

                      {/* Security Clearance */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <Badge
                          variant={getClearanceVariant(u.securityClearance)}
                          size="sm"
                          className="capitalize"
                        >
                          {u.securityClearance}
                        </Badge>
                      </td>

                      {/* Permissions */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {u.permissions && u.permissions.length > 0 ? (
                            u.permissions.map((p) => (
                              <code
                                key={p}
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-brand-primary/10 border border-brand-primary/20 text-brand-primary font-medium"
                              >
                                {p}
                              </code>
                            ))
                          ) : (
                            <span className="text-[11px] text-text-secondary italic">
                              {u.role === Role.ADMIN || u.role === Role.SUPER_ADMIN
                                ? 'Full Admin Scope'
                                : 'Role Defaults Only'}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-status-success">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-status-error">
                            <XCircle className="w-3.5 h-3.5" />
                            Deactivated
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-6 text-right whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onSelectUser(u)}
                          leftIcon={<Key className="w-3.5 h-3.5 text-brand-primary" />}
                          className="text-xs font-medium"
                          id={`manage-perm-btn-${u.id}`}
                        >
                          Manage Permissions
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="border-t border-border-subtle px-6 py-3 bg-surface-card flex items-center justify-between gap-4">
            <div className="text-xs text-text-secondary">
              Page <span className="font-semibold text-text-primary">{page}</span> of{' '}
              <span className="font-semibold text-text-primary">{totalPages}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isLoading}
                onClick={() => onPageChange(page - 1)}
                leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                className="text-xs px-2.5"
                id="prev-page-btn"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isLoading}
                onClick={() => onPageChange(page + 1)}
                rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                className="text-xs px-2.5"
                id="next-page-btn"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
