import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { DocumentList } from '@/components/documents/DocumentList';
import { AppShell } from '@/components/layout/AppShell';
import { TrendChart } from '@/components/admin/analytics/TrendChart';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { ApiClient } from '@/lib/api-client';
import { streamChatMessage } from '@/lib/chat-stream';
import {
  Role,
  ClearanceLevel,
  DocumentStatus,
  DocumentMimeType,
  IDocumentListResponse,
  IAnalyticsDailyTrend,
  ISafeUser,
} from '@enterprise-ai/shared-types';

// Polyfills for Jest JSDOM
if (typeof (global as any).TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  (global as any).TextEncoder = TextEncoder;
  (global as any).TextDecoder = TextDecoder;
}

if (typeof (global as any).ReadableStream === 'undefined') {
  try {
    const { ReadableStream } = require('stream/web');
    (global as any).ReadableStream = ReadableStream;
  } catch {
    // fallback
  }
}

// Mock next/navigation
const mockPush = jest.fn();
let mockPathname = '/';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => mockPathname,
}));

const mockStandardUser: ISafeUser = {
  id: 'usr-std-1',
  name: 'Standard Employee',
  email: 'employee@corp.com',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  department: 'Operations',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockAdminUser: ISafeUser = {
  id: 'adm-1',
  name: 'Security Admin',
  email: 'admin@corp.com',
  role: Role.ADMIN,
  securityClearance: ClearanceLevel.RESTRICTED,
  department: 'Security',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

describe('Phase 7 Milestone 7 — Frontend Integration, Accessibility & Acceptance Audit', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';

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
    localStorage.clear();
    mockPathname = '/';
  });

  describe('1. Security & Protected Route Audit', () => {
    it('strictly forbids standard user (Role.USER) from accessing admin views and renders Denied banner', async () => {
      localStorage.setItem('enterprise_ai_refresh_token', 'refresh-user-token');
      localStorage.setItem('enterprise_ai_user', JSON.stringify(mockStandardUser));

      jest.spyOn(ApiClient, 'post').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/refresh') {
          return { accessToken: 'access-user-token', refreshToken: 'refresh-user-token' };
        }
        return null;
      });

      jest.spyOn(ApiClient, 'get').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/me') {
          return mockStandardUser;
        }
        return null;
      });

      renderWithProviders(
        <ProtectedRoute adminOnly={true}>
          <div data-testid="secret-admin-view">Admin Secrets</div>
        </ProtectedRoute>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('secret-admin-view')).not.toBeInTheDocument();
        expect(screen.getByText(/administrative access denied/i)).toBeInTheDocument();
        expect(screen.getByText(Role.USER)).toBeInTheDocument();
      });
    });

    it('permits administrator (Role.ADMIN) to access protected admin views', async () => {
      localStorage.setItem('enterprise_ai_refresh_token', 'refresh-admin-token');
      localStorage.setItem('enterprise_ai_user', JSON.stringify(mockAdminUser));

      jest.spyOn(ApiClient, 'post').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/refresh') {
          return { accessToken: 'access-admin-token', refreshToken: 'refresh-admin-token' };
        }
        return null;
      });

      jest.spyOn(ApiClient, 'get').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/me') {
          return mockAdminUser;
        }
        return null;
      });

      renderWithProviders(
        <ProtectedRoute adminOnly={true}>
          <div data-testid="secret-admin-view">Admin Secrets</div>
        </ProtectedRoute>
      );

      await waitFor(() => {
        expect(screen.getByTestId('secret-admin-view')).toBeInTheDocument();
      });
    });

    it('enforces clearance boundaries and prevents access when user clearance is insufficient', async () => {
      localStorage.setItem('enterprise_ai_refresh_token', 'refresh-token');
      localStorage.setItem('enterprise_ai_user', JSON.stringify(mockStandardUser));

      jest.spyOn(ApiClient, 'post').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/refresh') {
          return { accessToken: 'access-token', refreshToken: 'refresh-token' };
        }
        return null;
      });

      jest.spyOn(ApiClient, 'get').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/me') {
          return mockStandardUser;
        }
        return null;
      });

      renderWithProviders(
        <ProtectedRoute requiredClearance={ClearanceLevel.RESTRICTED}>
          <div data-testid="restricted-data">Top Secret Content</div>
        </ProtectedRoute>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('restricted-data')).not.toBeInTheDocument();
        expect(screen.getByText(/security clearance restricted/i)).toBeInTheDocument();
        expect(screen.getByText(/minimum clearance required:/i)).toHaveTextContent(ClearanceLevel.RESTRICTED);
      });
    });
  });

  describe('2. Document Management & Ingestion Scope Audit', () => {
    const mockListResponse: IDocumentListResponse = {
      documents: [
        {
          id: 'doc-alpha',
          title: 'Cybersecurity Incident Response Guide',
          originalFilename: 'incident_response.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 1024 * 500,
          fileHash: 'sha-alpha',
          status: DocumentStatus.READY,
          chunkCount: 12,
          tokenCount: 2400,
          currentRevision: 1,
          uploadedBy: 'sec-admin',
          accessControl: {
            allowedRoles: [],
            allowedDepartments: ['Security'],
            minimumClearance: ClearanceLevel.CONFIDENTIAL,
            allowedUserIds: [],
          },
          createdAt: '2026-10-21T09:00:00Z',
          updatedAt: '2026-10-21T09:02:00Z',
        },
        {
          id: 'doc-beta',
          title: 'Employee Travel Expense Reimbursement Policy',
          originalFilename: 'travel_policy.docx',
          mimeType: DocumentMimeType.DOCX,
          fileSizeBytes: 1024 * 250,
          fileHash: 'sha-beta',
          status: DocumentStatus.READY,
          chunkCount: 8,
          tokenCount: 1600,
          currentRevision: 1,
          uploadedBy: 'hr-admin',
          accessControl: {
            allowedRoles: [],
            allowedDepartments: ['HR', 'Finance'],
            minimumClearance: ClearanceLevel.INTERNAL,
            allowedUserIds: [],
          },
          createdAt: '2026-10-21T09:10:00Z',
          updatedAt: '2026-10-21T09:12:00Z',
        },
      ],
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    };

    it('accurately identifies and labels search input as current-page filter with live counter badge', async () => {
      jest.spyOn(ApiClient, 'get').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/api/v1/documents') {
          return mockListResponse;
        }
        return null;
      });

      renderWithProviders(<DocumentList onUploadClick={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getAllByText('Cybersecurity Incident Response Guide')[0]).toBeInTheDocument();
      });

      // Verify search input placeholder and aria-label explicitly state current-page filtering scope
      const filterInput = screen.getByPlaceholderText(/filter current page by title, filename, or department/i);
      expect(filterInput).toHaveAttribute('aria-label', 'Filter current page');

      // Verify live badge updates when query is active
      fireEvent.change(filterInput, { target: { value: 'Travel' } });

      expect(screen.queryByText('Cybersecurity Incident Response Guide')).not.toBeInTheDocument();
      expect(screen.getAllByText('Employee Travel Expense Reimbursement Policy')[0]).toBeInTheDocument();

      const filterBadge = screen.getByTestId('page-filter-indicator');
      expect(filterBadge).toHaveTextContent(/showing 1 of 2 on current page/i);
    });
  });

  describe('3. Accessibility Audit (WCAG AA Compliance)', () => {
    it('renders Skip to Main Content accessible link in AppShell', async () => {
      localStorage.setItem('enterprise_ai_refresh_token', 'refresh-user-token');
      localStorage.setItem('enterprise_ai_user', JSON.stringify(mockStandardUser));

      jest.spyOn(ApiClient, 'post').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/refresh') {
          return { accessToken: 'access-user-token', refreshToken: 'refresh-user-token' };
        }
        return null;
      });

      jest.spyOn(ApiClient, 'get').mockImplementation(async (endpoint: string) => {
        if (endpoint === '/auth/me') {
          return mockStandardUser;
        }
        return null;
      });

      renderWithProviders(
        <AppShell>
          <div>Main shell content</div>
        </AppShell>
      );

      await waitFor(() => {
        const skipLink = screen.getByRole('link', { name: /skip to main content/i });
        expect(skipLink).toBeInTheDocument();
        expect(skipLink).toHaveAttribute('href', '#main-content');
      });
    });

    it('provides accessible SVG chart role, aria-label, and accessible table fallback in TrendChart', () => {
      const mockTrends: IAnalyticsDailyTrend[] = [
        {
          date: '2026-10-19',
          queryCount: 150,
          totalTokens: 45000,
          avgLatencyMs: 340,
          activeConversations: 35,
          successCount: 148,
          errorCount: 2,
        },
        {
          date: '2026-10-20',
          queryCount: 210,
          totalTokens: 62000,
          avgLatencyMs: 310,
          activeConversations: 48,
          successCount: 209,
          errorCount: 1,
        },
      ];

      renderWithProviders(<TrendChart trends={mockTrends} />);

      // Chart SVG has role="img" and descriptive aria-label
      const chartSvg = screen.getByRole('img', { name: /chart spanning 2 days/i });
      expect(chartSvg).toBeInTheDocument();

      // Switch to accessible table mode
      const tableModeBtn = screen.getByRole('button', { name: /table view/i });
      fireEvent.click(tableModeBtn);

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();
      expect(screen.getAllByRole('columnheader').length).toBe(7);
      expect(screen.getByText('2026-10-19')).toBeInTheDocument();
      expect(screen.getByText('2026-10-20')).toBeInTheDocument();
    });
  });

  describe('4. Safe Rendering & XSS Immunity Audit', () => {
    it('completely strips and neutralizes malicious script tags and event handlers in MarkdownRenderer', () => {
      const maliciousPayload =
        'Here is an answer: <script>window.pwned=true</script><img src=x onerror=alert(1)> and text.';

      const { container } = renderWithProviders(
        <MarkdownRenderer content={maliciousPayload} />
      );

      // Verify no script or img tags with onerror are rendered into DOM
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText(/here is an answer:/i)).toBeInTheDocument();
      expect(screen.getByText(/and text\./i)).toBeInTheDocument();
    });

    it('renders citation pills with accessible aria-label and triggers callback on click', () => {
      const onCitationClick = jest.fn();
      const content = 'According to the policy [S1], retention is 7 years [S2].';

      renderWithProviders(
        <MarkdownRenderer content={content} onCitationClick={onCitationClick} />
      );

      const citationPill = screen.getByRole('button', { name: /view citation source s1/i });
      expect(citationPill).toBeInTheDocument();

      fireEvent.click(citationPill);
      expect(onCitationClick).toHaveBeenCalledWith('S1');
    });
  });

  describe('5. Streaming Cancellation & Session Lifecycle Audit', () => {
    it('honors AbortSignal cancellation during chat stream without duplicate retries', async () => {
      const controller = new AbortController();
      let streamStarted = false;

      // Mock streaming endpoint response
      const mockStream = new ReadableStream({
        start(streamCtrl) {
          streamCtrl.enqueue(
            new TextEncoder().encode('event: message.started\ndata: {"messageId":"msg-1"}\n\n')
          );
        },
      });

      const originalFetch = global.fetch;
      try {
        global.fetch = jest.fn().mockImplementation(async () => {
          streamStarted = true;
          // Abort immediately after fetch initiates
          controller.abort();
          return new Response(mockStream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        });

        const onStarted = jest.fn();
        const onError = jest.fn();

        await streamChatMessage('conv-1', 'Test prompt', {
          signal: controller.signal,
          idempotencyKey: 'idemp-test-123',
          handlers: { onStarted, onError },
        });

        expect(streamStarted).toBe(true);
        expect(onError).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
