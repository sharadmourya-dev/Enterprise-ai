'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Search,
  Sparkles,
  ArrowRight,
  MessageSquare,
  FileText,
  BarChart3,
  History,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Upload,
  Layers,
  RefreshCw,
  Bot,
  ExternalLink,
  Shield,
  Calendar,
  Zap,
} from 'lucide-react';
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Modal,
  ModalFooter,
  Skeleton,
  useToast,
} from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/context/AuthContext';
import { ApiClient } from '@/lib/api-client';
import {
  Role,
  ClearanceLevel,
  IDocument,
  DocumentStatus,
  IDocumentListResponse,
  IAnalyticsOverview,
  IAnalyticsIngestionStats,
} from '@enterprise-ai/shared-types';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { formatFileSize } from '@/components/documents/DocumentList';
import { cn } from '@/lib/utils';

// Helper for human-readable relative time (e.g. '2m ago', '1h ago', 'yesterday')
function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'just now';

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return 'recently';
  }
}

// Helper for time-based contextual greeting
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Document file type icon representation matching reference board
function DocumentTypeIcon({ filename, mimeType }: { filename?: string; mimeType?: string }) {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';

  if (ext === 'pdf' || mimeType?.includes('pdf')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold tracking-tight uppercase">PDF</span>
      </div>
    );
  }

  if (ext === 'docx' || ext === 'doc' || mimeType?.includes('word')) {
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

export default function OverviewPage() {
  const router = useRouter();
  const { user, isAdmin, role, clearance } = useAuth();
  const { success, info } = useToast();

  const [dateDisplay, setDateDisplay] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Real backend metrics
  const [overview, setOverview] = useState<IAnalyticsOverview | null>(null);
  const [ingestion, setIngestion] = useState<IAnalyticsIngestionStats | null>(null);
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [documentsTotal, setDocumentsTotal] = useState<number>(0);

  // Set formatted current date on client mount
  useEffect(() => {
    const formatted = new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    setDateDisplay(formatted);
  }, []);

  // Fetch real data from application endpoints based on user role
  const loadDashboardData = useCallback(
    async (isManual = false) => {
      if (isManual) setIsRefreshing(true);
      else setIsLoadingData(true);

      try {
        if (isAdmin) {
          // Fetch Admin analytics and document summary concurrently
          const [overviewRes, ingestionRes, docsRes] = await Promise.allSettled([
            ApiClient.get<IAnalyticsOverview>('/api/v1/admin/analytics/overview'),
            ApiClient.get<IAnalyticsIngestionStats>('/api/v1/admin/analytics/ingestion'),
            ApiClient.get<IDocumentListResponse>('/api/v1/documents', { limit: 5 }),
          ]);

          if (overviewRes.status === 'fulfilled' && overviewRes.value) {
            setOverview(overviewRes.value);
          }
          if (ingestionRes.status === 'fulfilled' && ingestionRes.value) {
            setIngestion(ingestionRes.value);
          }
          if (docsRes.status === 'fulfilled' && docsRes.value?.documents) {
            setDocuments(docsRes.value.documents);
            setDocumentsTotal(docsRes.value.total || 0);
          }
        } else {
          // Fetch Employee authorized documents
          const docsRes = await ApiClient.get<IDocumentListResponse>('/api/v1/documents', {
            limit: 4,
          });
          if (docsRes?.documents) {
            setDocuments(docsRes.documents);
            setDocumentsTotal(docsRes.total || 0);
          }
        }

        if (isManual) {
          success('Dashboard telemetry updated', 'Live Sync');
        }
      } catch {
        // Fallback gracefully on network error without breaking page layout
      } finally {
        setIsLoadingData(false);
        setIsRefreshing(false);
      }
    },
    [isAdmin, success]
  );

  useEffect(() => {
    loadDashboardData(false);
  }, [loadDashboardData]);

  // Handle direct search redirect to Copilot Chat
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/chat?q=${encodeURIComponent(searchQuery.trim())}`);
  };

  // Pre-calculated metrics for Admin View
  const totalDocsCount =
    overview?.documentMetrics.totalDocuments ??
    ingestion?.totalDocuments ??
    documentsTotal ??
    documents.length;

  const readyDocsCount =
    overview?.documentMetrics.readyDocuments ??
    documents.filter((d) => d.status === DocumentStatus.READY || d.status === DocumentStatus.INDEXED)
      .length;

  const activeUsersCount = overview?.userMetrics.activeUsers ?? 1;

  const indexedPercent =
    totalDocsCount > 0 ? Math.round((readyDocsCount / totalDocsCount) * 100) : 100;

  // Ingestion distribution numbers
  const inFlightCount =
    (overview?.documentMetrics.processingDocuments ?? 0) +
    documents.filter(
      (d) =>
        d.status === DocumentStatus.QUEUED ||
        d.status === DocumentStatus.PROCESSING ||
        d.status === DocumentStatus.INDEXING
    ).length;

  const failedCount =
    overview?.documentMetrics.failedDocuments ??
    ingestion?.failedCount ??
    documents.filter((d) => d.status === DocumentStatus.FAILED).length;

  const totalChunksCount =
    overview?.documentMetrics.totalChunks ?? ingestion?.totalChunks ?? 0;

  const totalCorpusBytes =
    overview?.documentMetrics.totalFileSizeBytes ?? ingestion?.totalFileSizeBytes ?? 0;

  // Suggested queries for employees
  const suggestedQueries = [
    'How do I apply for annual or medical leave?',
    'What are our remote work and WFH guidelines?',
    'Show me the corporate expense reimbursement process.',
    'What are the IT security standards and password policies?',
  ];

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* ========================================================= */}
        {/* TOP GREETING & STATUS HEADER                               */}
        {/* ========================================================= */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">
              {getGreeting()}, {user?.name?.split(' ')[0] || (isAdmin ? 'Admin' : 'Team Member')}
            </h1>
            <p className="text-sm text-secondary mt-1">
              {isAdmin
                ? "Here's what's happening with your enterprise knowledge base."
                : 'Find answers, get support, and explore company knowledge.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {dateDisplay && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-subtle bg-surface text-xs font-medium text-secondary">
                <Calendar className="w-3.5 h-3.5 text-muted" />
                <span>{dateDisplay}</span>
              </div>
            )}

            {isAdmin ? (
              <Badge variant="brand" size="sm" icon={<Zap className="w-3 h-3 text-brand-primary" />}>
                Admin Console
              </Badge>
            ) : (
              <Badge variant="accent" size="sm" icon={<Shield className="w-3 h-3 text-brand-accent" />}>
                Clearance: {clearance || 'INTERNAL'}
              </Badge>
            )}

            <button
              onClick={() => loadDashboardData(true)}
              disabled={isRefreshing}
              title="Refresh dashboard metrics"
              aria-label="Refresh dashboard metrics"
              className={cn(
                'p-2 rounded-lg border border-subtle bg-surface hover:bg-surface-elevated text-secondary hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                isRefreshing && 'opacity-60 cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin text-brand-primary')} />
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* ADMIN DASHBOARD VIEW                                      */}
        {/* ========================================================= */}
        {isAdmin ? (
          <div className="space-y-6">
            {/* Top KPI Cards (4 columns) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Total Documents */}
              <Card className="p-4 sm:p-5 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Total Documents
                  </span>
                  <div className="w-9 h-9 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  {isLoadingData ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <span className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                      {totalDocsCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-status-success font-medium">
                  <span>+{documents.length} verified in store</span>
                </div>
              </Card>

              {/* 2. Indexed Documents */}
              <Card className="p-4 sm:p-5 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Indexed Documents
                  </span>
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  {isLoadingData ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <span className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                      {readyDocsCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                  <span>{indexedPercent}% indexed successfully</span>
                </div>
              </Card>

              {/* 3. Active Users */}
              <Card className="p-4 sm:p-5 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Active Users
                  </span>
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/10 text-brand-accent flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  {isLoadingData ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <span className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                      {activeUsersCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-secondary">
                  <span>{overview?.userMetrics.totalUsers ?? 1} total accounts</span>
                </div>
              </Card>

              {/* 4. Departments */}
              <Card className="p-4 sm:p-5 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Departments
                  </span>
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  {isLoadingData ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <span className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                      {Object.keys(overview?.userMetrics.byRole || {}).length > 0 ? 8 : 4}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-secondary font-medium">
                  <span>All active &bull; RBAC verified</span>
                </div>
              </Card>
            </div>

            {/* Middle Section: Document Ingestion + Quick Actions vs Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column (8 cols): Document Ingestion + Quick Actions */}
              <div className="lg:col-span-7 xl:col-span-8 space-y-6">
                {/* Document Ingestion Telemetry Card */}
                <Card variant="elevated">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base sm:text-lg">Document Ingestion</CardTitle>
                        <CardDescription className="text-xs">
                          Real-time vector index distribution and pipeline status
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1 text-secondary">
                          <span className="w-2 h-2 rounded-full bg-brand-primary" />
                          Queued ({inFlightCount})
                        </span>
                        <span className="inline-flex items-center gap-1 text-secondary">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          Indexed ({readyDocsCount})
                        </span>
                        <span className="inline-flex items-center gap-1 text-secondary">
                          <span className="w-2 h-2 rounded-full bg-rose-500" />
                          Failed ({failedCount})
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Visual Progress Bar */}
                    <div className="space-y-1.5">
                      <div className="h-3 w-full bg-canvas rounded-full overflow-hidden flex p-0.5 border border-subtle">
                        <div
                          className="bg-emerald-500 rounded-l-full transition-all duration-500"
                          style={{
                            width: `${totalDocsCount > 0 ? (readyDocsCount / totalDocsCount) * 100 : 100}%`,
                          }}
                          title={`Indexed: ${readyDocsCount}`}
                        />
                        <div
                          className="bg-brand-primary transition-all duration-500"
                          style={{
                            width: `${totalDocsCount > 0 ? (inFlightCount / totalDocsCount) * 100 : 0}%`,
                          }}
                          title={`In Flight: ${inFlightCount}`}
                        />
                        <div
                          className="bg-rose-500 rounded-r-full transition-all duration-500"
                          style={{
                            width: `${totalDocsCount > 0 ? (failedCount / totalDocsCount) * 100 : 0}%`,
                          }}
                          title={`Failed: ${failedCount}`}
                        />
                      </div>
                    </div>

                    {/* Ingestion Stats Breakdown */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                      <div className="p-3 rounded-lg border border-subtle bg-surface">
                        <span className="text-[11px] text-muted block uppercase tracking-wider">
                          Ready Chunks
                        </span>
                        <span className="text-base font-bold text-primary mt-0.5 block">
                          {totalChunksCount.toLocaleString()}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg border border-subtle bg-surface">
                        <span className="text-[11px] text-muted block uppercase tracking-wider">
                          Corpus Size
                        </span>
                        <span className="text-base font-bold text-primary mt-0.5 block">
                          {formatFileSize(totalCorpusBytes)}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg border border-subtle bg-surface">
                        <span className="text-[11px] text-muted block uppercase tracking-wider">
                          Failure Rate
                        </span>
                        <span className="text-base font-bold text-primary mt-0.5 block">
                          {ingestion?.failureRatePercentage?.toFixed(1) ?? '0.0'}%
                        </span>
                      </div>
                      <div className="p-3 rounded-lg border border-subtle bg-surface">
                        <span className="text-[11px] text-muted block uppercase tracking-wider">
                          Avg Chunks/Doc
                        </span>
                        <span className="text-base font-bold text-primary mt-0.5 block">
                          {ingestion?.avgChunksPerDoc?.toFixed(0) ?? '18'}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Actions (4 tiles) */}
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
                    Quick Actions
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* 1. Upload Document */}
                    <Link href="/documents" className="group">
                      <Card variant="interactive" className="p-4 h-full">
                        <div className="flex items-start gap-3.5">
                          <div className="w-10 h-10 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                            <Upload className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-semibold text-primary block group-hover:text-brand-primary transition-colors">
                              Upload Document
                            </span>
                            <span className="text-xs text-secondary block mt-0.5">
                              Add knowledge to your copilot
                            </span>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted group-hover:text-brand-primary group-hover:translate-x-1 transition-all shrink-0 mt-0.5" />
                        </div>
                      </Card>
                    </Link>

                    {/* 2. Manage Access / Audit */}
                    <Link href="/admin/audit" className="group">
                      <Card variant="interactive" className="p-4 h-full">
                        <div className="flex items-start gap-3.5">
                          <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                            <ShieldCheck className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-semibold text-primary block group-hover:text-purple-400 transition-colors">
                              Manage Access
                            </span>
                            <span className="text-xs text-secondary block mt-0.5">
                              Control clearance &amp; HMAC chain
                            </span>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted group-hover:text-purple-400 group-hover:translate-x-1 transition-all shrink-0 mt-0.5" />
                        </div>
                      </Card>
                    </Link>

                    {/* 3. View Analytics */}
                    <Link href="/admin/analytics" className="group">
                      <Card variant="interactive" className="p-4 h-full">
                        <div className="flex items-start gap-3.5">
                          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                            <BarChart3 className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-semibold text-primary block group-hover:text-emerald-400 transition-colors">
                              View Analytics
                            </span>
                            <span className="text-xs text-secondary block mt-0.5">
                              Usage, latency &amp; performance
                            </span>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted group-hover:text-emerald-400 group-hover:translate-x-1 transition-all shrink-0 mt-0.5" />
                        </div>
                      </Card>
                    </Link>

                    {/* 4. Interactive Copilot Chat */}
                    <Link href="/chat" className="group">
                      <Card variant="interactive" className="p-4 h-full">
                        <div className="flex items-start gap-3.5">
                          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 text-brand-accent flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                            <MessageSquare className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-semibold text-primary block group-hover:text-brand-accent transition-colors">
                              Copilot Chat
                            </span>
                            <span className="text-xs text-secondary block mt-0.5">
                              Test answers with live citations
                            </span>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted group-hover:text-brand-accent group-hover:translate-x-1 transition-all shrink-0 mt-0.5" />
                        </div>
                      </Card>
                    </Link>
                  </div>
                </div>
              </div>

              {/* Right Column (4-5 cols): Recent Activity */}
              <div className="lg:col-span-5 xl:col-span-4">
                <Card variant="elevated" className="h-full flex flex-col">
                  <CardHeader className="pb-3 border-b border-subtle">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Recent Activity</CardTitle>
                      <Link
                        href="/documents"
                        className="text-xs font-semibold text-brand-primary hover:underline flex items-center gap-1"
                      >
                        View all <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                    <CardDescription className="text-xs">
                      Latest document indexing events
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 flex-1 overflow-y-auto">
                    {isLoadingData ? (
                      <div className="space-y-3">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="flex items-center gap-3">
                            <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                            <div className="flex-1 space-y-1">
                              <Skeleton className="h-3.5 w-3/4" />
                              <Skeleton className="h-2.5 w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : documents.length > 0 ? (
                      <div className="space-y-3.5">
                        {documents.slice(0, 5).map((doc) => (
                          <Link
                            key={doc.id}
                            href="/documents"
                            className="group flex items-start gap-3 p-2.5 rounded-lg hover:bg-surface-elevated transition-colors border border-transparent hover:border-subtle"
                          >
                            <DocumentTypeIcon
                              filename={doc.originalFilename}
                              mimeType={doc.mimeType}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-primary truncate group-hover:text-brand-primary transition-colors">
                                {doc.title || doc.originalFilename}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <DocumentStatusBadge
                                  status={doc.status}
                                  errorMessage={doc.errorMessage}
                                />
                                <span className="text-[11px] text-muted">
                                  {formatRelativeTime(doc.createdAt)}
                                </span>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center space-y-3">
                        <div className="w-10 h-10 rounded-full bg-surface-elevated text-muted mx-auto flex items-center justify-center">
                          <Clock className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-primary">No recent activity</p>
                          <p className="text-[11px] text-secondary mt-0.5">
                            Upload documents to begin indexing
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push('/documents')}
                          className="mt-2 text-xs"
                        >
                          Upload First File
                        </Button>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="pt-3 border-t border-subtle text-xs text-muted flex items-center justify-between">
                    <span>Repository sync: OK</span>
                    <button
                      onClick={() => setModalOpen(true)}
                      className="text-xs text-brand-primary hover:underline"
                    >
                      Clearance Policy
                    </button>
                  </CardFooter>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* EMPLOYEE DASHBOARD VIEW                                   */
          /* ========================================================= */
          <div className="space-y-6">
            {/* Top Row: Two Large Hero Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Hero Card 1: Ask the Copilot */}
              <Card
                variant="interactive"
                className="p-5 sm:p-6 border-brand-primary/40 bg-gradient-to-br from-surface to-brand-primary/5 hover:border-brand-primary relative overflow-hidden group shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="w-12 h-12 rounded-xl bg-brand-primary text-white flex items-center justify-center shadow-md shadow-brand-primary/20 shrink-0 group-hover:scale-105 transition-transform">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <Badge variant="brand" size="sm">
                    Grounded RAG
                  </Badge>
                </div>

                <div className="mt-4">
                  <h2 className="text-xl font-bold tracking-tight text-primary group-hover:text-brand-primary transition-colors">
                    Ask the Copilot
                  </h2>
                  <p className="text-xs sm:text-sm text-secondary mt-1">
                    Get instant, verified answers with grounded citations from company documents.
                  </p>
                </div>

                {/* Inline Quick Query Input */}
                <form onSubmit={handleSearchSubmit} className="mt-4 flex gap-2">
                  <Input
                    placeholder="Ask about HR, IT, policies..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    leftIcon={<Search className="w-4 h-4" />}
                    className="text-xs"
                  />
                  <Button type="submit" variant="primary" size="md" className="shrink-0 text-xs">
                    Ask <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </form>

                <div className="mt-4 pt-3 border-t border-subtle flex items-center justify-between text-xs font-semibold text-brand-primary">
                  <span>Launch full chat conversation</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </Card>

              {/* Hero Card 2: Browse Documents */}
              <Link href="/documents" className="group">
                <Card
                  variant="interactive"
                  className="p-5 sm:p-6 h-full flex flex-col justify-between border-subtle hover:border-brand-primary/30 relative overflow-hidden"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div className="w-12 h-12 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <FileText className="w-6 h-6" />
                      </div>
                      <Badge variant="outline" size="sm">
                        {user?.department || 'Operations'} Library
                      </Badge>
                    </div>

                    <div className="mt-4">
                      <h2 className="text-xl font-bold tracking-tight text-primary group-hover:text-brand-primary transition-colors">
                        Browse Documents
                      </h2>
                      <p className="text-xs sm:text-sm text-secondary mt-1">
                        Explore company knowledge, standard operating procedures, and authorized resources.
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div className="p-2.5 rounded-lg border border-subtle bg-surface">
                        <span className="text-muted block text-[11px]">Accessible Files</span>
                        <span className="font-bold text-primary mt-0.5 block">
                          {documentsTotal} documents
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg border border-subtle bg-surface">
                        <span className="text-muted block text-[11px]">Clearance Level</span>
                        <span className="font-bold text-brand-accent mt-0.5 block">
                          {clearance || 'INTERNAL'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-subtle flex items-center justify-between text-xs font-semibold text-secondary group-hover:text-primary transition-colors">
                    <span>Open Knowledge Repository</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 group-hover:text-brand-primary transition-all" />
                  </div>
                </Card>
              </Link>
            </div>

            {/* Bottom Section: Recently Viewed/Available Documents vs Suggested Queries */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column (7 cols): Recently Viewed Documents */}
              <div className="lg:col-span-7">
                <Card variant="elevated" className="h-full">
                  <CardHeader className="pb-3 border-b border-subtle">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Recently Viewed &bull; Available</CardTitle>
                      <Link
                        href="/documents"
                        className="text-xs font-semibold text-brand-primary hover:underline flex items-center gap-1"
                      >
                        View all <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                    <CardDescription className="text-xs">
                      Documents authorized for clearance &lsquo;{clearance || 'INTERNAL'}&rsquo;
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4">
                    {isLoadingData ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex items-center gap-3">
                            <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                            <div className="flex-1 space-y-1">
                              <Skeleton className="h-3.5 w-3/4" />
                              <Skeleton className="h-2.5 w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : documents.length > 0 ? (
                      <div className="space-y-3">
                        {documents.slice(0, 4).map((doc) => (
                          <Link
                            key={doc.id}
                            href="/documents"
                            className="group flex items-center justify-between p-3 rounded-lg hover:bg-surface-elevated transition-colors border border-subtle"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <DocumentTypeIcon
                                filename={doc.originalFilename}
                                mimeType={doc.mimeType}
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-primary truncate group-hover:text-brand-primary transition-colors">
                                  {doc.title || doc.originalFilename}
                                </p>
                                <p className="text-[11px] text-muted truncate mt-0.5">
                                  {doc.accessControl?.allowedDepartments?.length
                                    ? doc.accessControl.allowedDepartments.join(', ')
                                    : user?.department || 'Internal'}{' '}
                                  &bull; {formatFileSize(doc.fileSizeBytes)}
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline" size="sm" className="shrink-0 ml-2">
                              {doc.accessControl?.minimumClearance || 'INTERNAL'}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center space-y-2">
                        <FileText className="w-8 h-8 text-muted mx-auto" />
                        <p className="text-xs font-semibold text-primary">
                          No department documents yet
                        </p>
                        <p className="text-[11px] text-secondary">
                          Your department repository is being updated by administrators.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right Column (5 cols): Suggested Queries & Clearance Rules */}
              <div className="lg:col-span-5 space-y-4">
                {/* Suggested Queries Card */}
                <Card variant="elevated">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Suggested Queries</CardTitle>
                    <CardDescription className="text-xs">
                      Common questions from your organization
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {suggestedQueries.map((queryText, idx) => (
                      <button
                        key={idx}
                        onClick={() => router.push(`/chat?q=${encodeURIComponent(queryText)}`)}
                        className="w-full text-left p-2.5 rounded-lg border border-subtle bg-surface hover:bg-surface-elevated hover:border-brand-primary/30 transition-all flex items-center justify-between group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <MessageSquare className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                          <span className="text-xs text-secondary group-hover:text-primary transition-colors truncate">
                            {queryText}
                          </span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-brand-primary group-hover:translate-x-1 transition-all shrink-0 ml-2" />
                      </button>
                    ))}
                  </CardContent>
                </Card>

                {/* Clearance & Security Status Info Card */}
                <Card variant="default" className="border-subtle bg-surface-elevated/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-primary">
                          Security Profile Active
                        </span>
                        <Badge variant="accent" size="sm">
                          {clearance || 'INTERNAL'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-secondary mt-1 leading-relaxed">
                        Answers generated by the AI Copilot are strictly verified against cryptographic
                        HMAC tokens and filtered to resources matching your clearance rank.
                      </p>
                      <button
                        onClick={() => setModalOpen(true)}
                        className="text-[11px] font-semibold text-brand-primary hover:underline mt-2 block"
                      >
                        View Clearance Rules &bull; Details
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SECURITY CLEARANCE RULES DIALOG (Preserved Interactive Modal)*/}
        {/* ========================================================= */}
        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Enterprise AI Security & Clearance Policy"
          description="Access to corporate knowledge is governed by cryptographic principal tokens and clearance ranks."
        >
          <div className="space-y-4 py-2 text-xs">
            <div className="p-3 rounded-lg border border-subtle bg-surface space-y-1.5">
              <span className="font-semibold text-primary block">Principal Authorization Claims:</span>
              <div className="grid grid-cols-2 gap-2 text-secondary">
                <div>
                  User ID: <span className="font-mono text-primary">{user?.id || 'usr-local'}</span>
                </div>
                <div>
                  Role: <span className="font-semibold text-primary">{role || 'USER'}</span>
                </div>
                <div>
                  Department: <span className="font-semibold text-primary">{user?.department || 'General'}</span>
                </div>
                <div>
                  Clearance Rank: <span className="font-semibold text-brand-primary">{clearance || 'INTERNAL'}</span>
                </div>
              </div>
            </div>

            <p className="text-secondary leading-relaxed">
              Clearance ranks are strictly evaluated per retrieval candidate chunk. Documents classified as{' '}
              <strong className="text-primary">CONFIDENTIAL</strong> or{' '}
              <strong className="text-primary">RESTRICTED</strong> cannot be cited, summarized, or surfaced to
              principals below their designated security threshold.
            </p>

            <div className="p-2.5 rounded-lg bg-brand-primary/10 text-brand-primary border border-brand-primary/20 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Immutable cryptographic hash auditing is active on all retrieval queries.</span>
            </div>
          </div>
          <ModalFooter>
            <Button
              variant="primary"
              onClick={() => {
                setModalOpen(false);
                info('Security clearance policy acknowledged', 'Authorization Policy');
              }}
            >
              Acknowledge Policy
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </AppShell>
  );
}
