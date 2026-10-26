'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { IAuditSummary } from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import { Card, Skeleton, Badge, Button } from '@/components/ui';
import {
  History,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  RotateCcw,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AuditSummaryFilters {
  action?: string;
  resourceType?: string;
  status?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditSummaryCardsProps {
  filters: AuditSummaryFilters;
  refreshKey?: number;
}

export function AuditSummaryCards({ filters, refreshKey = 0 }: AuditSummaryCardsProps) {
  const [summary, setSummary] = useState<IAuditSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params: Record<string, string> = {};
      if (filters.action) params.action = filters.action;
      if (filters.resourceType) params.resourceType = filters.resourceType;
      if (filters.status) params.status = filters.status;
      if (filters.userId?.trim()) params.userId = filters.userId.trim();
      if (filters.startDate) params.startDate = new Date(filters.startDate).toISOString();
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        params.endDate = end.toISOString();
      }

      const response = await ApiClient.get<IAuditSummary>('/api/v1/admin/audit/summary', params);
      setSummary(response);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to aggregate audit metrics');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, refreshKey]);

  if (errorMessage) {
    return (
      <div className="p-4 rounded-xl border border-status-error/30 bg-status-error/10 text-status-error flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Audit Summary Error: {errorMessage}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fetchSummary()}
          className="border-status-error/30 text-status-error hover:bg-status-error/10 text-xs h-7"
        >
          <RotateCcw className="w-3 h-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const cards = [
    {
      id: 'total-events',
      title: 'Total Audit Events',
      value: summary ? summary.total.toLocaleString() : '—',
      subtitle: 'Events matching current query & scope',
      icon: <History className="w-5 h-5 text-brand-primary" />,
      iconBg: 'bg-brand-primary/10 text-brand-primary',
      badge: summary && summary.total > 0 ? (
        <Badge variant="brand" className="text-[10px] py-0 px-1.5">
          Active Scope
        </Badge>
      ) : null,
    },
    {
      id: 'success-events',
      title: 'Successful Events',
      value: summary ? summary.success.toLocaleString() : '—',
      subtitle: summary && summary.total > 0
        ? `${Math.round((summary.success / summary.total) * 100)}% of matching records`
        : 'Zero successful operations',
      icon: <CheckCircle2 className="w-5 h-5 text-status-success" />,
      iconBg: 'bg-status-success/10 text-status-success',
      badge: summary ? (
        <Badge variant="success" className="text-[10px] py-0 px-1.5">
          Compliant
        </Badge>
      ) : null,
    },
    {
      id: 'failed-events',
      title: 'Denied / Failed Events',
      value: summary ? summary.failedTotal.toLocaleString() : '—',
      subtitle: summary
        ? `${summary.denied.toLocaleString()} denied · ${summary.error.toLocaleString()} system errors`
        : 'Authorization rejections & faults',
      icon: <AlertTriangle className="w-5 h-5 text-status-warning" />,
      iconBg: 'bg-status-warning/10 text-status-warning',
      badge: summary && summary.failedTotal > 0 ? (
        <Badge variant="warning" className="text-[10px] py-0 px-1.5">
          Attention
        </Badge>
      ) : null,
    },
    {
      id: 'security-critical',
      title: 'Security-Critical Events',
      value: summary ? summary.securityCritical.toLocaleString() : '—',
      subtitle: 'Policy: auth failures, role changes & ACL updates',
      icon: <ShieldAlert className="w-5 h-5 text-status-error" />,
      iconBg: 'bg-status-error/10 text-status-error',
      badge: summary && summary.securityCritical > 0 ? (
        <Badge variant="error" className="text-[10px] py-0 px-1.5 animate-pulse">
          High Priority
        </Badge>
      ) : (
        <Badge variant="default" className="text-[10px] py-0 px-1.5">
          Zero Critical
        </Badge>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="audit-summary-cards">
      {cards.map((card) => (
        <Card
          key={card.id}
          variant="default"
          className="p-5 flex flex-col justify-between hover:border-border-focus transition-all duration-200"
          data-testid={card.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {card.title}
              </p>
              {isLoading ? (
                <Skeleton className="h-8 w-20 my-1" />
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-text-primary">
                    {card.value}
                  </span>
                  {card.badge}
                </div>
              )}
            </div>
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                card.iconBg
              )}
              aria-hidden="true"
            >
              {card.icon}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-border-subtle/50">
            {isLoading ? (
              <Skeleton className="h-3.5 w-32" />
            ) : (
              <p className="text-[11px] text-text-secondary truncate" title={card.subtitle}>
                {card.subtitle}
              </p>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
