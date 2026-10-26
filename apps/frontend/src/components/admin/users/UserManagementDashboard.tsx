'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Role,
  IAdminUserListItem,
  IAdminUserListResponse,
  IPermissionMeta,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import {
  Button,
  Input,
  Badge,
  useToast,
} from '@/components/ui';
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  ShieldCheck,
  X,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { UserDirectoryTable } from './UserDirectoryTable';
import { UserPermissionModal } from './UserPermissionModal';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

export function UserManagementDashboard() {
  const { user: currentAdmin } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<IAdminUserListItem[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<IPermissionMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal State
  const [selectedUser, setSelectedUser] = useState<IAdminUserListItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchUsers = useCallback(
    async (currentPage = page, silent = false) => {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMessage(null);

      try {
        const params: Record<string, string | number> = {
          page: currentPage,
          limit,
        };

        if (search.trim()) params.search = search.trim();
        if (roleFilter) params.role = roleFilter;
        if (departmentFilter.trim()) params.department = departmentFilter.trim();

        const response = await ApiClient.get<IAdminUserListResponse>(
          '/admin/users',
          params
        );

        setUsers(response.users);
        setTotal(response.pagination.total);
        setTotalPages(response.pagination.totalPages);
        setPage(response.pagination.page);

        if (response.availablePermissions && response.availablePermissions.length > 0) {
          setAvailablePermissions(response.availablePermissions);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to retrieve user directory';
        setErrorMessage(msg);
        toast.error(msg, 'Directory Error');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [page, limit, search, roleFilter, departmentFilter, toast]
  );

  // Initial fetch and on filter/page change
  useEffect(() => {
    fetchUsers(page);
  }, [page, roleFilter, fetchUsers]);

  // Handle Search submit / Enter key
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchUsers(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setRoleFilter('');
    setDepartmentFilter('');
    setPage(1);
  };

  const hasActiveFilters = Boolean(search.trim() || roleFilter || departmentFilter.trim());

  const handleOpenModal = (user: IAdminUserListItem) => {
    setSelectedUser(user);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
  };

  const handlePermissionUpdateSuccess = (updatedUser: IAdminUserListItem) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === updatedUser.id ? updatedUser : u))
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border-subtle">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">
              User Directory &amp; Permission Administration
            </h1>
            <Badge variant="brand" className="text-xs">
              RBAC Governed
            </Badge>
          </div>
          <p className="text-sm text-text-secondary">
            Search corporate accounts, delegate system capabilities, and manage employee document upload permissions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUsers(page, true)}
            disabled={isLoading || isRefreshing}
            leftIcon={
              <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            }
            id="refresh-users-btn"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Advisory Notice */}
      <div className="p-4 rounded-xl border border-brand-primary/20 bg-brand-primary/5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0 mt-0.5">
          <Info className="w-4 h-4" />
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          <span className="font-semibold text-text-primary block mb-0.5">
            Permission Delegation Policy
          </span>
          Standard Employees granted <code className="px-1 py-0.5 rounded font-mono bg-canvas border border-border-default text-text-primary">documents:upload</code> immediately gain access to the Document Repository upload dialog, scoped strictly to their verified department. All permission adjustments are cryptographically signed into the HMAC audit trail.
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="p-4 rounded-xl border border-border-default bg-surface-card space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          {/* Search Input */}
          <div className="relative flex-1">
            <Input
              type="text"
              placeholder="Search by full name or corporate email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-text-secondary" />}
              className="text-xs h-10 w-full"
              id="user-search-input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary p-0.5"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Role Filter Dropdown */}
          <div className="w-full md:w-52">
            <select
              aria-label="Filter by Role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-lg border border-border-default bg-canvas text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary transition-all"
              id="role-filter-select"
            >
              <option value="">All Account Roles</option>
              <option value={Role.USER}>Employee (User)</option>
              <option value={Role.KNOWLEDGE_MANAGER}>Knowledge Manager</option>
              <option value={Role.COMPLIANCE_OFFICER}>Compliance Officer</option>
              <option value={Role.SUPPORT_AGENT}>Support Agent</option>
              <option value={Role.ADMIN}>Administrator</option>
              <option value={Role.SUPER_ADMIN}>Super Administrator</option>
            </select>
          </div>

          {/* Department Filter Input */}
          <div className="w-full md:w-48">
            <Input
              type="text"
              placeholder="Filter department..."
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="text-xs h-10 w-full"
              id="dept-filter-input"
            />
          </div>

          {/* Filter Actions */}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" className="h-10 px-4 text-xs font-semibold">
              Search
            </Button>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="h-10 px-3 text-xs"
              >
                Reset
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-status-error/30 bg-status-error/10 text-status-error text-xs font-medium flex items-start gap-2.5"
        >
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>{errorMessage}</div>
        </div>
      )}

      {/* Directory Table */}
      <UserDirectoryTable
        users={users}
        isLoading={isLoading}
        total={total}
        page={page}
        limit={limit}
        totalPages={totalPages}
        onPageChange={(p) => setPage(p)}
        onSelectUser={handleOpenModal}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Permission Edit Modal */}
      <UserPermissionModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        user={selectedUser}
        availablePermissions={availablePermissions}
        onSuccess={handlePermissionUpdateSuccess}
      />
    </div>
  );
}
