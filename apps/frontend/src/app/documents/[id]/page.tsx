'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  FileText,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  RefreshCw,
  Trash2,
  MessageSquare,
  Clock,
  Layers,
  Database,
  Calendar,
  Lock,
  Building,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  Role,
  ClearanceLevel,
  DocumentStatus,
  IDocument,
} from '@enterprise-ai/shared-types';
import { AppShell } from '@/components/layout/AppShell';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import {
  formatFileSize,
  formatUploadedDate,
  renderFileTypeBadge,
  renderClearanceBadge,
  renderDepartmentBadge,
} from '@/components/documents/DocumentList';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Modal,
  ModalFooter,
  Skeleton,
  useToast,
} from '@/components/ui';
import { ApiClient, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isAdmin, clearance } = useAuth();
  const { success, error: showErrorToast } = useToast();

  const id = typeof params?.id === 'string' ? params.id : '';

  const [document, setDocument] = useState<IDocument | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Retry & Deletion state
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDocument = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setErrorStatus(null);
    setErrorMessage(null);

    try {
      const data = await ApiClient.get<IDocument>(`/api/v1/documents/${id}`);
      setDocument(data);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setErrorStatus(err.statusCode);
        setErrorMessage(err.message);
      } else {
        setErrorStatus(500);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to retrieve document');
      }
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const handleRetry = async () => {
    if (!document) return;
    setIsRetrying(true);
    try {
      await ApiClient.post(`/api/v1/documents/${document.id || (document as any)._id}/retry`);
      success(`Ingestion retry initiated for "${document.title}"`, 'Retry Queued');
      await fetchDocument();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry failed';
      showErrorToast(msg, 'Retry Error');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDelete = async () => {
    if (!document) return;
    setIsDeleting(true);
    try {
      const docId = document.id || (document as any)._id;
      const endpoint = isAdmin ? `/api/v1/admin/documents/${docId}` : `/api/v1/documents/${docId}`;
      await ApiClient.delete(endpoint);
      success(`"${document.title}" has been deleted`, 'Document Deleted');
      setIsDeleteModalOpen(false);
      router.push('/documents');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deletion failed';
      showErrorToast(msg, 'Delete Error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAskCopilot = () => {
    if (!document) return;
    const query = encodeURIComponent(`Tell me about the contents of "${document.title}"`);
    router.push(`/chat?q=${query}`);
  };

  // Determine deletion eligibility (Admins or Document Owners)
  const isOwner = Boolean(
    user && (document?.uploadedBy === user.id || (document as any)?.uploadedBy?.toString() === user.id)
  );
  const canDelete = isAdmin || isOwner;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-muted">
          <Link
            href="/documents"
            className="flex items-center gap-1.5 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary rounded"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Documents</span>
          </Link>
          <span>/</span>
          <span className="text-secondary font-medium truncate max-w-[240px]">
            {document?.title || (isLoading ? 'Loading...' : id)}
          </span>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5">
              <div className="space-y-2">
                <Skeleton className="h-8 w-64 rounded-lg" />
                <Skeleton className="h-4 w-40 rounded" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-10 w-28 rounded-lg" />
                <Skeleton className="h-10 w-24 rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Skeleton className="h-56 rounded-xl md:col-span-2" />
              <Skeleton className="h-56 rounded-xl" />
            </div>
          </div>
        )}

        {/* Error States */}
        {!isLoading && errorStatus && (
          <Card className="border-subtle p-8 text-center max-w-lg mx-auto space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-status-error/10 text-status-error flex items-center justify-center mx-auto border border-status-error/20">
              {errorStatus === 403 ? (
                <Lock className="w-7 h-7" />
              ) : errorStatus === 404 ? (
                <FileText className="w-7 h-7" />
              ) : (
                <AlertCircle className="w-7 h-7" />
              )}
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-primary">
                {errorStatus === 403
                  ? 'Access Restricted'
                  : errorStatus === 404
                  ? 'Document Not Found'
                  : errorStatus === 400
                  ? 'Invalid Document ID'
                  : 'Unable to Load Document'}
              </h2>
              <p className="text-xs text-secondary leading-relaxed">
                {errorMessage ||
                  (errorStatus === 403
                    ? `You do not have the required security clearance (${clearance}) or departmental permission to view this document.`
                    : errorStatus === 404
                    ? 'The requested document does not exist, or it may have been deleted.'
                    : 'An error occurred while loading this document record.')}
              </p>
            </div>

            <div className="pt-2 flex justify-center gap-3">
              <Link href="/documents">
                <Button variant="outline" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
                  Back to Documents
                </Button>
              </Link>
              <Button variant="primary" size="sm" onClick={fetchDocument} leftIcon={<RefreshCw className="w-4 h-4" />}>
                Try Again
              </Button>
            </div>
          </Card>
        )}

        {/* Document Details Content */}
        {!isLoading && document && (
          <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-subtle pb-5">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {renderFileTypeBadge(document.originalFilename, document.mimeType)}
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary break-words">
                    {document.title}
                  </h1>
                  <DocumentStatusBadge status={document.status} />
                </div>
                <p className="text-xs text-muted font-mono truncate">
                  Original: {document.originalFilename}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAskCopilot}
                  leftIcon={<MessageSquare className="w-4 h-4" />}
                  id="ask-copilot-doc-btn"
                >
                  Ask Copilot
                </Button>

                {document.status === DocumentStatus.FAILED && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    isLoading={isRetrying}
                    leftIcon={<RefreshCw className="w-4 h-4" />}
                    id="retry-ingestion-doc-btn"
                  >
                    Retry Ingestion
                  </Button>
                )}

                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="text-secondary hover:text-status-error"
                    leftIcon={<Trash2 className="w-4 h-4" />}
                    id="delete-doc-btn"
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>

            {/* Failure Alert Box if document failed processing */}
            {document.status === DocumentStatus.FAILED && (
              <div className="p-4 rounded-xl border border-status-error/30 bg-status-error/10 text-status-error text-xs sm:text-sm flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="font-semibold">Ingestion Failure Details</p>
                  <p className="text-xs text-status-error/90 font-mono break-words">
                    {document.errorMessage || 'Processing timed out or text extraction encountered an unsupported format.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                  isLoading={isRetrying}
                  className="shrink-0"
                >
                  Retry
                </Button>
              </div>
            )}

            {/* Grid Information Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: Processing & Ingestion Status */}
              <Card className="md:col-span-2 border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-primary" />
                    Ingestion &amp; Vector Index Status
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Pipeline processing metrics and semantic vector embeddings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg bg-surface-elevated border border-subtle">
                    <div>
                      <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold">
                        Status
                      </span>
                      <div className="mt-1">
                        <DocumentStatusBadge status={document.status} />
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold">
                        Indexed Chunks
                      </span>
                      <span className="text-base font-bold text-primary block mt-0.5">
                        {document.chunkCount ?? 0}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold">
                        Indexed Tokens
                      </span>
                      <span className="text-base font-bold text-primary block mt-0.5">
                        {(document.tokenCount ?? 0).toLocaleString()}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold">
                        Revision
                      </span>
                      <span className="text-base font-bold text-primary block mt-0.5">
                        v{document.currentRevision ?? 1}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-secondary leading-relaxed">
                    {document.status === DocumentStatus.READY
                      ? 'This document is active in the vector database and ready for grounded retrieval queries.'
                      : document.status === DocumentStatus.PROCESSING
                      ? 'This document is actively being parsed, chunked, and embedded into vector storage.'
                      : document.status === DocumentStatus.QUEUED
                      ? 'This document is in the ingestion queue awaiting worker execution.'
                      : document.status === DocumentStatus.FAILED
                      ? 'Processing encountered an error during parsing or vector indexing.'
                      : 'Status is updating.'}
                  </p>
                </CardContent>
              </Card>

              {/* Card 2: Security & Access Control (ACL) */}
              <Card className="border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-brand-primary" />
                    Access Control (ACL)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Clearance and departmental access restrictions
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold mb-1">
                      Minimum Clearance
                    </span>
                    {renderClearanceBadge(document.accessControl?.minimumClearance)}
                  </div>

                  <div>
                    <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold mb-1">
                      Authorized Departments
                    </span>
                    {renderDepartmentBadge(document.accessControl?.allowedDepartments)}
                  </div>

                  <div>
                    <span className="text-[11px] text-muted block uppercase tracking-wider font-semibold mb-1">
                      Authorized Roles
                    </span>
                    {document.accessControl?.allowedRoles && document.accessControl.allowedRoles.length > 0 ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {document.accessControl.allowedRoles.map((r) => (
                          <Badge key={r} variant="default" size="sm">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-secondary font-medium">All Roles</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: File & Storage Metadata */}
              <Card className="md:col-span-3 border-subtle">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Database className="w-4 h-4 text-brand-primary" />
                    File Metadata
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <dt className="text-muted text-[11px] font-semibold uppercase tracking-wider">File Size</dt>
                      <dd className="font-semibold text-primary mt-1">{formatFileSize(document.fileSizeBytes || 0)}</dd>
                    </div>

                    <div>
                      <dt className="text-muted text-[11px] font-semibold uppercase tracking-wider">MIME Type</dt>
                      <dd className="font-semibold text-primary mt-1 font-mono text-[11px]">{document.mimeType || 'unknown'}</dd>
                    </div>

                    <div>
                      <dt className="text-muted text-[11px] font-semibold uppercase tracking-wider">Created</dt>
                      <dd className="font-semibold text-primary mt-1">{formatUploadedDate(typeof document.createdAt === 'string' ? document.createdAt : new Date(document.createdAt).toISOString())}</dd>
                    </div>

                    <div>
                      <dt className="text-muted text-[11px] font-semibold uppercase tracking-wider">Last Updated</dt>
                      <dd className="font-semibold text-primary mt-1">{formatUploadedDate(typeof document.updatedAt === 'string' ? document.updatedAt : new Date(document.updatedAt).toISOString())}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <Modal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          title="Delete Document & Vector Embeddings"
          description={`Are you sure you want to permanently delete "${document?.title}"?`}
        >
          <div className="space-y-3 py-2 text-xs text-secondary">
            <p>
              This operation will permanently remove the document record, all parsed text chunks, and corresponding point vectors from Qdrant. Any cached RAG answers referencing this document will be invalidated.
            </p>
            <p className="font-semibold text-status-error">
              This action cannot be undone.
            </p>
          </div>
          <ModalFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              isLoading={isDeleting}
            >
              Confirm Deletion
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </AppShell>
  );
}
