'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AuditAction,
  AuditResourceType,
  IAuditLog,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Skeleton,
  useToast,
} from '@/components/ui';
import {
  History,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  User,
  Server,
  FileText,
  MessageSquare,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Download,
  ShieldAlert,
  ArrowRight,
  Shield,
  Clock,
  Fingerprint,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuditSummaryCards } from './AuditSummaryCards';

interface AuditLogResponse {
  logs: IAuditLog[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Human-readable action translation dictionary
 */
function getActionHumanTitle(action: string): string {
  switch (action) {
    case AuditAction.AUTH_LOGIN:
      return 'User Authentication Succeeded';
    case AuditAction.AUTH_LOGOUT:
      return 'User Session Terminated';
    case AuditAction.AUTH_FAILED_LOGIN:
      return 'Failed Authentication Attempt';
    case AuditAction.AUTH_TOKEN_REFRESH:
      return 'Session Access Token Refreshed';
    case AuditAction.AUTH_TOKEN_REVOKED:
      return 'Session Access Token Revoked';
    case AuditAction.DOC_UPLOAD:
      return 'Document Ingestion / Upload Processed';
    case AuditAction.DOC_DELETE:
      return 'Document Purged & Vectors Removed';
    case AuditAction.DOC_REINDEX:
      return 'Document Ingestion Re-Indexed';
    case AuditAction.DOC_ACL_UPDATE:
      return 'Document Access Control Policy Updated';
    case AuditAction.RAG_QUERY:
      return 'Knowledge Base RAG Query Executed';
    case AuditAction.CHAT_QUERY:
      return 'Support Conversation Message Processed';
    case AuditAction.ADMIN_ROLE_CHANGE:
      return 'User Security Role Changed';
    case AuditAction.ADMIN_CLEARANCE_CHANGE:
      return 'User Security Clearance Level Changed';
    case AuditAction.ADMIN_PERMISSION_CHANGE:
      return 'User Granular Permissions Changed';
    case AuditAction.ADMIN_EXPORT_LOGS:
      return 'Compliance Audit Trail Exported';
    case AuditAction.ADMIN_PURGE:
      return 'System Purge Executed';
    case AuditAction.ADMIN_VERIFY_CHAIN:
      return 'Cryptographic Audit Chain Verified';
    case AuditAction.AUTH_ACCESS_DENIED:
      return 'Access Denied: Authorization Policy Rejection';
    default:
      return action.replace(/[._]/g, ' ').toUpperCase();
  }
}

export interface AuditLogTableProps {
  externalRefreshKey?: number;
}

export function AuditLogTable({ externalRefreshKey = 0 }: AuditLogTableProps = {}) {
  const toast = useToast();

  const [logs, setLogs] = useState<IAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);

  // Filter state
  const [actionFilter, setActionFilter] = useState<string>('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeFilters = useMemo(
    () => ({
      action: actionFilter || undefined,
      resourceType: resourceTypeFilter || undefined,
      status: statusFilter || undefined,
      userId: userIdFilter.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [actionFilter, resourceTypeFilter, statusFilter, userIdFilter, startDate, endDate]
  );

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params: Record<string, string | number> = {
        page,
        limit,
      };

      if (actionFilter) params.action = actionFilter;
      if (resourceTypeFilter) params.resourceType = resourceTypeFilter;
      if (statusFilter) params.status = statusFilter;
      if (userIdFilter.trim()) params.userId = userIdFilter.trim();
      if (startDate) params.startDate = new Date(startDate).toISOString();
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        params.endDate = end.toISOString();
      }

      const response = await ApiClient.get<AuditLogResponse>('/api/v1/admin/audit/logs', params);

      setLogs(response.logs || []);
      setTotal(response.pagination?.total || 0);
      setTotalPages(response.pagination?.totalPages || 1);
    } catch (err: any) {
      const msg = err.message || 'Failed to fetch audit log entries';
      setErrorMessage(msg);
      toast.error(msg, 'Audit Query Error');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, actionFilter, resourceTypeFilter, statusFilter, userIdFilter, startDate, endDate, toast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (externalRefreshKey > 0) {
      fetchLogs();
      setRefreshKey((k) => k + 1);
    }
  }, [externalRefreshKey, fetchLogs]);

  const handleResetFilters = () => {
    setActionFilter('');
    setResourceTypeFilter('');
    setStatusFilter('');
    setUserIdFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    setRefreshKey((k) => k + 1);
  };

