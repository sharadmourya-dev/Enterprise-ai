'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@/components/ui';
import { ShieldCheck, Terminal, Award, HelpCircle } from 'lucide-react';

export function RagEvalNoticeCard() {
  return (
    <Card variant="default" className="p-6 border-brand-primary/20 bg-surface-elevated/30">
      <CardHeader className="p-0 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="w-5 h-5 text-brand-primary" />
              Offline RAG Tri-Metric Evaluation Framework
            </CardTitle>
            <Badge variant="outline" className="text-xs border-brand-primary/40 text-brand-primary">
              Offline Suite (CLI / CI)
            </Badge>
          </div>
          <CardDescription>
            Continuous RAG evaluation is executed offline against canonical test datasets to prevent live LLM latency overhead.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="p-0 space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg border border-border-subtle bg-surface">
            <p className="font-semibold text-text-primary flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-status-success" />
              Grounded Faithfulness
            </p>
            <p className="text-text-muted mt-1">
              Verifies answers are strictly derived from retrieved evidence chunks without hallucination.
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border-subtle bg-surface">
            <p className="font-semibold text-text-primary flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-status-info" />
              Answer Relevance
            </p>
            <p className="text-text-muted mt-1">
              Evaluates whether the synthesis directly satisfies the user query intent and tone.
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border-subtle bg-surface">
            <p className="font-semibold text-text-primary flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-brand-primary" />
              Security Abstention
            </p>
            <p className="text-text-muted mt-1">
              Guarantees the copilot abstains when clearance levels or roles forbid document access.
            </p>
          </div>
        </div>

        <div className="p-3 rounded-lg border border-border-subtle bg-canvas flex items-start gap-3">
          <Terminal className="w-4 h-4 text-brand-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-text-primary">Execute Evaluation Suite Locally or in CI/CD</p>
            <p className="text-text-muted">
              Because RAG evaluation runs as a standalone benchmark suite, results are not polled via an HTTP endpoint. Run the offline test runner:
            </p>
            <code className="inline-block mt-1 px-2.5 py-1 rounded bg-surface border border-border-subtle font-mono text-text-primary font-medium">
              npm --workspace=@enterprise-ai/backend run test:rag-eval
            </code>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
