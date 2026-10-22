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
        <Badge
          variant="warning"
          size="sm"
          icon={<Clock className="w-3 h-3 text-status-warning" />}
          className={cn('font-medium', className)}
        >
          Queued
        </Badge>
      );

    case DocumentStatus.PROCESSING:
      return (
        <Badge
          variant="brand"
          size="sm"
          icon={<Loader2 className="w-3 h-3 text-brand-primary animate-spin" />}
          className={cn('font-medium', className)}
        >
          Processing
        </Badge>
      );

    case DocumentStatus.INDEXING:
      return (
        <Badge
          variant="info"
          size="sm"
          icon={<RefreshCw className="w-3 h-3 text-status-info animate-spin" />}
          className={cn('font-medium', className)}
        >
          Indexing
        </Badge>
      );

    case DocumentStatus.READY:
    case DocumentStatus.INDEXED:
      return (
        <Badge
          variant="success"
          size="sm"
          icon={<CheckCircle2 className="w-3 h-3 text-status-success" />}
          className={cn('font-medium', className)}
        >
          Ready
        </Badge>
      );

    case DocumentStatus.FAILED:
      return (
        <span title={errorMessage || 'Processing failed. Click retry to re-process.'}>
          <Badge
            variant="error"
            size="sm"
            icon={<AlertCircle className="w-3 h-3 text-status-error" />}
            className={cn('font-medium cursor-help', className)}
          >
            Failed
          </Badge>
        </span>
      );

    case DocumentStatus.DELETING:
      return (
        <Badge
          variant="default"
          size="sm"
          icon={<Trash2 className="w-3 h-3 text-muted animate-pulse" />}
          className={cn('font-medium', className)}
        >
          Deleting
        </Badge>
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