  const toggleExpand = (id: string) => {
    setExpandedLogId((prev) => (prev === id ? null : id));
  };

  const handleExport = async (format: 'csv' | 'json') => {
    setIsExporting(format);
    try {
      const url = ApiClient.buildUrl('/api/v1/admin/audit/export');
      url.searchParams.set('format', format);
      if (actionFilter) url.searchParams.set('action', actionFilter);
      if (resourceTypeFilter) url.searchParams.set('resourceType', resourceTypeFilter);
      if (statusFilter) url.searchParams.set('status', statusFilter);
      if (userIdFilter.trim()) url.searchParams.set('userId', userIdFilter.trim());
      if (startDate) url.searchParams.set('startDate', new Date(startDate).toISOString());
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        url.searchParams.set('endDate', end.toISOString());
      }
      url.searchParams.set('limit', '5000');

      const headers: HeadersInit = {};
      const token = ApiClient.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(url.toString(), {
        headers,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || `Export failed with HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `audit-logs-${format}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);

      toast.success(
        `Audit logs exported to ${format.toUpperCase()} with formula injection defenses.`,
        'Export Complete'
      );
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast.error(err.message || 'Failed to export audit logs', 'Export Error');
    } finally {
      setIsExporting(null);
    }
  };

  const getActionBadgeVariant = (action: string) => {
    if (action.startsWith('auth.')) return 'brand';
    if (action.startsWith('document.')) return 'info';
    if (action.startsWith('admin.')) return 'error';
    return 'default';
  };

  const getStatusBadge = (status: 'success' | 'denied' | 'error') => {
    if (status === 'success') {
      return (
        <Badge variant="success" icon={<CheckCircle2 className="w-3 h-3" />}>
          Success
        </Badge>
      );
    }
    if (status === 'denied') {
      return (
        <Badge variant="warning" icon={<AlertTriangle className="w-3 h-3" />}>
          Denied
        </Badge>
      );
    }
    return (
      <Badge variant="error" icon={<XCircle className="w-3 h-3" />}>
        Error
      </Badge>
    );
  };

