'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  FileText,
  RotateCcw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  FolderOpen,
  Shield,
  Building,
  Users,
} from 'lucide-react';
import {
  IDocument,
  DocumentStatus,
  IDocumentListResponse,
  ClearanceLevel,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { Button, Badge, Modal, Skeleton, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface DocumentListProps {
  onUploadClick: () => void;
  refreshTrigger?: number;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function DocumentList({ onUploadClick, refreshTrigger }: DocumentListProps) {
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Deletion modal state
  const [deletingDoc, setDeletingDoc] = useState<IDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Retry loading state by document ID
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const isPollingRef = useRef(false);
  const { success, error: showErrorToast } = useToast();

  const fetchDocuments = useCallback(
    async (showLoadingSpinner = true) => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      if (showLoadingSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const params: Record<string, any> = {
          page,
          limit,
        };

        if (statusFilter !== 'ALL') {
          params.status = statusFilter;
        }

        if (departmentFilter.trim()) {
          params.department = departmentFilter.trim();
        }

        const res = await ApiClient.get<IDocumentListResponse>('/api/v1/documents', params);

        if (res && Array.isArray(res.documents)) {
          setDocuments(res.documents);
          setTotal(res.total || 0);
          setTotalPages(res.totalPages || 1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to retrieve documents';
        showErrorToast(msg, 'Repository Error');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        isPollingRef.current = false;
      }
    },
    [page, limit, statusFilter, departmentFilter, showErrorToast]
  );

  // Initial fetch and on filter/page change
  useEffect(() => {
    fetchDocuments(true);
  }, [fetchDocuments, refreshTrigger]);

  // Live polling: automatically poll while any document is in an in-flight status
  useEffect(() => {
    const hasInFlightDocs = documents.some(
      (d) =>
        d.status === DocumentStatus.QUEUED ||
        d.status === DocumentStatus.PROCESSING ||
        d.status === DocumentStatus.INDEXING
    );

    if (!hasInFlightDocs) return;

    const interval = setInterval(() => {
      fetchDocuments(false);
    }, 4000);

    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  // Handle document retry
  const handleRetry = async (doc: IDocument) => {
    setRetryingId(doc.id);
    try {
      await ApiClient.post(`/api/v1/documents/${doc.id}/retry`);
      success(`Ingestion retry initiated for "${doc.title}"`, 'Retry Queued');
      fetchDocuments(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry request failed';
      showErrorToast(msg, 'Retry Error');
    } finally {
      setRetryingId(null);
    }
  };

  // Handle document deletion
  const handleDeleteConfirm = async () => {
    if (!deletingDoc) return;
    setIsDeleting(true);
    try {
      await ApiClient.delete(`/api/v1/documents/${deletingDoc.id}`);
      success(`"${deletingDoc.title}" deleted from vector repository`, 'Deleted');
      setDeletingDoc(null);
      fetchDocuments(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete request failed';
      showErrorToast(msg, 'Delete Error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Client-side search filtering on active page
  const filteredDocuments = documents.filter((doc) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.originalFilename.toLowerCase().includes(q) ||
      (doc.accessControl?.allowedDepartments || []).some((d) => d.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      {/* Search, Filter, and Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface p-4 rounded-xl border border-subtle shadow-xs">
        <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Search Box with explicit current-page filter scope */}
          <div className="relative flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Filter current page by title, filename, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter current page"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-subtle bg-surface-elevated text-xs text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            {searchQuery.trim() && (
              <span
                data-testid="page-filter-indicator"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-brand-primary/10 text-brand-primary border border-brand-primary/20 shrink-0 select-none whitespace-nowrap"
              >
                Showing {filteredDocuments.length} of {documents.length} on current page
              </span>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted shrink-0 hidden sm:inline-block" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by document status"
              className="px-3 py-2 rounded-lg border border-subtle bg-surface-elevated text-xs text-primary outline-none focus:ring-2 focus:ring-brand-primary min-h-[36px]"
            >
              <option value="ALL">All Statuses</option>
              <option value={DocumentStatus.QUEUED}>Queued</option>
              <option value={DocumentStatus.PROCESSING}>Processing</option>
              <option value={DocumentStatus.READY}>Ready</option>
              <option value={DocumentStatus.FAILED}>Failed</option>
            </select>
          </div>
        </div>

        {/* Refresh & Upload Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDocuments(false)}
            isLoading={isRefreshing}
            leftIcon={<RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />}
            aria-label="Refresh document repository"
            title="Refresh repository"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onUploadClick}
            className="whitespace-nowrap"
          >
            Upload Document
          </Button>
        </div>
      </div>

      {/* Documents Table / Card List */}
      <div className="bg-surface rounded-xl border border-subtle shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="text-center py-16 px-4 space-y-3">
            <FolderOpen className="w-12 h-12 mx-auto text-muted/60" />
            <h3 className="text-sm font-semibold text-primary">
              {searchQuery || statusFilter !== 'ALL'
                ? 'No documents match your filter criteria'
                : 'No documents in repository yet'}
            </h3>
            <p className="text-xs text-secondary max-w-sm mx-auto">
              {searchQuery || statusFilter !== 'ALL'
                ? 'Try adjusting your search terms or clearing status filters.'
                : 'Upload policy handbooks, technical runbooks, and SOPs to activate conversational search.'}
            </p>
            {!searchQuery && statusFilter === 'ALL' && (
              <Button
                variant="primary"
                size="sm"
                onClick={onUploadClick}
                className="mt-2"
              >
                Upload First Document
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table View (>= 1024px) */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-elevated/70 border-b border-subtle text-muted font-semibold uppercase tracking-wider select-none">
                  <tr>
                    <th className="py-3 px-4">Document Title</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Clearance</th>
                    <th className="py-3 px-3">Scope / Access</th>
                    <th className="py-3 px-3">Size</th>
                    <th className="py-3 px-3">Chunks</th>
                    <th className="py-3 px-3">Uploaded</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {filteredDocuments.map((doc) => {
                    const isFailed = doc.status === DocumentStatus.FAILED;
                    const canRetry = isFailed;

                    return (
                      <tr
                        key={doc.id}
                        className="hover:bg-surface-elevated/40 transition-colors group"
                      >
                        {/* Title and Filename */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 max-w-[240px]">
                              <p className="font-semibold text-primary truncate leading-tight">
                                {doc.title}
                              </p>
                              <p className="text-[11px] text-muted truncate mt-0.5 font-mono">
                                {doc.originalFilename}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <DocumentStatusBadge
                            status={doc.status}
                            errorMessage={doc.errorMessage}
                          />
                        </td>

                        {/* Minimum Clearance */}
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <Badge variant="info" size="sm">
                            <Shield className="w-3 h-3 mr-1" />
                            {doc.accessControl?.minimumClearance || ClearanceLevel.INTERNAL}
                          </Badge>
                        </td>

                        {/* Scope / Access */}
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap max-w-[200px]">
                            {doc.accessControl?.allowedDepartments?.length > 0 ? (
                              doc.accessControl.allowedDepartments.map((dept) => (
                                <span
                                  key={dept}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-surface-elevated text-secondary border border-subtle truncate max-w-[120px]"
                                >
                                  <Building className="w-2.5 h-2.5 mr-1 text-muted" />
                                  {dept}
                                </span>
                              ))
                            ) : (
                              <span className="text-[11px] text-muted italic">All Departments</span>
                            )}
                          </div>
                        </td>

                        {/* Size */}
                        <td className="py-3.5 px-3 text-secondary font-mono whitespace-nowrap">
                          {formatFileSize(doc.fileSizeBytes)}
                        </td>

                        {/* Chunk Count */}
                        <td className="py-3.5 px-3 text-secondary whitespace-nowrap">
                          {doc.chunkCount > 0 ? `${doc.chunkCount} chunks` : '—'}
                        </td>

                        {/* Upload Date */}
                        <td className="py-3.5 px-3 text-muted whitespace-nowrap">
                          {new Date(doc.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {canRetry && (
                              <button
                                type="button"
                                onClick={() => handleRetry(doc)}
                                disabled={retryingId === doc.id}
                                aria-label={`Retry ingestion for ${doc.title}`}
                                title="Retry processing"
                                className="p-1.5 rounded-lg hover:bg-surface-elevated text-status-warning hover:text-status-warning transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                              >
                                <RotateCcw
                                  className={cn('w-4 h-4', retryingId === doc.id && 'animate-spin')}
                                />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setDeletingDoc(doc)}
                              aria-label={`Delete document: ${doc.title}`}
                              title="Delete document and vector indexes"
                              className="p-1.5 rounded-lg hover:bg-status-error/10 text-muted hover:text-status-error transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Cards (< 1024px) */}
            <div className="lg:hidden divide-y divide-subtle">
              {filteredDocuments.map((doc) => {
                const isFailed = doc.status === DocumentStatus.FAILED;

                return (
                  <div key={doc.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0 mt-0.5">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-primary break-words leading-tight">
                            {doc.title}
                          </p>
                          <p className="text-[11px] text-muted truncate mt-0.5 font-mono">
                            {doc.originalFilename}
                          </p>
                        </div>
                      </div>

                      <DocumentStatusBadge
                        status={doc.status}
                        errorMessage={doc.errorMessage}
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted">
                      <Badge variant="info" size="sm">
                        <Shield className="w-3 h-3 mr-1" />
                        {doc.accessControl?.minimumClearance || ClearanceLevel.INTERNAL}
                      </Badge>

                      <span>{formatFileSize(doc.fileSizeBytes)}</span>
                      <span>&bull;</span>
                      <span>{doc.chunkCount > 0 ? `${doc.chunkCount} chunks` : 'Queued'}</span>
                      <span>&bull;</span>
                      <span>
                        {new Date(doc.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>

                    {isFailed && doc.errorMessage && (
                      <div className="p-2.5 rounded-lg bg-status-error/10 text-status-error text-xs leading-relaxed">
                        {doc.errorMessage}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-subtle/50">
                      {isFailed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(doc)}
                          isLoading={retryingId === doc.id}
                          leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                        >
                          Retry Ingestion
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingDoc(doc)}
                        leftIcon={<Trash2 className="w-3.5 h-3.5 text-status-error" />}
                        className="text-status-error hover:bg-status-error/10"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            <div className="p-4 border-t border-subtle bg-surface-elevated/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-secondary">
              <span className="order-2 sm:order-1">
                Showing{' '}
                <strong className="text-primary">
                  {Math.min((page - 1) * limit + 1, total)}-{Math.min(page * limit, total)}
                </strong>{' '}
                of <strong className="text-primary">{total}</strong> documents
              </span>

              <div className="flex items-center gap-2 order-1 sm:order-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                  aria-label="Previous page"
                >
                  Previous
                </Button>

                <span className="px-2 font-medium">
                  {page} / {Math.max(1, totalPages)}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                  aria-label="Next page"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingDoc)}
        onClose={() => setDeletingDoc(null)}
        title="Delete Document &amp; Vector Indexes"
        description="Are you sure you want to delete this document from the knowledge base?"
      >
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl border border-status-warning/30 bg-status-warning/10 text-xs text-status-warning flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-primary">
                Permanent deletion of &quot;{deletingDoc?.title}&quot;
              </p>
              <p className="leading-relaxed">
                This operation will delete the stored source file, all parsed text chunks, and corresponding point vectors from the Qdrant vector index. It will immediately invalidate cached RAG responses.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeletingDoc(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleDeleteConfirm}
              isLoading={isDeleting}
            >
              Confirm Deletion
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
