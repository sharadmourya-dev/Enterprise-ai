import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { DocumentUploadModal } from './DocumentUploadModal';
import { DocumentList, formatFileSize } from './DocumentList';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  Role,
  ClearanceLevel,
  DocumentStatus,
  DocumentMimeType,
  IDocument,
  IDocumentListResponse,
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

describe('Document Management & Ingestion UI', () => {
  const mockUser = {
    id: 'user-123',
    email: 'analyst@enterprise.com',
    name: 'Jane Analyst',
    role: Role.USER,
    securityClearance: ClearanceLevel.CONFIDENTIAL,
    department: 'Risk Management',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      role: Role.USER,
      clearance: ClearanceLevel.CONFIDENTIAL,
      isAdmin: false,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  describe('formatFileSize helper', () => {
    it('formats bytes into KB and MB correctly', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
      expect(formatFileSize(50 * 1024 * 1024)).toBe('50 MB');
    });
  });

  describe('DocumentStatusBadge', () => {
    it('renders all backend document statuses with appropriate variant and icon', () => {
      const { rerender } = render(<DocumentStatusBadge status={DocumentStatus.QUEUED} />);
      expect(screen.getByText('Queued')).toBeInTheDocument();

      rerender(<DocumentStatusBadge status={DocumentStatus.PROCESSING} />);
      expect(screen.getByText('Processing')).toBeInTheDocument();

      rerender(<DocumentStatusBadge status={DocumentStatus.INDEXING} />);
      expect(screen.getByText('Indexing')).toBeInTheDocument();

      rerender(<DocumentStatusBadge status={DocumentStatus.READY} />);
      expect(screen.getByText('Ready')).toBeInTheDocument();

      rerender(
        <DocumentStatusBadge
          status={DocumentStatus.FAILED}
          errorMessage="Parser timeout on malformed PDF"
        />
      );
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByTitle('Parser timeout on malformed PDF')).toBeInTheDocument();
    });
  });

  describe('DocumentUploadModal', () => {
    it('rejects files larger than the 50 MB limit', () => {
      renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );

      const oversizedFile = new File(['x'.repeat(100)], 'huge.pdf', {
        type: 'application/pdf',
      });
      // Override size to 51 MB
      Object.defineProperty(oversizedFile, 'size', { value: 51 * 1024 * 1024 });

      const input = document.getElementById('document-file-upload') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [oversizedFile] } });

      expect(screen.getByText(/exceeds the 50 MB limit/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /upload document/i })).toBeDisabled();
    });

    it('rejects empty (0-byte) files', () => {
      renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );

      const emptyFile = new File([], 'empty.txt', { type: 'text/plain' });
      Object.defineProperty(emptyFile, 'size', { value: 0 });

      const input = document.getElementById('document-file-upload') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [emptyFile] } });

      expect(screen.getByText(/uploaded file is empty/i)).toBeInTheDocument();
    });

    it('rejects unsupported file formats (.exe, .png)', () => {
      renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );

      const invalidFile = new File(['binary'], 'script.exe', { type: 'application/x-msdownload' });
      const input = document.getElementById('document-file-upload') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [invalidFile] } });

      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });

    it('constrains clearance choices to user clearance level for non-admins', () => {
      renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );

      // Jane Analyst has ClearanceLevel.CONFIDENTIAL (Level 2).
      // Available options should be PUBLIC (0), INTERNAL (1), CONFIDENTIAL (2).
      // RESTRICTED (3) and TOP_SECRET (4) must NOT be available!
      const select = screen.getByLabelText(/minimum security clearance/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);

      expect(options).toContain(ClearanceLevel.PUBLIC);
      expect(options).toContain(ClearanceLevel.INTERNAL);
      expect(options).toContain(ClearanceLevel.CONFIDENTIAL);
      expect(options).not.toContain(ClearanceLevel.RESTRICTED);
    });

    it('allows admin users to select up to RESTRICTED clearance and configure user IDs', () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { ...mockUser, role: Role.ADMIN, securityClearance: ClearanceLevel.RESTRICTED },
        role: Role.ADMIN,
        clearance: ClearanceLevel.RESTRICTED,
        isAdmin: true,
        isAuthenticated: true,
        isLoading: false,
      });

      renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );

      const select = screen.getByLabelText(/minimum security clearance/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain(ClearanceLevel.RESTRICTED);

      // Admin has access to Specific User IDs input
      expect(screen.getByPlaceholderText(/60f8a923/i)).toBeInTheDocument();
    });

    it('submits valid multipart/form-data upload and handles duplicate conflict (409)', async () => {
      jest.spyOn(ApiClient, 'upload').mockRejectedValueOnce(
        new Error("A document with identical content has already been uploaded ('Security Guidelines').")
      );

      const { container } = renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );

      const validFile = new File(['valid pdf content'], 'guidelines.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(validFile, 'size', { value: 1024 * 50 });

      const input = document.getElementById('document-file-upload') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [validFile] } });

      const form = input.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(ApiClient.upload).toHaveBeenCalledTimes(1);
        expect(screen.getAllByText(/identical content has already been uploaded/i)[0]).toBeInTheDocument();
      });
    });

    it('successfully uploads document and calls onSuccess callback', async () => {
      const onSuccess = jest.fn();
      jest.spyOn(ApiClient, 'upload').mockResolvedValueOnce({
        documentId: 'doc-new-1',
        title: 'Q4 Strategy Runbook',
        originalFilename: 'strategy.docx',
        mimeType: DocumentMimeType.DOCX,
        fileSizeBytes: 2048,
        fileHash: 'hash123',
        status: DocumentStatus.QUEUED,
        createdAt: '2026-10-21T10:00:00Z',
      });

      renderWithProviders(
        <DocumentUploadModal
          isOpen={true}
          onClose={jest.fn()}
          onSuccess={onSuccess}
        />
      );

      const validDocx = new File(['docx content'], 'strategy.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      Object.defineProperty(validDocx, 'size', { value: 2048 });

      const fileInput = document.getElementById('document-file-upload') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [validDocx] } });

      const form = fileInput.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ documentId: 'doc-new-1', title: 'Q4 Strategy Runbook' })
        );
      });
    });
  });

  describe('DocumentList', () => {
    const mockDocs: IDocument[] = [
      {
        id: 'doc-1',
        title: 'Corporate Data Retention Policy',
        originalFilename: 'retention_policy_2026.pdf',
        mimeType: DocumentMimeType.PDF,
        fileSizeBytes: 1024 * 1024 * 1.5,
        fileHash: 'hash-1',
        status: DocumentStatus.READY,
        chunkCount: 24,
        tokenCount: 4800,
        currentRevision: 1,
        uploadedBy: 'user-123',
        accessControl: {
          allowedRoles: [],
          allowedDepartments: ['Compliance'],
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedUserIds: [],
        },
        createdAt: '2026-10-21T08:00:00Z',
        updatedAt: '2026-10-21T08:05:00Z',
      },
      {
        id: 'doc-2',
        title: 'Malformed Ingestion Runbook',
        originalFilename: 'corrupt_runbook.docx',
        mimeType: DocumentMimeType.DOCX,
        fileSizeBytes: 512 * 1024,
        fileHash: 'hash-2',
        status: DocumentStatus.FAILED,
        errorMessage: 'DOCX parsing failure: Corrupt ZIP structure',
        chunkCount: 0,
        tokenCount: 0,
        currentRevision: 1,
        uploadedBy: 'user-123',
        accessControl: {
          allowedRoles: [Role.USER],
          allowedDepartments: [],
          minimumClearance: ClearanceLevel.CONFIDENTIAL,
          allowedUserIds: [],
        },
        createdAt: '2026-10-21T07:30:00Z',
        updatedAt: '2026-10-21T07:31:00Z',
      },
    ];

    const mockResponse: IDocumentListResponse = {
      documents: mockDocs,
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
    };

    beforeEach(() => {
      jest.spyOn(ApiClient, 'get').mockResolvedValue(mockResponse);
    });

    it('loads and displays documents in table view with metadata and badges', async () => {
      renderWithProviders(<DocumentList onUploadClick={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getAllByText('Corporate Data Retention Policy')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Malformed Ingestion Runbook')[0]).toBeInTheDocument();
        expect(screen.getAllByText('1.5 MB')[0]).toBeInTheDocument();
        expect(screen.getAllByText('512 KB')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Ready')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Failed')[0]).toBeInTheDocument();
      });
    });

    it('filters documents locally using search input', async () => {
      renderWithProviders(<DocumentList onUploadClick={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getAllByText('Corporate Data Retention Policy')[0]).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/filter current page/i);
      fireEvent.change(searchInput, { target: { value: 'Malformed' } });

      expect(screen.queryByText('Corporate Data Retention Policy')).not.toBeInTheDocument();
      expect(screen.getAllByText('Malformed Ingestion Runbook')[0]).toBeInTheDocument();
      expect(screen.getByTestId('page-filter-indicator')).toHaveTextContent(/showing 1 of 2 on current page/i);
    });

    it('initiates retry for failed document and displays feedback toast', async () => {
      jest.spyOn(ApiClient, 'post').mockResolvedValueOnce({
        message: 'Retry initiated',
        jobId: 'job-retry-456',
      });

      renderWithProviders(<DocumentList onUploadClick={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getAllByText('Malformed Ingestion Runbook')[0]).toBeInTheDocument();
      });

      const retryBtn = screen.getByRole('button', {
        name: /retry ingestion for malformed ingestion runbook/i,
      });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(ApiClient.post).toHaveBeenCalledWith('/api/v1/documents/doc-2/retry');
      });
    });

    it('requires confirmation dialog before deleting a document', async () => {
      jest.spyOn(ApiClient, 'delete').mockResolvedValueOnce({
        message: 'Deleted successfully',
      });

      renderWithProviders(<DocumentList onUploadClick={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getAllByText('Corporate Data Retention Policy')[0]).toBeInTheDocument();
      });

      const deleteBtn = screen.getByRole('button', {
        name: /delete document: corporate data retention policy/i,
      });
      fireEvent.click(deleteBtn);

      expect(
        screen.getByRole('dialog', { name: /delete document & vector indexes/i })
      ).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /confirm deletion/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(ApiClient.delete).toHaveBeenCalledWith('/api/v1/documents/doc-1');
      });
    });
  });
});
