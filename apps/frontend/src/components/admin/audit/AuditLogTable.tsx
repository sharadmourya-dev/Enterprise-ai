'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AuditAction,
  AuditResourceType,
  IAuditLog,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button, Skeleton, useToast } from '@/components/ui';
import {
  History,
  Filter,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Shield,
  User,
  Server,
  FileText,
  MessageSquare,
  Key,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AuditLogResponse {
  logs: IAuditLog[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export function AuditLogTable() {
  const toast = useToast();

  const [logs, setLogs] = useState<IAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const handleResetFilters = () => {
    setActionFilter('');
    setResourceTypeFilter('');
    setStatusFilter('');
    setUserIdFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const toggleExpand = (id: string) => {
    setExpandedLogId((prev) => (prev === id ? null : id));
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
    <Card variant="default" className="p-6 space-y-6">
      <CardHeader className="p-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-brand-primary" />
            Immutable Audit Trail &amp; Compliance Logs
          </CardTitle>
          <CardDescription className="mt-1">
            Tamper-evident, HMAC-SHA256 signed audit records. All records are strictly append-only and immutable.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="default" className="font-mono text-xs">
            {total.toLocaleString()} {total === 1 ? 'Record' : 'Records'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchLogs()}
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
              }}
              className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
            />
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
              }}
              className="w-full px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary"
            />
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
              <th scope="col" className="p-3">Actor / IP</th>
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
                    Try adjusting your filters or search date range.
                  </p>
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      className={cn(
                        'hover:bg-surface-elevated/30 transition-colors',
                        isExpanded && 'bg-surface-elevated/40'
                      )}
                    >
                      {/* Monotonic Sequence Number */}
                      <td className="p-3 text-center font-mono font-bold text-text-primary">
                        {`#${log.sequenceNumber}`}
                      </td>

                      {/* Timestamp */}
                      <td className="p-3 font-mono text-[11px] text-text-secondary whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>

                      {/* Action */}
                      <td className="p-3">
                        <Badge variant={getActionBadgeVariant(log.action)} className="font-mono text-[11px]">
                          {log.action}
                        </Badge>
                      </td>

                      {/* Resource */}
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          {getResourceIcon(log.resourceType)}
                          <span className="font-mono text-[11px] text-text-primary">
                            {log.resourceId}
                          </span>
                        </div>
                        <span className="text-[10px] text-text-muted uppercase">
                          {log.resourceType}
                        </span>
                      </td>

                      {/* Actor & IP */}
                      <td className="p-3">
                        <p className="font-mono text-[11px] text-text-primary truncate max-w-[140px]" title={log.userId || 'system'}>
                          {log.userId ? log.userId : 'system'}
                        </p>
                        <p className="text-[10px] text-text-muted font-mono">{log.ipAddress}</p>
                      </td>

                      {/* Status */}
                      <td className="p-3">{getStatusBadge(log.status)}</td>

                      {/* Expand Details Trigger */}
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleExpand(log.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-surface border border-transparent hover:border-border-subtle text-text-secondary text-[11px] font-medium"
                          aria-expanded={isExpanded}
                          aria-label={`Toggle details for sequence #${log.sequenceNumber}`}
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
                        <td colSpan={7} className="p-4 space-y-3 border-t border-border-subtle/40">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            {/* Cryptographic Linkage Hashes */}
                            <div className="p-3 rounded-lg border border-border-subtle bg-surface space-y-1.5">
                              <p className="font-semibold text-text-primary flex items-center gap-1.5">
                                <Lock className="w-3.5 h-3.5 text-brand-primary" />
                                Cryptographic Chaining Hashes (SHA-256 HMAC)
                              </p>
                              <div>
                                <span className="text-[10px] uppercase font-bold text-text-muted">
                                  Tamper Hash (HMAC):
                                </span>
                                <p className="font-mono text-[11px] text-brand-primary break-all">
                                  {log.tamperHash}
                                </p>
                              </div>
                              <div>
                                <span className="text-[10px] uppercase font-bold text-text-muted">
                                  Previous Hash Link:
                                </span>
                                <p className="font-mono text-[11px] text-text-secondary break-all">
                                  {log.previousHash}
                                </p>
                              </div>
                              <div>
                                <span className="text-[10px] uppercase font-bold text-text-muted">
                                  User Agent:
                                </span>
                                <p className="font-mono text-[11px] text-text-muted truncate">
                                  {log.userAgent}
                                </p>
                              </div>
                            </div>

                            {/* Structured Event Details */}
                            <div className="p-3 rounded-lg border border-border-subtle bg-surface space-y-1.5">
                              <p className="font-semibold text-text-primary">Payload Details:</p>
                              {log.details && Object.keys(log.details).length > 0 ? (
                                <pre className="p-2 rounded bg-canvas border border-border-subtle font-mono text-[11px] text-text-primary max-h-36 overflow-auto">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-text-muted text-[11px] italic">
                                  No additional payload metadata recorded.
                                </p>
                              )}
                            </div>
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
  );
}
