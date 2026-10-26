import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { DocumentUploadModal } from './DocumentUploadModal';
import { DocumentList, formatFileSize } from './DocumentList';
import DocumentsPage from '@/app/documents/page';
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

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  usePathname: () => '/documents',
}));

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

    it('renders clean read-only knowledge base layout when isReadOnly is true', async () => {
      renderWithProviders(<DocumentList onUploadClick={jest.fn()} isReadOnly={true} />);

      await waitFor(() => {
        expect(screen.getAllByText('Corporate Data Retention Policy')[0]).toBeInTheDocument();
      });

      // Employee columns: Name, Department, Size, Uploaded
      expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /department/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /size/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /uploaded/i })).toBeInTheDocument();

      // Administrative columns should NOT be rendered in read-only mode
      expect(screen.queryByRole('columnheader', { name: /status/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /access/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /chunks/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /actions/i })).not.toBeInTheDocument();

      // Mutation buttons should not be present
      expect(screen.queryByRole('button', { name: /retry ingestion/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete document/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /upload document/i })).not.toBeInTheDocument();
    });

    it('resets filters when reset button is clicked', async () => {
      renderWithProviders(<DocumentList onUploadClick={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getAllByText('Corporate Data Retention Policy')[0]).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/filter current page/i);
      fireEvent.change(searchInput, { target: { value: 'Malformed' } });

      const resetBtn = screen.getByRole('button', { name: /reset/i });
      fireEvent.click(resetBtn);

      expect((searchInput as HTMLInputElement).value).toBe('');
      expect(screen.getAllByText('Corporate Data Retention Policy')[0]).toBeInTheDocument();
    });
  });

  describe('Employee Document Upload Permissions & Page Interactions', () => {
    it('allows authorized employee with canUpload=true to see Upload Document CTA and open modal', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValue({
        documents: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });

      (useAuth as jest.Mock).mockReturnValue({
        user: { ...mockUser, department: 'Risk Management', role: Role.USER },
        role: Role.USER,
        clearance: ClearanceLevel.CONFIDENTIAL,
        isAdmin: false,
        canUpload: true,
        isAuthenticated: true,
        isLoading: false,
      });

      renderWithProviders(<DocumentsPage />);

      // Should show Employee title "Knowledge Base"
      expect(screen.getByRole('heading', { name: /knowledge base/i })).toBeInTheDocument();

      // Should show Upload Document button in header because canUpload is true
      const uploadBtn = screen.getByRole('button', { name: /upload document/i });
      expect(uploadBtn).toBeInTheDocument();

      // Clicking Upload Document opens modal
      fireEvent.click(uploadBtn);

      const dialog = screen.getByRole('dialog', { name: /upload knowledge document/i });
      expect(dialog).toBeInTheDocument();
      // Should show department automatically scoped to Risk Management
      expect(within(dialog).getAllByText('Risk Management').length).toBeGreaterThanOrEqual(1);
      expect(within(dialog).getByText(/\(automatically assigned to your department\)/i)).toBeInTheDocument();
      // Specific user IDs input should be hidden from non-admin employee
      expect(within(dialog).queryByPlaceholderText(/60f8a923/i)).not.toBeInTheDocument();
    });

    it('hides Upload Document CTA and modal from employee with canUpload=false', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValue({
        documents: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });

      (useAuth as jest.Mock).mockReturnValue({
        user: { ...mockUser, department: 'Risk Management', role: Role.USER },
        role: Role.USER,
        clearance: ClearanceLevel.CONFIDENTIAL,
        isAdmin: false,
        canUpload: false,
        isAuthenticated: true,
        isLoading: false,
      });

      renderWithProviders(<DocumentsPage />);

      // Should show Employee title "Knowledge Base"
      expect(screen.getByRole('heading', { name: /knowledge base/i })).toBeInTheDocument();

      // Upload Document button should NOT exist in header or anywhere
      expect(screen.queryByRole('button', { name: /upload document/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: /upload knowledge document/i })).not.toBeInTheDocument();
    });

    it('submits employee upload strictly scoped to authenticated department', async () => {
      const uploadSpy = jest.spyOn(ApiClient, 'upload').mockResolvedValueOnce({
        documentId: 'doc-emp-101',
        title: 'Risk Framework 2026',
        originalFilename: 'framework.pdf',
        mimeType: DocumentMimeType.PDF,
        fileSizeBytes: 4096,
        fileHash: 'hash-risk-1',
        status: DocumentStatus.QUEUED,
        createdAt: '2026-10-26T10:00:00Z',
      });

      (useAuth as jest.Mock).mockReturnValue({
        user: { ...mockUser, department: 'Risk Management', role: Role.USER },
        role: Role.USER,
        clearance: ClearanceLevel.CONFIDENTIAL,
        isAdmin: false,
        canUpload: true,
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

      const validPdf = new File(['risk policy content'], 'framework.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(validPdf, 'size', { value: 4096 });

      const fileInput = document.getElementById('document-file-upload') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [validPdf] } });

      const form = fileInput.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(uploadSpy).toHaveBeenCalledTimes(1);
        const [endpoint, formData] = uploadSpy.mock.calls[0] as [string, FormData];
        expect(endpoint).toBe('/api/v1/documents/upload');
        expect(formData.get('allowedDepartments')).toBe('Risk Management');
      });
    });

    it('preserves read-only document repository columns for employee who uploads', async () => {
      jest.spyOn(ApiClient, 'get').mockResolvedValue({
        documents: [
          {
            id: 'doc-emp-1',
            title: 'Employee Risk Assessment',
            originalFilename: 'risk_assessment.pdf',
            mimeType: DocumentMimeType.PDF,
            fileSizeBytes: 2048,
            fileHash: 'hash-emp-1',
            status: DocumentStatus.READY,
            chunkCount: 12,
            tokenCount: 2400,
            currentRevision: 1,
            uploadedBy: 'user-123',
            accessControl: {
              allowedRoles: [],
              allowedDepartments: ['Risk Management'],
              minimumClearance: ClearanceLevel.INTERNAL,
              allowedUserIds: [],
            },
            createdAt: '2026-10-26T09:00:00Z',
            updatedAt: '2026-10-26T09:05:00Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      (useAuth as jest.Mock).mockReturnValue({
        user: { ...mockUser, department: 'Risk Management', role: Role.USER },
        role: Role.USER,
        clearance: ClearanceLevel.CONFIDENTIAL,
        isAdmin: false,
        canUpload: true,
        isAuthenticated: true,
        isLoading: false,
      });

      renderWithProviders(<DocumentsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Employee Risk Assessment')[0]).toBeInTheDocument();
      });

      // Employee table columns are strictly Name, Department, Size, Uploaded
      expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /department/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /size/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /uploaded/i })).toBeInTheDocument();

      // Administrative management columns (Status, Access, Chunks, Actions) remain suppressed
      expect(screen.queryByRole('columnheader', { name: /status/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /access/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /chunks/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /actions/i })).not.toBeInTheDocument();

      // Mutation buttons (Delete / Retry) remain suppressed
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });
  });
});
