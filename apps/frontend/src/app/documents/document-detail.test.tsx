import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DocumentDetailPage from './[id]/page';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  Role,
  ClearanceLevel,
  DocumentStatus,
  DocumentMimeType,
  ISafeUser,
} from '@enterprise-ai/shared-types';

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

const mockPush = jest.fn();
let mockParams = { id: 'doc-101' };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/documents/doc-101',
  useParams: () => mockParams,
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    public statusCode: number;
    public code: string;
    constructor(message: string, statusCode: number, code = 'API_ERROR') {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

const mockUser: ISafeUser = {
  id: 'usr-1',
  email: 'dev@enterprise.ai',
  name: 'Dev Engineer',
  department: 'Engineering',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockReadyDoc = {
  id: 'doc-101',
  title: 'Corporate Security Standards',
  originalFilename: 'security_standards.pdf',
  mimeType: DocumentMimeType.PDF,
  fileSizeBytes: 2048576,
  status: DocumentStatus.READY,
  errorMessage: null,
  chunkCount: 14,
  tokenCount: 3500,
  currentRevision: 1,
  uploadedBy: 'usr-1',
  accessControl: {
    minimumClearance: ClearanceLevel.INTERNAL,
    allowedDepartments: ['Engineering', 'Security'],
    allowedRoles: [],
    allowedUserIds: [],
  },
  createdAt: '2026-01-10T10:00:00.000Z',
  updatedAt: '2026-01-10T10:00:00.000Z',
};

const mockFailedDoc = {
  ...mockReadyDoc,
  id: 'doc-failed-1',
  title: 'Corrupted File Specification',
  status: DocumentStatus.FAILED,
  errorMessage: 'PDF extraction failed: unsupported encryption version',
};

describe('/documents/[id] Dynamic Route Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 'doc-101' };

    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      role: Role.USER,
      clearance: ClearanceLevel.INTERNAL,
      isAdmin: false,
      hasRole: (r: Role) => r === Role.USER,
      hasClearance: () => true,
      logout: jest.fn(),
    });

    (ApiClient.get as jest.Mock).mockResolvedValue(mockReadyDoc);
  });

  it('1. Loads document metadata, status, ACL and details successfully', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <DocumentDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Corporate Security Standards');
    });

    // Filename and status
    expect(screen.getByText(/Original: security_standards.pdf/i)).toBeInTheDocument();
    expect(screen.getByText('Indexed Chunks')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('3,500')).toBeInTheDocument();

    // Security clearance and department ACL
    expect(screen.getByText('Internal')).toBeInTheDocument();
    expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0);
    expect(screen.getByText('Security')).toBeInTheDocument();

    // Buttons
    expect(screen.getByRole('button', { name: /ask copilot/i })).toBeInTheDocument();

    // Does NOT expose internal storage path
    expect(screen.queryByText(/storagePath/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/documents\/2026\//i)).not.toBeInTheDocument();
  });

  it('2. Displays failure details and offers retry when document is in FAILED status', async () => {
    mockParams = { id: 'doc-failed-1' };
    (ApiClient.get as jest.Mock).mockResolvedValue(mockFailedDoc);
    (ApiClient.post as jest.Mock).mockResolvedValue({ success: true, message: 'Retry queued' });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <DocumentDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Ingestion Failure Details/i)).toBeInTheDocument();
      expect(screen.getByText(/PDF extraction failed: unsupported encryption version/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry ingestion/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/api/v1/documents/doc-failed-1/retry');
    });
  });

  it('3. Handles 404 Document Not Found cleanly', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(
      new (ApiClientError as any)('Document not found', 404, 'NOT_FOUND')
    );

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <DocumentDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Document Not Found')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back to documents/i })).toBeInTheDocument();
    });
  });

  it('4. Handles 403 Access Restricted cleanly when clearance is insufficient', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(
      new (ApiClientError as any)('Insufficient security clearance', 403, 'FORBIDDEN')
    );

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <DocumentDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    });
  });

  it('5. Allows document owner to delete document with confirmation modal', async () => {
    (ApiClient.delete as jest.Mock).mockResolvedValue({ success: true, message: 'Deleted' });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <DocumentDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    // Click delete button
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    // Confirm modal opens
    expect(screen.getByText('Delete Document & Vector Embeddings')).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: /confirm deletion/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(ApiClient.delete).toHaveBeenCalledWith('/api/v1/documents/doc-101');
      expect(mockPush).toHaveBeenCalledWith('/documents');
    });
  });
});
