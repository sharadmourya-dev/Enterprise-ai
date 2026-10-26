'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@/components/ui';
import { BookOpen, HelpCircle, FileText, Search, Sparkles } from 'lucide-react';

export interface KnowledgeSourcesViewProps {
  topSources?: Array<{
    documentId: string;
    title: string;
    retrievalCount: number;
  }>;
  topQuestions?: Array<{
    query: string;
    count: number;
  }>;
  isLoading?: boolean;
}

export function KnowledgeSourcesView({
  topSources = [],
  topQuestions = [],
  isLoading = false,
}: KnowledgeSourcesViewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="default" className="p-6">
          <div className="space-y-4 animate-pulse">
            <div className="h-6 w-48 bg-surface-elevated rounded" />
            <div className="h-4 w-72 bg-surface-elevated rounded" />
            <div className="space-y-2 mt-4">
              <div className="h-12 bg-surface-elevated rounded-lg" />
              <div className="h-12 bg-surface-elevated rounded-lg" />
              <div className="h-12 bg-surface-elevated rounded-lg" />
            </div>
          </div>
        </Card>
        <Card variant="default" className="p-6">
          <div className="space-y-4 animate-pulse">
            <div className="h-6 w-48 bg-surface-elevated rounded" />
            <div className="h-4 w-72 bg-surface-elevated rounded" />
            <div className="space-y-2 mt-4">
              <div className="h-12 bg-surface-elevated rounded-lg" />
              <div className="h-12 bg-surface-elevated rounded-lg" />
              <div className="h-12 bg-surface-elevated rounded-lg" />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const hasSources = topSources && topSources.length > 0;
  const hasQuestions = topQuestions && topQuestions.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Most Frequently Retrieved Documents */}
      <Card variant="default" className="p-6 space-y-4">
        <CardHeader className="p-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-brand-primary" />
                Most-Used Knowledge Sources
              </CardTitle>
              <CardDescription className="mt-1">
                Frequently cited documents across copilot retrieval answers in the selected window
              </CardDescription>
            </div>
            {hasSources && (
              <Badge variant="brand" className="text-xs">
                Top {topSources.length}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!hasSources ? (
            <div className="p-8 text-center border border-dashed border-border-subtle rounded-xl text-text-muted text-xs">
              <FileText className="w-8 h-8 text-text-muted mb-2 opacity-50 mx-auto" />
              <p className="font-medium text-text-secondary">No retrieval citations recorded</p>
              <p className="mt-1">Citations will appear as users ask questions answered by the repository.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {topSources.map((source, idx) => (
                <div
                  key={source.documentId || idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated/40 border border-border-subtle/50 text-xs hover:bg-surface-elevated/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="w-6 h-6 rounded-lg bg-brand-primary/10 text-brand-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary truncate" title={source.title}>
                        {source.title}
                      </p>
                      <p className="text-[11px] text-text-muted font-mono">
                        ID: {source.documentId.slice(-8)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs shrink-0">
                    {source.retrievalCount} {source.retrievalCount === 1 ? 'citation' : 'citations'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Most Frequently Asked Questions */}
      <Card variant="default" className="p-6 space-y-4">
        <CardHeader className="p-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-status-info" />
                Most Frequently Asked Questions
              </CardTitle>
              <CardDescription className="mt-1">
                Common user inquiry patterns and frequently submitted prompts
              </CardDescription>
            </div>
            {hasQuestions && (
              <Badge variant="info" className="text-xs">
                Top {topQuestions.length}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!hasQuestions ? (
            <div className="p-8 text-center border border-dashed border-border-subtle rounded-xl text-text-muted text-xs">
              <HelpCircle className="w-8 h-8 text-text-muted mb-2 opacity-50 mx-auto" />
              <p className="font-medium text-text-secondary">No user questions logged</p>
              <p className="mt-1">Common inquiry patterns will populate as employees query the copilot.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {topQuestions.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated/40 border border-border-subtle/50 text-xs hover:bg-surface-elevated/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="w-6 h-6 rounded-lg bg-status-info/10 text-status-info font-bold flex items-center justify-center shrink-0 text-[11px]">
                      {idx + 1}
                    </span>
                    <p className="font-medium text-text-primary truncate italic" title={item.query}>
                      &quot;{item.query}&quot;
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs shrink-0">
                    {item.count} {item.count === 1 ? 'query' : 'queries'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
