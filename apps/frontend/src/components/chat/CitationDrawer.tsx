'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { X, FileText, Bookmark, Hash, Layers, ExternalLink } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface CitationItem {
  evidenceId?: string;
  documentId: string;
  source?: string;
  title?: string;
  chunkId: string;
  revision?: number;
  page?: number;
  pageNumber?: number;
  section?: string;
  snippet?: string;
  relevanceScore?: number;
}

export interface CitationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  citations: CitationItem[];
  selectedCitationId?: string | null;
  onSelectCitation?: (citationId: string) => void;
}

export function CitationDrawer({
  isOpen,
  onClose,
  citations,
  selectedCitationId,
  onSelectCitation,
}: CitationDrawerProps) {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock background scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Find active citation or default to first
  const activeCitation =
    citations.find(
      (c) =>
        (c.evidenceId && c.evidenceId === selectedCitationId) ||
        c.chunkId === selectedCitationId ||
        c.documentId === selectedCitationId
    ) || citations[0];

  const sourceTitle = activeCitation?.source || activeCitation?.title || 'Referenced Document';
  const pageNum = activeCitation?.page ?? activeCitation?.pageNumber;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Source Document Details"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-200 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 w-full sm:w-[420px] max-w-[calc(100vw-20px)] bg-surface border-l border-subtle shadow-2xl',
          'flex flex-col justify-between overflow-y-auto animate-slide-up duration-200 z-50'
        )}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-subtle flex items-center justify-between bg-surface-elevated/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-primary leading-tight">Source Citations</h2>
              <p className="text-[11px] text-muted leading-none mt-0.5">
                {citations.length} verified evidence reference{citations.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close citation details"
            className="p-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-elevated transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Citations Tab Navigation if multiple citations exist */}
        {citations.length > 1 && (
          <div className="p-3 border-b border-subtle bg-surface flex items-center gap-2 overflow-x-auto">
            {citations.map((c, idx) => {
              const citId = c.evidenceId || `C${idx + 1}`;
              const isSelected = activeCitation === c;
              return (
                <button
                  key={`tab-${idx}-${citId}`}
                  type="button"
                  onClick={() => onSelectCitation?.(citId)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors min-h-[36px] flex items-center gap-1.5',
                    isSelected
                      ? 'bg-brand-primary text-white shadow-xs'
                      : 'bg-surface-elevated text-secondary hover:text-primary hover:bg-surface-elevated/80'
                  )}
                >
                  <Bookmark className="w-3 h-3" />
                  <span>{citId}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Drawer Content */}
        <div className="flex-1 p-5 space-y-5 overflow-y-auto">
          {activeCitation ? (
            <div className="space-y-4">
              {/* Citation Title & Evidence Tag */}
              <div>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {activeCitation.evidenceId && (
                    <Badge variant="brand" size="sm">
                      Evidence [{activeCitation.evidenceId}]
                    </Badge>
                  )}
                  {activeCitation.revision !== undefined && (
                    <Badge variant="default" size="sm">
                      Rev v{activeCitation.revision}
                    </Badge>
                  )}
                  {activeCitation.relevanceScore !== undefined && (
                    <Badge variant="success" size="sm">
                      {Math.round(activeCitation.relevanceScore * 100)}% Match
                    </Badge>
                  )}
                </div>
                <h3 className="text-base font-semibold text-primary break-words leading-snug">
                  {sourceTitle}
                </h3>
              </div>

              {/* Source Document Metadata Grid */}
              <div className="p-3.5 rounded-lg border border-subtle bg-surface-elevated/50 space-y-2.5 text-xs">
                {pageNum !== undefined && (
                  <div className="flex items-center justify-between text-secondary">
                    <span className="flex items-center gap-1 text-muted">
                      <Layers className="w-3.5 h-3.5" />
                      Page Number
                    </span>
                    <span className="font-semibold text-primary">Page {pageNum}</span>
                  </div>
                )}

                {activeCitation.section && (
                  <div className="flex items-center justify-between text-secondary">
                    <span className="flex items-center gap-1 text-muted">
                      <Bookmark className="w-3.5 h-3.5" />
                      Section
                    </span>
                    <span className="font-semibold text-primary truncate max-w-[200px]">
                      {activeCitation.section}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-secondary">
                  <span className="flex items-center gap-1 text-muted">
                    <Hash className="w-3.5 h-3.5" />
                    Document ID
                  </span>
                  <Link
                    href={`/documents/${activeCitation.documentId}`}
                    className="font-mono text-[11px] text-brand-primary hover:underline inline-flex items-center gap-1 truncate max-w-[180px]"
                    title="Open document details"
                  >
                    <span>{String(activeCitation.documentId)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </Link>
                </div>

                <div className="flex items-center justify-between text-secondary">
                  <span className="flex items-center gap-1 text-muted">
                    <Hash className="w-3.5 h-3.5" />
                    Chunk ID
                  </span>
                  <span className="font-mono text-[11px] text-secondary truncate max-w-[180px]">
                    {String(activeCitation.chunkId)}
                  </span>
                </div>
              </div>

              {/* Snippet / Passage Content */}
              {activeCitation.snippet ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Passage Excerpt
                  </label>
                  <div className="p-3.5 rounded-lg border border-subtle bg-surface text-xs text-primary leading-relaxed whitespace-pre-wrap font-sans">
                    {activeCitation.snippet}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-surface-elevated/40 text-xs text-muted leading-relaxed">
                  Referenced from validated repository document. Full passage access is governed by your active department and clearance level.
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-muted">
              No citation details available for this message.
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-subtle bg-surface flex items-center justify-between gap-3">
          {activeCitation?.documentId ? (
            <Link href={`/documents/${activeCitation.documentId}`}>
              <Button
                variant="outline"
                size="sm"
                className="text-xs font-semibold"
                leftIcon={<ExternalLink className="w-3.5 h-3.5 text-brand-primary" />}
                id="drawer-view-document-btn"
              >
                View Document
              </Button>
            </Link>
          ) : (
            <div />
          )}
          <Button variant="secondary" size="sm" onClick={onClose} className="min-h-[38px]">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
