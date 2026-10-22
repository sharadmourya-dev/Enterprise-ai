'use client';

import React from 'react';
import { IAnalyticsIngestionStats } from '@enterprise-ai/shared-types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@/components/ui';
import { FileText, Layers, AlertCircle, Database, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/components/documents/DocumentList';

export interface IngestionStatsViewProps {
  stats: IAnalyticsIngestionStats | null;
  isLoading?: boolean;
}

export function IngestionStatsView({ stats, isLoading = false }: IngestionStatsViewProps) {
  if (isLoading) {
    return (
      <Card variant="default" className="p-6">
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-surface-elevated rounded" />
          <div className="h-4 w-72 bg-surface-elevated rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-4">
            <div className="h-20 bg-surface-elevated rounded-xl" />
            <div className="h-20 bg-surface-elevated rounded-xl" />
            <div className="h-20 bg-surface-elevated rounded-xl" />
            <div className="h-20 bg-surface-elevated rounded-xl" />
          </div>
        </div>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card variant="default" className="p-6 text-center text-text-muted">
        No ingestion statistics available.
      </Card>
    );
  }

  const {
    totalDocuments,
    byStatus,
    totalChunks,
    totalFileSizeBytes,
    avgChunksPerDoc,
    failedCount,
    failureRatePercentage,
    recentFailures,
  } = stats;

  return (
    <Card variant="default" className="p-6 space-y-6">
      <CardHeader className="p-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-brand-primary" />
              Ingestion Pipeline &amp; Storage Telemetry
            </CardTitle>
            <CardDescription className="mt-1">
              Document indexing volume, chunk distributions, storage footprints, and pipeline error rates
            </CardDescription>
          </div>
          <Badge
            variant={failureRatePercentage > 10 ? 'error' : failureRatePercentage > 0 ? 'warning' : 'success'}
            className="text-xs"
          >
            {failureRatePercentage}% Failure Rate
          </Badge>
        </div>
      </CardHeader>

      {/* Grid of key ingestion indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface-elevated/50 border border-border-subtle/60">
          <div className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase">
            <FileText className="w-4 h-4 text-brand-primary" />
            Total Documents
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">{totalDocuments.toLocaleString()}</p>
          <p className="text-xs text-text-secondary mt-1">Managed repository corpus</p>
        </div>

        <div className="p-4 rounded-xl bg-surface-elevated/50 border border-border-subtle/60">
          <div className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase">
            <Layers className="w-4 h-4 text-status-info" />
            Total Vector Chunks
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">{totalChunks.toLocaleString()}</p>
          <p className="text-xs text-text-secondary mt-1">Avg {avgChunksPerDoc} chunks / document</p>
        </div>

        <div className="p-4 rounded-xl bg-surface-elevated/50 border border-border-subtle/60">
          <div className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase">
            <Database className="w-4 h-4 text-status-success" />
            Total Ingested Size
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">{formatFileSize(totalFileSizeBytes)}</p>
          <p className="text-xs text-text-secondary mt-1">Binary storage footprint</p>
        </div>

        <div className="p-4 rounded-xl bg-surface-elevated/50 border border-border-subtle/60">
          <div className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase">
            <AlertCircle className="w-4 h-4 text-status-error" />
            Failed Documents
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">{failedCount.toLocaleString()}</p>
          <p className="text-xs text-text-secondary mt-1">Require reprocessing or retry</p>
        </div>
      </div>

      {/* Status Distribution Progress Bar */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
          Document Status Distribution
        </h4>
        <div className="w-full h-4 bg-surface-elevated rounded-full overflow-hidden flex shadow-inner">
          {totalDocuments === 0 ? (
            <div className="w-full h-full bg-border-subtle" />
          ) : (
            Object.entries(byStatus).map(([status, count]) => {
              if (count === 0) return null;
              const widthPct = (count / totalDocuments) * 100;
              let bg = 'bg-text-muted';
              if (status === 'ready') bg = 'bg-status-success';
              else if (status === 'processing' || status === 'pending') bg = 'bg-brand-primary';
              else if (status === 'indexing' || status === 'queued') bg = 'bg-status-info';
              else if (status === 'failed') bg = 'bg-status-error';

              return (
                <div
                  key={status}
                  style={{ width: `${widthPct}%` }}
                  className={cn(bg, 'h-full transition-all duration-300')}
                  title={`${status.toUpperCase()}: ${count} (${widthPct.toFixed(1)}%)`}
                />
              );
            })
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-text-secondary">
          {Object.entries(byStatus).map(([status, count]) => {
            let dot = 'bg-text-muted';
            if (status === 'ready') dot = 'bg-status-success';
            else if (status === 'processing' || status === 'pending') dot = 'bg-brand-primary';
            else if (status === 'indexing' || status === 'queued') dot = 'bg-status-info';
            else if (status === 'failed') dot = 'bg-status-error';

            return (
              <div key={status} className="flex items-center gap-1.5">
                <span className={cn('w-2.5 h-2.5 rounded-full', dot)} />
                <span className="capitalize">{status}:</span>
                <strong className="text-text-primary font-mono">{count}</strong>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Failures Table (if any) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-status-error" />
            Recent Ingestion Failures ({recentFailures?.length || 0})
          </h4>
          <span className="text-xs text-text-muted">
            Reprocess documents in Document Repository (/documents)
          </span>
        </div>

        {!recentFailures || recentFailures.length === 0 ? (
          <div className="p-4 rounded-xl border border-border-subtle bg-surface-elevated/30 text-center text-xs text-status-success flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            No active ingestion failures recorded in the pipeline.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-elevated text-text-muted font-semibold border-b border-border-subtle">
                <tr>
                  <th scope="col" className="p-3">Title / Filename</th>
                  <th scope="col" className="p-3">Error Description</th>
                  <th scope="col" className="p-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/50 text-text-secondary">
                {recentFailures.map((failure) => (
                  <tr key={failure.documentId} className="hover:bg-surface-elevated/30">
                    <td className="p-3">
                      <p className="font-medium text-text-primary">{failure.title || failure.filename}</p>
                      <p className="text-[11px] text-text-muted font-mono">{failure.filename}</p>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-status-error bg-status-error/10 px-2 py-0.5 rounded text-[11px]">
                        {failure.errorMessage}
                      </span>
                    </td>
                    <td className="p-3 text-right text-text-muted whitespace-nowrap">
                      {new Date(failure.failedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
