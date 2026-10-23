import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OverviewPage from './page';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import {
  Role,
  ClearanceLevel,
  DocumentStatus,
  DocumentMimeType,
  ISafeUser,
} from '@enterprise-ai/shared-types';

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

// Mock Next.js navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/',
}));

// Mock AuthContext
jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock ApiClient
jest.mock('@/lib/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockAdminUser: ISafeUser = {
  id: 'usr-admin-1',
  email: 'admin@enterprise.ai',
  name: 'John Morley',
  department: 'Information Technology',
  role: Role.ADMIN,
  securityClearance: ClearanceLevel.RESTRICTED,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockEmployeeUser: ISafeUser = {
  id: 'usr-emp-2',
  email: 'priya@enterprise.ai',
  name: 'Priya Sharma',
  department: 'Operations',
  role: Role.USER,
  securityClearance: ClearanceLevel.CONFIDENTIAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockOverviewData = {
  userMetrics: {
    totalUsers: 24,
    activeUsers: 18,
    byRole: { [Role.ADMIN]: 2, [Role.USER]: 22 },
    byClearance: { [ClearanceLevel.INTERNAL]: 20, [ClearanceLevel.RESTRICTED]: 4 },
  },
  documentMetrics: {
    totalDocuments: 142,
    readyDocuments: 128,
    failedDocuments: 2,
    processingDocuments: 12,
    totalChunks: 2560,
    totalFileSizeBytes: 104857600,
  },
  conversationMetrics: {
    totalConversations: 85,
    totalMessages: 340,
    userMessages: 170,
    assistantMessages: 170,
  },
  queryMetrics: {
    totalQueries: 512,
    successQueries: 500,
    filteredEmptyQueries: 10,
    errorQueries: 2,
    totalTokensConsumed: 128000,
    averageLatencyMs: 240,
    p95LatencyMs: 450,
    cacheHitRatePercentage: 42.5,
  },
  feedbackMetrics: {
    totalFeedback: 40,
    thumbsUp: 36,
    thumbsDown: 4,
    positivePercentage: 90,
    categoryBreakdown: {},
  },
};

const mockIngestionData = {
  totalDocuments: 142,
  byStatus: { ready: 128, processing: 12, failed: 2 },
  totalChunks: 2560,
  totalFileSizeBytes: 104857600,
  avgChunksPerDoc: 18,
  failedCount: 2,
  failureRatePercentage: 1.4,
  recentFailures: [],
};

const mockDocumentsList = {
  documents: [
    {
      id: 'doc-1',
      title: 'Employee Handbook 2026.pdf',
      originalFilename: 'Employee Handbook 2026.pdf',
      mimeType: DocumentMimeType.PDF,
      fileSizeBytes: 2400000,
      fileHash: 'hash1',
      status: DocumentStatus.READY,
      chunkCount: 24,
      tokenCount: 4800,
      currentRevision: 1,
      uploadedBy: 'usr-admin-1',
      accessControl: {
        allowedRoles: [],
        allowedDepartments: ['HR', 'Operations'],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'doc-2',
      title: 'IT Security Policy.docx',
      originalFilename: 'IT Security Policy.docx',
      mimeType: DocumentMimeType.DOCX,
      fileSizeBytes: 1200000,
      fileHash: 'hash2',
      status: DocumentStatus.READY,
      chunkCount: 16,
      tokenCount: 3200,
      currentRevision: 1,
      uploadedBy: 'usr-admin-1',
      accessControl: {
        allowedRoles: [],
        allowedDepartments: ['IT'],
        minimumClearance: ClearanceLevel.RESTRICTED,
        allowedUserIds: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  total: 2,
  page: 1,
  limit: 5,
  totalPages: 1,
};

function renderComponent() {
  return render(
    <ThemeProvider defaultTheme="dark">
      <ToastProvider>
        <OverviewPage />
      </ToastProvider>
    </ThemeProvider>
  );
}

describe('Overview Dashboard — Redesigned Experience', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Admin Role Overview', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({
        user: mockAdminUser,
        isAuthenticated: true,
        isLoading: false,
        role: Role.ADMIN,
        clearance: ClearanceLevel.RESTRICTED,
        isAdmin: true,
        hasRole: () => true,
        hasClearance: () => true,
        logout: jest.fn(),
      });

      (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/v1/admin/analytics/overview')) {
          return Promise.resolve(mockOverviewData);
        }
        if (url.includes('/api/v1/admin/analytics/ingestion')) {
          return Promise.resolve(mockIngestionData);
        }
        if (url.includes('/api/v1/documents')) {
          return Promise.resolve(mockDocumentsList);
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });
    });

    it('renders greeting, Admin Console badge, and top KPI cards', async () => {
      renderComponent();

      // Check header greeting
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John');
      expect(screen.getByText('Admin Console')).toBeInTheDocument();

      // Check KPI Cards
      expect(screen.getByText('Total Documents')).toBeInTheDocument();
      expect(screen.getByText('Indexed Documents')).toBeInTheDocument();
      expect(screen.getByText('Active Users')).toBeInTheDocument();
      expect(screen.getByText('Departments')).toBeInTheDocument();

      // Wait for async metrics to load
      await waitFor(() => {
        expect(screen.getByText('142')).toBeInTheDocument();
        expect(screen.getByText('128')).toBeInTheDocument();
        expect(screen.getAllByText('18').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders Document Ingestion panel with telemetry stats', async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Document Ingestion')).toBeInTheDocument();
        expect(screen.getByText('Ready Chunks')).toBeInTheDocument();
        expect(screen.getByText('2,560')).toBeInTheDocument();
        expect(screen.getByText('1.4%')).toBeInTheDocument();
      });
    });

    it('renders Quick Actions tiles for administrators', async () => {
      renderComponent();

      expect(screen.getByText('Upload Document')).toBeInTheDocument();
      expect(screen.getByText('Manage Access')).toBeInTheDocument();
      expect(screen.getByText('View Analytics')).toBeInTheDocument();
      expect(screen.getAllByText('Copilot Chat').length).toBeGreaterThanOrEqual(2);
    });

    it('renders Recent Activity list with real documents and relative timestamps', async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Recent Activity')).toBeInTheDocument();
        expect(screen.getByText('Employee Handbook 2026.pdf')).toBeInTheDocument();
        expect(screen.getByText('IT Security Policy.docx')).toBeInTheDocument();
      });
    });

    it('opens and acknowledges Security Clearance policy dialog', async () => {
      renderComponent();

      const policyTrigger = screen.getByText('Clearance Policy');
      fireEvent.click(policyTrigger);

      expect(
        screen.getByRole('dialog', { name: /Enterprise AI Security & Clearance Policy/i })
      ).toBeInTheDocument();

      const acknowledgeBtn = screen.getByRole('button', { name: /Acknowledge Policy/i });
      fireEvent.click(acknowledgeBtn);

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: /Enterprise AI Security & Clearance Policy/i })
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('Employee Role Overview', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({
        user: mockEmployeeUser,
        isAuthenticated: true,
        isLoading: false,
        role: Role.USER,
        clearance: ClearanceLevel.CONFIDENTIAL,
        isAdmin: false,
        hasRole: () => false,
        hasClearance: () => true,
        logout: jest.fn(),
      });

      (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/v1/documents')) {
          return Promise.resolve(mockDocumentsList);
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });
    });

    it('renders Employee greeting, Clearance badge, and two hero cards', async () => {
      renderComponent();

      // Check header greeting
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Priya');
      expect(screen.getAllByText(/CONFIDENTIAL/).length).toBeGreaterThanOrEqual(1);

      // Check hero cards
      expect(screen.getByText('Ask the Copilot')).toBeInTheDocument();
      expect(screen.getByText('Browse Documents')).toBeInTheDocument();
      expect(
        screen.getByText(/Get instant, verified answers with grounded citations/i)
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Employee Handbook 2026.pdf')).toBeInTheDocument();
      });
    });

    it('renders suggested queries and routes to Copilot Chat with query parameter on click', async () => {
      renderComponent();

      expect(screen.getByText('Suggested Queries')).toBeInTheDocument();
      const queryBtn = screen.getByText('How do I apply for annual or medical leave?');
      expect(queryBtn).toBeInTheDocument();

      fireEvent.click(queryBtn);
      expect(mockPush).toHaveBeenCalledWith(
        `/chat?q=${encodeURIComponent('How do I apply for annual or medical leave?')}`
      );

      await waitFor(() => {
        expect(screen.getByText('Employee Handbook 2026.pdf')).toBeInTheDocument();
      });
    });

    it('handles search form submission in Ask the Copilot card', async () => {
      renderComponent();

      const searchInput = screen.getByPlaceholderText(/Ask about HR, IT, policies.../i);
      fireEvent.change(searchInput, { target: { value: 'remote work policy' } });

      const askBtn = screen.getByRole('button', { name: /Ask/i });
      fireEvent.click(askBtn);

      expect(mockPush).toHaveBeenCalledWith(`/chat?q=${encodeURIComponent('remote work policy')}`);

      await waitFor(() => {
        expect(screen.getByText('Employee Handbook 2026.pdf')).toBeInTheDocument();
      });
    });

    it('renders accessible department documents and security profile info', async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Employee Handbook 2026.pdf')).toBeInTheDocument();
        expect(screen.getByText('Security Profile Active')).toBeInTheDocument();
      });
    });
  });
});
