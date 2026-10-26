'use client';

import React from 'react';
import {
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Archive,
  RefreshCw,
} from 'lucide-react';
import { DocumentStatus } from '@enterprise-ai/shared-types';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface DocumentStatusBadgeProps {
  status: DocumentStatus;
  errorMessage?: string | null;
  className?: string;
}

export function DocumentStatusBadge({
  status,
  errorMessage,
  className,
}: DocumentStatusBadgeProps) {
  switch (status) {
    case DocumentStatus.QUEUED:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border bg-amber-500/10 text-amber-400 border-amber-500/25 select-none transition-colors duration-150',
            className
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <Clock className="w-3 h-3 shrink-0 hidden" />
          <span>Queued</span>
        </span>
      );

    case DocumentStatus.PROCESSING:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border bg-sky-500/10 text-sky-400 border-sky-500/25 select-none transition-colors duration-150',
            className
          )}
        >
          <Loader2 className="w-3 h-3 text-sky-400 animate-spin shrink-0" />
          <span>Processing</span>
        </span>
      );

    case DocumentStatus.INDEXING:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border bg-indigo-500/10 text-indigo-400 border-indigo-500/25 select-none transition-colors duration-150',
            className
          )}
        >
          <RefreshCw className="w-3 h-3 text-indigo-400 animate-spin shrink-0" />
          <span>Indexing</span>
        </span>
      );

    case DocumentStatus.READY:
    case DocumentStatus.INDEXED:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border bg-emerald-500/10 text-emerald-400 border-emerald-500/25 select-none transition-colors duration-150',
            className
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <CheckCircle2 className="w-3 h-3 shrink-0 hidden" />
          <span>Ready</span>
        </span>
      );

    case DocumentStatus.FAILED:
      return (
        <span title={errorMessage || 'Processing failed. Click retry to re-process.'}>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border bg-rose-500/10 text-rose-400 border-rose-500/25 select-none cursor-help transition-colors duration-150',
              className
            )}
          >
            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
            <span>Failed</span>
          </span>
        </span>
      );

    case DocumentStatus.DELETING:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide border bg-surface-elevated text-secondary border-subtle select-none transition-colors duration-150',
            className
          )}
        >
          <Trash2 className="w-3 h-3 text-muted animate-pulse shrink-0" />
          <span>Deleting</span>
        </span>
      );

    case DocumentStatus.ARCHIVED:
      return (
        <Badge
          variant="default"
          size="sm"
          icon={<Archive className="w-3 h-3 text-muted" />}
          className={cn('font-medium', className)}
        >
          Archived
        </Badge>
      );

    default:
      return (
        <Badge variant="default" size="sm" className={className}>
          {String(status)}
        </Badge>
      );
  }
}
