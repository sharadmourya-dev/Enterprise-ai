import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  Role,
  ClearanceLevel,
  AuditAction,
  AuditResourceType,
  IAnalyticsOverview,
  IAnalyticsDailyTrend,
  IAnalyticsIngestionStats,
} from '@enterprise-ai/shared-types';

import {
  AnalyticsKpiCard,
  TrendChart,
  IngestionStatsView,
  FeedbackBreakdownView,
  RagEvalNoticeCard,
  AnalyticsDashboard,
  AuditChainVerifier,
  AuditLogTable,
  AuditDashboard,
} from './index';

// Mock matchMedia for jsdom
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

// Mock AuthContext
jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider defaultTheme="light">
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>
  );
}

describe('Admin Analytics & Audit Log UI — Milestone 6 Integration', () => {
  const mockAdminUser = {
    id: 'admin-123',
    email: 'admin@enterprise.com',
    name: 'Security Admin',
    role: Role.ADMIN,
    securityClearance: ClearanceLevel.RESTRICTED,
    department: 'InfoSec',
  };

  const sampleOverview: IAnalyticsOverview = {
    userMetrics: {
      totalUsers: 50,
      activeUsers: 38,
      byRole: { admin: 3, user: 45, compliance_officer: 2 },
      byClearance: { public: 10, internal: 25, confidential: 12, restricted: 3 },
    },
    documentMetrics: {
      totalDocuments: 120,
      readyDocuments: 110,
      failedDocuments: 4,
      processingDocuments: 6,
      totalChunks: 2400,
      totalFileSizeBytes: 104857600, // 100 MB
    },
    conversationMetrics: {
      totalConversations: 310,
      totalMessages: 1840,
      userMessages: 920,
      assistantMessages: 920,
    },
    queryMetrics: {
      totalQueries: 950,
      successQueries: 920,
      filteredEmptyQueries: 15,
      errorQueries: 15,
      totalTokensConsumed: 850000,
      averageLatencyMs: 420,
      p95LatencyMs: 980,
      cacheHitRatePercentage: 42.5,
    },
    feedbackMetrics: {
      totalFeedback: 80,
      thumbsUp: 70,
      thumbsDown: 10,
      positivePercentage: 87.5,
      categoryBreakdown: {
        accurate_helpful: 65,
        hallucination: 6,
        irrelevant_context: 4,
      },
    },
  };

  const sampleTrends: IAnalyticsDailyTrend[] = [
    {
      date: '2026-10-18',
      queryCount: 120,
      successCount: 115,
      errorCount: 5,
      totalTokens: 110000,
      avgLatencyMs: 410,
      activeConversations: 45,
    },
    {
      date: '2026-10-19',
      queryCount: 150,
      successCount: 148,
      errorCount: 2,
      totalTokens: 145000,
      avgLatencyMs: 395,
      activeConversations: 55,
    },
    {
      date: '2026-10-20',
      queryCount: 180,
      successCount: 175,
      errorCount: 5,
      totalTokens: 170000,
      avgLatencyMs: 430,
      activeConversations: 62,
    },
  ];

  const sampleIngestionStats: IAnalyticsIngestionStats = {
    totalDocuments: 120,
    byStatus: { ready: 110, failed: 4, processing: 6 },
    totalChunks: 2400,
    totalFileSizeBytes: 104857600,
    avgChunksPerDoc: 20.0,
    failedCount: 4,
    failureRatePercentage: 3.3,
    recentFailures: [
      {
        documentId: 'doc-fail-1',
        title: 'Q3 Financials Unparsed',
        filename: 'financials_q3.pdf',
        errorMessage: 'Corrupt PDF trailer syntax',
        failedAt: '2026-10-20T14:30:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      user: mockAdminUser,
      role: Role.ADMIN,
      clearance: ClearanceLevel.RESTRICTED,
      isAdmin: true,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  describe('1. AnalyticsKpiCard', () => {
    it('renders metric title, formatted value, and contextual subtext', () => {
      renderWithProviders(
        <AnalyticsKpiCard
          title="Total Queries"
          value="950"
          subtitle="920 passed, 15 errors"
          testId="kpi-test"
        />
      );

      expect(screen.getByText('Total Queries')).toBeInTheDocument();
      expect(screen.getByText('950')).toBeInTheDocument();
      expect(screen.getByText('920 passed, 15 errors')).toBeInTheDocument();
    });

    it('renders skeleton during loading and handles null value with fallback dash without fabricating data', () => {
      const { rerender } = renderWithProviders(
        <AnalyticsKpiCard title="Cache Hit Rate" value={null} isLoading={true} />
      );

      // Skeletons should be present while loading
      expect(screen.getByText('Cache Hit Rate')).toBeInTheDocument();

      rerender(
        <ThemeProvider defaultTheme="light">
          <ToastProvider>
            <AnalyticsKpiCard title="Cache Hit Rate" value={null} isLoading={false} />
          </ToastProvider>
        </ThemeProvider>
      );

      // Dash fallback rendered
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('2. TrendChart Component', () => {
    it('renders pure SVG chart with accurate day bars and switches to accessible table view', () => {
      renderWithProviders(<TrendChart trends={sampleTrends} />);

      // Chart heading & badge
      expect(screen.getByText('Daily Query Volume')).toBeInTheDocument();
      expect(screen.getByText('3 days')).toBeInTheDocument();

      // SVG role element present
      const svg = screen.getByRole('img');
      expect(svg).toBeInTheDocument();

      // Toggle to accessible table view
      const tableButton = screen.getByLabelText('Table View');
      fireEvent.click(tableButton);

      // Table should be rendered
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('2026-10-18')).toBeInTheDocument();
      expect(screen.getByText('2026-10-19')).toBeInTheDocument();
      expect(screen.getByText('2026-10-20')).toBeInTheDocument();
    });

    it('switches between query, token, latency, and conversation metrics', () => {
      renderWithProviders(<TrendChart trends={sampleTrends} />);

      // Switch to Token Consumption
      fireEvent.click(screen.getByRole('button', { name: 'Tokens' }));
      expect(screen.getByText('Token Consumption')).toBeInTheDocument();

      // Switch to Latency
      fireEvent.click(screen.getByRole('button', { name: 'Latency' }));
      expect(screen.getByText('Average Latency')).toBeInTheDocument();

      // Switch to Conversations
      fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));
      expect(screen.getByText('Active Conversations')).toBeInTheDocument();
    });

    it('displays empty state message when trends array is empty', () => {
      renderWithProviders(<TrendChart trends={[]} />);
      expect(screen.getByText('No trend data available')).toBeInTheDocument();
    });
  });

  describe('3. IngestionStatsView & FeedbackBreakdownView', () => {
    it('renders document counts, chunk distribution, and failure table with error description', () => {
      renderWithProviders(<IngestionStatsView stats={sampleIngestionStats} />);

      expect(screen.getByText('Ingestion Pipeline & Storage Telemetry')).toBeInTheDocument();
      expect(screen.getByText('3.3% Failure Rate')).toBeInTheDocument();
      expect(screen.getByText('100 MB')).toBeInTheDocument();
      expect(screen.getByText('Q3 Financials Unparsed')).toBeInTheDocument();
      expect(screen.getByText('Corrupt PDF trailer syntax')).toBeInTheDocument();
    });

    it('renders feedback sentiment ratios and category breakdown bars', () => {
      renderWithProviders(
        <FeedbackBreakdownView feedbackMetrics={sampleOverview.feedbackMetrics} />
      );

      expect(screen.getByText('87.5% Positive')).toBeInTheDocument();
      expect(screen.getByText(/Accurate & Helpful/)).toBeInTheDocument();
      expect(screen.getByText(/Hallucination \/ Fabrication/)).toBeInTheDocument();
    });
  });

  describe('4. RagEvalNoticeCard', () => {
    it('explains offline tri-metric evaluation architecture and CLI test command', () => {
      renderWithProviders(<RagEvalNoticeCard />);

      expect(screen.getByText('Offline RAG Tri-Metric Evaluation Framework')).toBeInTheDocument();
      expect(screen.getByText('Offline Suite (CLI / CI)')).toBeInTheDocument();
      expect(screen.getByText('Grounded Faithfulness')).toBeInTheDocument();
      expect(screen.getByText('Answer Relevance')).toBeInTheDocument();
      expect(screen.getByText('Security Abstention')).toBeInTheDocument();
      expect(screen.getByText(/npm --workspace=@enterprise-ai\/backend run test:rag-eval/)).toBeInTheDocument();
    });
  });

  describe('5. AnalyticsDashboard Integration', () => {
    it('concurrently fetches overview, trends, and ingestion data and populates KPIs', async () => {
      const getSpy = jest.spyOn(ApiClient, 'get').mockImplementation((endpoint: string) => {
        if (endpoint === '/api/v1/admin/analytics/overview') return Promise.resolve(sampleOverview);
        if (endpoint === '/api/v1/admin/analytics/trends') return Promise.resolve(sampleTrends);
        if (endpoint === '/api/v1/admin/analytics/ingestion') return Promise.resolve(sampleIngestionStats);
        return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
      });

      renderWithProviders(<AnalyticsDashboard />);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/analytics/overview', expect.any(Object));
        expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/analytics/trends', expect.any(Object));
        expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/analytics/ingestion');
        expect(screen.getByTestId('kpi-total-queries')).toHaveTextContent('950');
        expect(screen.getByTestId('kpi-cache-hit-rate')).toHaveTextContent('42.5%');
        expect(screen.getByTestId('kpi-avg-latency')).toHaveTextContent('420 ms');
        expect(screen.getByTestId('kpi-active-users')).toHaveTextContent('38');
      });
    });

    it('renders retryable error banner when analytics endpoints fail', async () => {
      jest.spyOn(ApiClient, 'get').mockRejectedValue(new Error('Gateway Timeout 504'));

      renderWithProviders(<AnalyticsDashboard />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load complete analytics')).toBeInTheDocument();
        expect(screen.getAllByText('Gateway Timeout 504').length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('switches time windows (7D, 14D, 30D, 90D) and dispatches updated queries', async () => {
      const getSpy = jest.spyOn(ApiClient, 'get').mockImplementation((endpoint: string) => {
        if (endpoint.includes('overview')) return Promise.resolve(sampleOverview);
        if (endpoint.includes('trends')) return Promise.resolve(sampleTrends);
        if (endpoint.includes('ingestion')) return Promise.resolve(sampleIngestionStats);
        return Promise.resolve(null);
      });

      renderWithProviders(<AnalyticsDashboard />);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalled();
      });

      // Click 7D button
      fireEvent.click(screen.getByRole('button', { name: '7D' }));

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/analytics/overview', expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String),
        }));
      });
    });
  });

  describe('6. Cryptographic AuditChainVerifier', () => {
    it('executes verification and renders green confirmed badge when hash chain is valid', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValueOnce({
        isValid: true,
        totalVerified: 1420,
        error: null,
        atSequence: null,
        details: null,
        verifiedAt: '2026-10-21T11:00:00.000Z',
        processIsolationNotice: 'Audit chain sequence writes are synchronized via atomic MongoDB counter.',
      });

      renderWithProviders(<AuditChainVerifier />);

      const verifyBtn = screen.getByTestId('verify-chain-button');
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(screen.getByText('Chain Intact & Valid')).toBeInTheDocument();
        expect(screen.getByText('Cryptographic Integrity Confirmed')).toBeInTheDocument();
        expect(screen.getByText(/1,420/)).toBeInTheDocument();
      });
    });

    it('detects tampering and renders critical violation alert with sequence number and error code', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValueOnce({
        isValid: false,
        totalVerified: 2,
        error: 'TAMPER_DETECTED_INVALID_HMAC: Entry at sequence 3 was modified',
        atSequence: 3,
        details: { expected: 'hash_abc', recalculated: 'hash_xyz' },
        verifiedAt: '2026-10-21T11:00:00.000Z',
        processIsolationNotice: 'Audit chain sequence writes are synchronized via atomic MongoDB counter.',
      });

      renderWithProviders(<AuditChainVerifier />);

      const verifyBtn = screen.getByTestId('verify-chain-button');
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(screen.getAllByText('Tamper Detected').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('CRITICAL INTEGRITY VIOLATION DETECTED')).toBeInTheDocument();
        expect(screen.getAllByText(/TAMPER_DETECTED_INVALID_HMAC/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Sequence #3/).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('7. AuditLogTable Component', () => {
    const sampleLogsResponse = {
      logs: [
        {
          id: 'log-1',
          sequenceNumber: 101,
          previousHash: 'prev_hash_100',
          userId: 'user-456',
          action: AuditAction.DOC_UPLOAD,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: 'doc_sec_report_99',
          ipAddress: '192.168.1.105',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          status: 'success' as const,
          details: { mimeType: 'application/pdf', sizeBytes: 1024000 },
          tamperHash: 'tamper_hmac_sha256_hash_101',
          createdAt: '2026-10-21T10:30:00.000Z',
        },
        {
          id: 'log-2',
          sequenceNumber: 102,
          previousHash: 'tamper_hmac_sha256_hash_101',
          userId: 'user-789',
          action: AuditAction.AUTH_FAILED_LOGIN,
          resourceType: AuditResourceType.USER,
          resourceId: 'user-789',
          ipAddress: '203.0.113.42',
          userAgent: 'curl/7.68.0',
          status: 'denied' as const,
          details: { reason: 'INVALID_CREDENTIALS', attemptCount: 3 },
          tamperHash: 'tamper_hmac_sha256_hash_102',
          createdAt: '2026-10-21T10:32:00.000Z',
        },
      ],
      pagination: {
        total: 2,
        page: 1,
        limit: 25,
        totalPages: 1,
      },
    };

    it('renders audit entries, formats sequence numbers, and expands HMAC hashes upon inspection', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValue(sampleLogsResponse);

      renderWithProviders(<AuditLogTable />);

      await waitFor(() => {
        expect(screen.getByText('#101')).toBeInTheDocument();
        expect(screen.getByText('#102')).toBeInTheDocument();
        expect(screen.getAllByText('document.upload').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('auth.failed_login').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Denied').length).toBeGreaterThanOrEqual(1);
      });

      // Expand details for sequence #101
      const inspectBtn = screen.getByLabelText('Toggle details for sequence #101');
      fireEvent.click(inspectBtn);

      // Verify HMAC hash and details revealed
      expect(screen.getByText('tamper_hmac_sha256_hash_101')).toBeInTheDocument();
      expect(screen.getByText('prev_hash_100')).toBeInTheDocument();
      expect(screen.getByText(/application\/pdf/)).toBeInTheDocument();
    });

    it('updates query filters and requests filtered audit records', async () => {
      const getSpy = jest.spyOn(ApiClient, 'get').mockResolvedValue(sampleLogsResponse);

      renderWithProviders(<AuditLogTable />);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalled();
      });

      // Filter by Outcome = Denied
      const outcomeSelect = screen.getByLabelText('Outcome:');
      fireEvent.change(outcomeSelect, { target: { value: 'denied' } });

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/audit/logs', expect.objectContaining({
          status: 'denied',
        }));
      });
    });

    it('strictly guarantees read-only audit log view without edit, delete, or mutation controls', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValue(sampleLogsResponse);

      renderWithProviders(<AuditLogTable />);

      await waitFor(() => {
        expect(screen.getByText('#101')).toBeInTheDocument();
      });

      // Assert that no delete, edit, or modify buttons exist
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /modify/i })).not.toBeInTheDocument();
    });
  });
});
