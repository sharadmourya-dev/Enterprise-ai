import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AnalyticsDashboard } from './analytics/AnalyticsDashboard';
import { KnowledgeSourcesView } from './analytics/KnowledgeSourcesView';
import { TrendChart } from './analytics/TrendChart';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import {
  IAnalyticsOverview,
  IAnalyticsDailyTrend,
  IAnalyticsIngestionStats,
  FeedbackRating,
  FeedbackCategory,
} from '@enterprise-ai/shared-types';

jest.mock('@/lib/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
  },
}));

const mockOverview: IAnalyticsOverview = {
  userMetrics: {
    totalUsers: 142,
    activeUsers: 128,
    byRole: { user: 120, knowledge_manager: 15, admin: 7 },
    byClearance: { public: 50, internal: 60, confidential: 25, restricted: 7 },
  },
  documentMetrics: {
    totalDocuments: 86,
    readyDocuments: 81,
    failedDocuments: 3,
    processingDocuments: 2,
    totalChunks: 2140,
    totalFileSizeBytes: 45000000,
  },
  conversationMetrics: {
    totalConversations: 530,
    totalMessages: 2840,
    userMessages: 1420,
    assistantMessages: 1420,
  },
  queryMetrics: {
    totalQueries: 1420,
    successQueries: 1350,
    filteredEmptyQueries: 35,
    errorQueries: 35,
    totalTokensConsumed: 850000,
    averageLatencyMs: 412,
    p95LatencyMs: 980,
    cacheHitRatePercentage: 42.5,
  },
  feedbackMetrics: {
    totalFeedback: 120,
    thumbsUp: 102,
    thumbsDown: 18,
    positivePercentage: 85.0,
    categoryBreakdown: {
      [FeedbackCategory.ACCURATE_HELPFUL]: 102,
      [FeedbackCategory.MISSING_INFORMATION]: 10,
      [FeedbackCategory.OUTDATED]: 8,
    },
  },
  topSources: [
    {
      documentId: 'doc-source-1',
      title: 'Enterprise IT Security Policy 2026',
      retrievalCount: 142,
    },
    {
      documentId: 'doc-source-2',
      title: 'Global Employee Handbook',
      retrievalCount: 98,
    },
  ],
  topQuestions: [
    {
      query: 'What is our expense reimbursement timeline?',
      count: 45,
    },
    {
      query: 'How do I request AWS sandbox access?',
      count: 32,
    },
  ],
};

const mockTrends: IAnalyticsDailyTrend[] = [
  {
    date: '2026-10-20',
    queryCount: 110,
    successCount: 105,
    errorCount: 5,
    totalTokens: 65000,
    avgLatencyMs: 380,
    activeConversations: 42,
  },
  {
    date: '2026-10-21',
    queryCount: 135,
    successCount: 130,
    errorCount: 5,
    totalTokens: 82000,
    avgLatencyMs: 410,
    activeConversations: 55,
  },
];

const mockIngestion: IAnalyticsIngestionStats = {
  totalDocuments: 86,
  byStatus: {
    ready: 81,
    failed: 3,
    processing: 2,
  },
  totalChunks: 2140,
  totalFileSizeBytes: 45000000,
  avgChunksPerDoc: 24.8,
  failedCount: 3,
  failureRatePercentage: 3.5,
  recentFailures: [
    {
      documentId: 'doc-fail-1',
      title: 'Corrupted Ingestion Archive.pdf',
      filename: 'corrupted_archive.pdf',
      errorMessage: 'Invalid PDF trailer signature',
      failedAt: '2026-10-25T10:00:00Z',
    },
  ],
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider defaultTheme="dark">
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>
  );
}