  const getResourceIcon = (type: AuditResourceType) => {
    switch (type) {
      case AuditResourceType.USER:
        return <User className="w-3.5 h-3.5 text-brand-primary" />;
      case AuditResourceType.DOCUMENT:
        return <FileText className="w-3.5 h-3.5 text-status-info" />;
      case AuditResourceType.CHUNK:
        return <FileText className="w-3.5 h-3.5 text-status-info" />;
      case AuditResourceType.CONVERSATION:
        return <MessageSquare className="w-3.5 h-3.5 text-status-success" />;
      case AuditResourceType.SYSTEM:
      default:
        return <Server className="w-3.5 h-3.5 text-text-muted" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Dynamic Summary Cards mirroring current scope */}
      <AuditSummaryCards filters={activeFilters} refreshKey={refreshKey} />

      <Card variant="default" className="p-6 space-y-6">
        <CardHeader className="p-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-brand-primary" />
              Immutable Audit Trail &amp; Compliance Logs
            </CardTitle>
            <CardDescription className="mt-1">
              Tamper-evident, HMAC-SHA256 signed audit records. All records are strictly append-only and cryptographically chained.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" className="font-mono text-xs">
              {total.toLocaleString()} {total === 1 ? 'Record' : 'Records'}
            </Badge>

            {/* CSV & JSON Export Actions */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('csv')}
              isLoading={isExporting === 'csv'}
              leftIcon={<Download className="w-3.5 h-3.5" />}
              data-testid="export-csv-button"
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('json')}
              isLoading={isExporting === 'json'}
              leftIcon={<Download className="w-3.5 h-3.5" />}
              data-testid="export-json-button"
            >
              Export JSON
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchLogs();
                setRefreshKey((k) => k + 1);
              }}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
          </div>
        </CardHeader>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-xl border border-border-subtle bg-surface-elevated/40 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-text-muted uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" />
              Query Filters
            </span>
            {(actionFilter || resourceTypeFilter || statusFilter || userIdFilter || startDate || endDate) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-brand-primary hover:underline lowercase font-normal"
              >
                clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            {/* Action Filter */}
            <div>
              <label htmlFor="filter-action" className="block text-text-muted mb-1">
                Action:
              </label>
              <select
                id="filter-action"
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                  setRefreshKey((k) => k + 1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              >
                <option value="">All Actions</option>
                {Object.values(AuditAction).map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>

            {/* Resource Type Filter */}
            <div>
              <label htmlFor="filter-resource-type" className="block text-text-muted mb-1">
                Resource Type:
              </label>
              <select
                id="filter-resource-type"
                value={resourceTypeFilter}
                onChange={(e) => {
                  setResourceTypeFilter(e.target.value);
                  setPage(1);
                  setRefreshKey((k) => k + 1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              >
                <option value="">All Resource Types</option>
                {Object.values(AuditResourceType).map((rt) => (
                  <option key={rt} value={rt}>
                    {rt.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label htmlFor="filter-status" className="block text-text-muted mb-1">
                Outcome:
              </label>
              <select
                id="filter-status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                  setRefreshKey((k) => k + 1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              >
                <option value="">All Outcomes</option>
                <option value="success">Success</option>
                <option value="denied">Denied</option>
                <option value="error">Error</option>
              </select>
            </div>

            {/* User ID Filter */}
            <div>
              <label htmlFor="filter-user-id" className="block text-text-muted mb-1">
                User ID (ObjectId):
              </label>
              <input
                id="filter-user-id"
                type="text"
                placeholder="e.g. 6512..."
                value={userIdFilter}
                onChange={(e) => {
                  setUserIdFilter(e.target.value);
                  setPage(1);
                  setRefreshKey((k) => k + 1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary font-mono text-[11px]"
              />
            </div>

            {/* Date Range Start */}
            <div>
              <label htmlFor="filter-start-date" className="block text-text-muted mb-1">
                Start Date:
              </label>
              <input
                id="filter-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                  setRefreshKey((k) => k + 1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              >
              </input>
            </div>

            {/* Date Range End */}
            <div>
              <label htmlFor="filter-end-date" className="block text-text-muted mb-1">
                End Date:
              </label>
              <input
                id="filter-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                  setRefreshKey((k) => k + 1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
              >
              </input>
            </div>
          </div>
        </div>

        {/* Error Message with Retry */}
        {errorMessage && (
          <div className="p-4 rounded-xl border border-status-error/30 bg-status-error/10 text-status-error flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Failed to retrieve audit log records</p>
                <p className="mt-0.5">{errorMessage}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchLogs()}
              className="border-status-error/40 text-status-error hover:bg-status-error/10"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Audit Log Table */}
        <div className="overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full text-left text-xs" role="table">
            <thead className="bg-surface-elevated text-text-muted font-semibold border-b border-border-subtle">
              <tr>
                <th scope="col" className="p-3 w-16 text-center">Seq #</th>
                <th scope="col" className="p-3">Timestamp</th>
                <th scope="col" className="p-3">Action</th>
                <th scope="col" className="p-3">Resource</th>
                <th scope="col" className="p-3">Actor Profile</th>
                <th scope="col" className="p-3">Status</th>
                <th scope="col" className="p-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50 text-text-secondary">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-3 text-center"><Skeleton className="h-4 w-8 mx-auto" /></td>
                    <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="p-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="p-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-medium text-text-secondary">No audit log records found</p>
                    <p className="text-xs text-text-muted mt-1">
                      Try adjusting your filters or date range.
                    </p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const failureReason: string | null =
                    typeof log.details?.reason === 'string'
                      ? log.details.reason
                      : typeof log.details?.rejectionReason === 'string'
                      ? log.details.rejectionReason
                      : typeof log.details?.error === 'string'
                      ? log.details.error
                      : null;

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        className={cn(
                          'hover:bg-surface-elevated/30 transition-colors',
                          isExpanded && 'bg-surface-elevated/40'
                        )}
                        data-testid={`audit-row-${log.sequenceNumber}`}
                      >
                        {/* Monotonic Sequence Number */}
                        <td className="p-3 text-center font-mono font-bold text-text-primary">
                          {`#${log.sequenceNumber}`}
                        </td>

                        {/* Timestamp */}
                        <td className="p-3 font-mono text-[11px] text-text-secondary whitespace-nowrap">
                          <div>{new Date(log.createdAt).toLocaleDateString()}</div>
                          <div className="text-[10px] text-text-muted">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </div>
                        </td>

                        {/* Action */}
                        <td className="p-3">
                          <Badge variant={getActionBadgeVariant(log.action)} className="font-mono text-[11px]">
                            {log.action}
                          </Badge>
                          <div className="text-[10px] text-text-muted mt-0.5 max-w-[200px] truncate" title={getActionHumanTitle(log.action)}>
                            {getActionHumanTitle(log.action)}
                          </div>
                        </td>

                        {/* Resource */}
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            {getResourceIcon(log.resourceType)}
                            <span className="font-mono text-[11px] text-text-primary truncate max-w-[130px]" title={log.resourceId}>
                              {log.resourceId}
                            </span>
                          </div>
                          <span className="text-[10px] text-text-muted uppercase">
                            {log.resourceType}
                          </span>
                        </td>

                        {/* Actor Profile: Email & Role */}
                        <td className="p-3">
                          {log.actorEmail ? (
                            <div>
                              <p className="font-medium text-[11px] text-text-primary truncate max-w-[150px]" title={log.actorEmail}>
                                {log.actorEmail}
                              </p>
                              <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                                {log.actorRole && (
                                  <span className="uppercase font-semibold text-brand-primary">
                                    {log.actorRole}
                                  </span>
                                )}
                                <span>· {log.ipAddress}</span>
                              </div>
                            </div>
                          ) : log.userId ? (
                            <div>
                              <p className="font-mono text-[11px] text-text-primary truncate max-w-[140px]" title={log.userId}>
                                {log.userId}
                              </p>
                              <p className="text-[10px] text-text-muted font-mono">{log.ipAddress}</p>
                            </div>
                          ) : (
                            <div>
                              <span className="text-[11px] font-medium text-text-muted">System Internal</span>
                              <p className="text-[10px] text-text-muted font-mono">{log.ipAddress}</p>
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td className="p-3">{getStatusBadge(log.status)}</td>

                        {/* Expand Details Trigger */}
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => toggleExpand(log.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded hover:bg-surface border border-transparent hover:border-border-subtle text-text-secondary text-[11px] font-medium transition-colors"
                            aria-expanded={isExpanded}
                            aria-label={`Toggle details for sequence #${log.sequenceNumber}`}
                            data-testid={`inspect-btn-${log.sequenceNumber}`}
                          >
                            {isExpanded ? (
                              <>
                                Hide <ChevronUp className="w-3.5 h-3.5" />
                              </>
                            ) : (
                              <>
                                Inspect <ChevronDown className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Metadata & HMAC Inspector */}
                      {isExpanded && (
                        <tr className="bg-surface-elevated/20">
                          <td colSpan={7} className="p-5 space-y-4 border-t border-border-subtle/40">
                            {/* Human-Readable Action & Outcome Banner */}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-border-subtle/50">
                              <div className="space-y-0.5">
                                <h4 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                  {getActionHumanTitle(log.action)}
                                </h4>
                                <p className="text-[11px] font-mono text-text-muted">
                                  Technical Identifier: <code className="text-brand-primary">{log.action}</code>
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="default" className="font-mono text-xs">
                                  Sequence #{log.sequenceNumber}
                                </Badge>
                                {getStatusBadge(log.status)}
                              </div>
                            </div>

                            {/* Safe Failure/Rejection Reason Banner */}
                            {Boolean(failureReason) && (
                              <div className="p-3 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs flex items-center gap-2">
                                <ShieldAlert className="w-4 h-4 shrink-0" />
                                <div>
                                  <span className="font-semibold">Authorization / Fault Reason: </span>
                                  <code className="font-mono">{failureReason}</code>
                                </div>
                              </div>
                            )}

                            {/* 3-Column Context Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                              {/* Actor Identity */}
                              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface space-y-2">
                                <p className="font-semibold text-text-primary flex items-center gap-1.5 text-xs">
                                  <User className="w-3.5 h-3.5 text-brand-primary" />
                                  Actor Identity &amp; Client
                                </p>
                                <div className="space-y-1 font-mono text-[11px]">
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Email:</span>
                                    <span className="text-text-primary">{log.actorEmail || 'Not recorded'}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Name:</span>
                                    <span className="text-text-primary">{log.actorName || 'Not recorded'}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Role:</span>
                                    <span className="text-text-primary font-bold">{log.actorRole || 'Not recorded'}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">User ID:</span>
                                    <span className="text-text-muted truncate block" title={log.userId || ''}>
                                      {log.userId || 'system'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">IP &amp; Client:</span>
                                    <span className="text-text-muted">{log.ipAddress}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Resource & Timestamps */}
                              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface space-y-2">
                                <p className="font-semibold text-text-primary flex items-center gap-1.5 text-xs">
                                  <Clock className="w-3.5 h-3.5 text-status-info" />
                                  Resource &amp; Dual Timestamps
                                </p>
                                <div className="space-y-1 font-mono text-[11px]">
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Resource Type:</span>
                                    <span className="text-text-primary uppercase font-bold">{log.resourceType}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Resource ID:</span>
                                    <span className="text-text-primary break-all">{log.resourceId}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Timestamp (UTC):</span>
                                    <span className="text-text-primary">{new Date(log.createdAt).toISOString()}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Local Time:</span>
                                    <span className="text-text-primary">
                                      {new Date(log.createdAt).toLocaleString(undefined, { timeZoneName: 'short' })}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Cryptographic Linkage Hashes */}
                              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface space-y-2">
                                <p className="font-semibold text-text-primary flex items-center gap-1.5 text-xs">
                                  <Lock className="w-3.5 h-3.5 text-brand-primary" />
                                  Cryptographic Proof (SHA-256 HMAC)
                                </p>
                                <div className="space-y-1 font-mono text-[11px]">
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Tamper Hash:</span>
                                    <p className="text-brand-primary break-all text-[10px] bg-canvas p-1 rounded border border-border-subtle">
                                      {log.tamperHash}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-text-muted text-[10px] uppercase block">Previous Hash Link:</span>
                                    <p className="text-text-secondary break-all text-[10px] bg-canvas p-1 rounded border border-border-subtle">
                                      {log.previousHash === '0000000000000000000000000000000000000000000000000000000000000000'
                                        ? '0000... (GENESIS BLOCK)'
                                        : log.previousHash}
                                    </p>
                                  </div>
                                  <div className="pt-1 flex items-center gap-1.5 text-[10px] text-status-success font-semibold">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Monotonically Chained</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Domain-Specific Badges: Role/Clearance/Permission Changes */}
                            {Boolean(
                              log.details?.previousRole ||
                              log.details?.newRole ||
                              log.details?.previousClearance ||
                              log.details?.newClearance ||
                              log.details?.grantedPermissions ||
                              log.details?.revokedPermissions
                            ) && (
                              <div className="p-3.5 rounded-lg border border-border-subtle bg-surface space-y-2">
                                <p className="font-semibold text-text-primary text-xs flex items-center gap-1.5">
                                  <Shield className="w-3.5 h-3.5 text-brand-primary" />
                                  Permission &amp; Clearance Transition Evidence
                                </p>
                                <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                                  {Boolean(log.details.previousRole && log.details.newRole) && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-text-muted">Role:</span>
                                      <Badge variant="default">{String(log.details.previousRole)}</Badge>
                                      <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
                                      <Badge variant="brand">{String(log.details.newRole)}</Badge>
                                    </div>
                                  )}
                                  {Boolean(log.details.previousClearance && log.details.newClearance) && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-text-muted">Clearance:</span>
                                      <Badge variant="default">{String(log.details.previousClearance)}</Badge>
                                      <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
                                      <Badge variant="brand">{String(log.details.newClearance)}</Badge>
                                    </div>
                                  )}
                                  {Array.isArray(log.details.grantedPermissions) && log.details.grantedPermissions.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-status-success font-semibold">+Granted:</span>
                                      {log.details.grantedPermissions.map((p: string) => (
                                        <Badge key={p} variant="success" className="text-[10px]">
                                          {p}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {Array.isArray(log.details.revokedPermissions) && log.details.revokedPermissions.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-status-error font-semibold">-Revoked:</span>
                                      {log.details.revokedPermissions.map((p: string) => (
                                        <Badge key={p} variant="error" className="text-[10px]">
                                          {p}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Safe Payload Metadata Viewer */}
                            <div className="p-3.5 rounded-lg border border-border-subtle bg-surface space-y-2">
                              <p className="font-semibold text-text-primary text-xs">
                                Structured Safe Payload Metadata:
                              </p>
                              {log.details && Object.keys(log.details).length > 0 ? (
                                <pre className="p-2.5 rounded bg-canvas border border-border-subtle font-mono text-[11px] text-text-primary max-h-48 overflow-auto">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-text-muted text-[11px] italic">
                                  No additional payload metadata recorded for this event.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Accessible Pagination Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Show:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="px-2 py-1 rounded border border-border-subtle bg-surface text-text-primary"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>
              records per page (Page {page} of {totalPages})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1 || isLoading}
              leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
            >
              Previous
            </Button>
            <span className="text-xs font-mono px-2 text-text-primary">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages || isLoading}
              rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
