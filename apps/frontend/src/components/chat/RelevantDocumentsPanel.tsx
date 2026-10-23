'use client';

import React from 'react';
import Link from 'next/link';
import {
  FileText,
  ExternalLink,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  X,
  Layers,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { CitationItem } from './CitationDrawer';
import { cn } from '@/lib/utils';

export interface RelevantDocumentsPanelProps {
  citations: CitationItem[];
  selectedCitationId?: string | null;
  onSelectCitation: (citationId: string) => void;
  onClose?: () => void;
  className?: string;
}

// File type icon representation matching reference board
function SourceFileIcon({ title }: { title?: string }) {
  const ext = title?.split('.').pop()?.toLowerCase() || '';

  if (ext === 'pdf') {
    return (
      <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold tracking-tight uppercase">PDF</span>
      </div>
    );
  }

  if (ext === 'docx' || ext === 'doc') {
    return (
      <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold tracking-tight uppercase">DOC</span>
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center shrink-0">
      <FileText className="w-4 h-4" />
    </div>
  );
}

export function RelevantDocumentsPanel({
  citations,
  selectedCitationId,
  onSelectCitation,
  onClose,
  className,
}: RelevantDocumentsPanelProps) {
  // Deduplicate citations by documentId or title to show unique documents
  const uniqueDocuments = React.useMemo(() => {
    const map = new Map<string, CitationItem>();
    citations.forEach((c) => {
      const key = c.documentId || c.title || c.source || c.chunkId;
      if (!map.has(key)) {
        map.set(key, c);
      }
    });
    return Array.from(map.values());
  }, [citations]);

  return (
    <aside
      aria-label="Relevant Documents Panel"
      className={cn(
        'flex flex-col h-full bg-surface border-l border-subtle select-none overflow-hidden',
        className
      )}
    >
      {/* Panel Header */}
      <div className="h-14 px-4 border-b border-subtle flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-brand-primary shrink-0" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-primary truncate">
            Relevant Documents
          </h2>
          {citations.length > 0 && (
            <Badge variant="brand" size="sm">
              {citations.length}
            </Badge>
          )}
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close relevant documents panel"
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Documents List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {uniqueDocuments.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-surface-elevated text-muted mx-auto flex items-center justify-center border border-subtle">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-primary">No sources cited yet</p>
              <p className="text-[11px] text-muted mt-1 leading-relaxed">
                Documents cited in responses will appear here with page numbers and verification metadata.
              </p>
            </div>
          </div>
        ) : (
          uniqueDocuments.map((doc, idx) => {
            const citId = doc.evidenceId || doc.chunkId || doc.documentId;
            const isSelected = selectedCitationId === citId;
            const title = doc.source || doc.title || 'Corporate Document';
            const pageText =
              doc.page ?? doc.pageNumber
                ? `Page ${doc.page ?? doc.pageNumber}`
                : doc.section
                ? doc.section
                : 'Verified Excerpt';

            return (
              <button
                key={`doc-card-${idx}-${doc.chunkId || doc.documentId}`}
                type="button"
                onClick={() => onSelectCitation(citId)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-all duration-150 flex items-start gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                  isSelected
                    ? 'border-brand-primary bg-brand-primary/10 shadow-xs'
                    : 'border-subtle bg-surface hover:bg-surface-elevated hover:border-brand-primary/30'
                )}
              >
                <SourceFileIcon title={title} />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-primary group-hover:text-brand-primary transition-colors truncate leading-tight">
                    {title}
                  </p>

                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted">
                    <span className="font-medium text-brand-primary">{doc.evidenceId ? `[${doc.evidenceId}]` : `Source #${idx + 1}`}</span>
                    <span>&bull;</span>
                    <span className="truncate">{pageText}</span>
                  </div>

                  {doc.snippet && (
                    <p className="text-[11px] text-secondary mt-1.5 line-clamp-2 leading-relaxed">
                      &ldquo;{doc.snippet}&rdquo;
                    </p>
                  )}
                </div>

                <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-brand-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
              </button>
            );
          })
        )}
      </div>

      {/* Footer link to Repository */}
      <div className="p-3 border-t border-subtle bg-surface-elevated/40 text-xs shrink-0">
        <Link
          href="/documents"
          className="flex items-center justify-between text-secondary hover:text-brand-primary font-medium p-1 transition-colors group"
        >
          <span className="text-[11px]">Browse all repository files</span>
          <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </aside>
  );
}