describe('Admin Analytics & Telemetry Dashboard', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. KPI Metric Rendering', () => {
    it('fetches and renders all required Section 7.A KPI metric cards', async () => {
      (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/admin/analytics/overview')) return Promise.resolve(mockOverview);
        if (url.includes('/admin/analytics/trends')) return Promise.resolve(mockTrends);
        if (url.includes('/admin/analytics/ingestion')) return Promise.resolve(mockIngestion);
        return Promise.reject(new Error('Unknown URL'));
      });

      renderWithProviders(<AnalyticsDashboard />);

      // Wait for data load
      await waitFor(() => {
        expect(screen.getByTestId('kpi-total-queries')).toHaveTextContent('1,420');
      });

      // Total Queries & Errors
      expect(within(screen.getByTestId('kpi-total-queries')).getByText('1,420')).toBeInTheDocument();
      expect(screen.getByText(/1350 passed, 35 errors/i)).toBeInTheDocument();

      // Average Response Time
      expect(within(screen.getByTestId('kpi-avg-latency')).getByText('412 ms')).toBeInTheDocument();
      expect(screen.getByText(/p95 latency: 980 ms/i)).toBeInTheDocument();

      // Retrieval Success Rate
      expect(screen.getByText('95.1%')).toBeInTheDocument();

      // Total & Active Users
      expect(within(screen.getByTestId('kpi-total-users')).getByText('142')).toBeInTheDocument();
      expect(within(screen.getByTestId('kpi-active-users')).getByText('128')).toBeInTheDocument();

      // Total & Ready Documents
      expect(within(screen.getByTestId('kpi-total-documents')).getByText('86')).toBeInTheDocument();
      expect(within(screen.getByTestId('kpi-ready-documents')).getByText('81')).toBeInTheDocument();

      // Processing Failures
      expect(within(screen.getByTestId('kpi-failed-documents')).getByText('3')).toBeInTheDocument();

      // Sentiment
      expect(within(screen.getByTestId('kpi-positive-sentiment')).getByText('85%')).toBeInTheDocument();
      expect(screen.getByText(/102 positive, 18 negative/i)).toBeInTheDocument();
    });
  });

  describe('2. Most-Used Knowledge Sources & Top Questions', () => {
    it('renders top cited documents and user inquiry patterns', () => {
      renderWithProviders(
        <KnowledgeSourcesView
          topSources={mockOverview.topSources}
          topQuestions={mockOverview.topQuestions}
          isLoading={false}
        />
      );

      expect(screen.getByText('Enterprise IT Security Policy 2026')).toBeInTheDocument();
      expect(screen.getByText('142 citations')).toBeInTheDocument();
      expect(screen.getByText('Global Employee Handbook')).toBeInTheDocument();
      expect(screen.getByText('98 citations')).toBeInTheDocument();

      expect(screen.getByText(/"What is our expense reimbursement timeline\?"/i)).toBeInTheDocument();
      expect(screen.getByText('45 queries')).toBeInTheDocument();
      expect(screen.getByText(/"How do I request AWS sandbox access\?"/i)).toBeInTheDocument();
      expect(screen.getByText('32 queries')).toBeInTheDocument();
    });

    it('renders clean empty state when no knowledge sources or questions exist', () => {
      renderWithProviders(
        <KnowledgeSourcesView topSources={[]} topQuestions={[]} isLoading={false} />
      );

      expect(screen.getByText('No retrieval citations recorded')).toBeInTheDocument();
      expect(screen.getByText('No user questions logged')).toBeInTheDocument();
    });
  });

  describe('3. Time-Range Filtering and Date Controls', () => {
    it('requests analytics with updated date bounds when a time filter is selected', async () => {
      (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/admin/analytics/overview')) return Promise.resolve(mockOverview);
        if (url.includes('/admin/analytics/trends')) return Promise.resolve(mockTrends);
        if (url.includes('/admin/analytics/ingestion')) return Promise.resolve(mockIngestion);
        return Promise.reject(new Error('Unknown URL'));
      });

      renderWithProviders(<AnalyticsDashboard />);

      await waitFor(() => {
        expect(ApiClient.get).toHaveBeenCalledWith(
          '/api/v1/admin/analytics/overview',
          expect.any(Object)
        );
      });

      // Wait for initial render to finish
      await waitFor(() => {
        expect(screen.getByTestId('kpi-total-queries')).toBeInTheDocument();
      });

      // Click 7D filter button
      const sevenDayBtn = screen.getByRole('button', { name: '7D' });
      fireEvent.click(sevenDayBtn);

      await waitFor(() => {
        expect(ApiClient.get).toHaveBeenCalledWith(
          '/api/v1/admin/analytics/overview',
          expect.objectContaining({
            startDate: expect.any(String),
            endDate: expect.any(String),
          })
        );
      });
    });

    it('validates custom date range and rejects invalid ranges', async () => {
      (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/admin/analytics/overview')) return Promise.resolve(mockOverview);
        if (url.includes('/admin/analytics/trends')) return Promise.resolve(mockTrends);
        if (url.includes('/admin/analytics/ingestion')) return Promise.resolve(mockIngestion);
        return Promise.resolve({});
      });

      renderWithProviders(<AnalyticsDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId('kpi-total-queries')).toBeInTheDocument();
      });

      // Switch to custom
      const customBtn = screen.getByRole('button', { name: 'Custom' });
      fireEvent.click(customBtn);

      const fromInput = screen.getByLabelText(/From:/i);
      const toInput = screen.getByLabelText(/To:/i);

      // Enter start date after end date
      fireEvent.change(fromInput, { target: { value: '2026-10-25' } });
      fireEvent.change(toInput, { target: { value: '2026-10-10' } });

      const form = fromInput.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        const errors = screen.getAllByText('Start date cannot be after end date');
        expect(errors.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('4. Error Handling and Retry State', () => {
    it('renders actionable error banner with retry button when API fails', async () => {
      (ApiClient.get as jest.Mock).mockRejectedValueOnce(
        new Error('Failed to connect to analytics aggregation service')
      );

      renderWithProviders(<AnalyticsDashboard />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load complete analytics')).toBeInTheDocument();
        const matches = screen.getAllByText('Failed to connect to analytics aggregation service');
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });

      // Verify retry button is clickable
      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      expect(retryBtn).toBeInTheDocument();

      (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/admin/analytics/overview')) return Promise.resolve(mockOverview);
        if (url.includes('/admin/analytics/trends')) return Promise.resolve(mockTrends);
        if (url.includes('/admin/analytics/ingestion')) return Promise.resolve(mockIngestion);
        return Promise.resolve({});
      });

      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByText('Unable to load complete analytics')).not.toBeInTheDocument();
      });
    });
  });

  describe('5. TrendChart Accessibility and Modes', () => {
    it('switches between visual SVG bar chart and accessible data table', () => {
      renderWithProviders(<TrendChart trends={mockTrends} isLoading={false} />);

      expect(screen.getByRole('img')).toBeInTheDocument();

      // Switch to table view
      const tableBtn = screen.getByLabelText('Table View');
      fireEvent.click(tableBtn);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('2026-10-20')).toBeInTheDocument();
      expect(screen.getByText('2026-10-21')).toBeInTheDocument();
    });
  });
});
