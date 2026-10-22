'use client';

import React from 'react';
import { Card, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface AnalyticsKpiCardProps {
  title: string;
  value: string | number | undefined | null;
  subtitle?: string;
  icon?: React.ReactNode;
  iconColorClass?: string;
  badge?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
  testId?: string;
}

export function AnalyticsKpiCard({
  title,
  value,
  subtitle,
  icon,
  iconColorClass = 'text-brand-primary bg-brand-primary/10',
  badge,
  isLoading = false,
  className,
  testId,
}: AnalyticsKpiCardProps) {
  return (
    <Card
      variant="default"
      className={cn('p-5 flex flex-col justify-between transition-shadow hover:shadow-md', className)}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-24 my-1" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-text-primary">
                {value !== undefined && value !== null ? value : '—'}
              </span>
              {badge}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform',
              iconColorClass
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
      </div>

      {(subtitle || isLoading) && (
        <div className="mt-3 pt-3 border-t border-border-subtle/50">
          {isLoading ? (
            <Skeleton className="h-4 w-36" />
          ) : (
            <p className="text-xs text-text-secondary">{subtitle}</p>
          )}
        </div>
      )}
    </Card>
  );
}
