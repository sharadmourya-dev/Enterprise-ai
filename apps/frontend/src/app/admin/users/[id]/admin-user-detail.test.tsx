import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminUserDetailPage from './page';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  Role,
  ClearanceLevel,
  Permission,
  IAdminUserListItem,
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

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/admin/users/usr-emp-101',
  useParams: () => ({ id: 'usr-emp-101' }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    patch: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

const mockAdminUser: ISafeUser = {
  id: 'usr-admin-1',
  email: 'admin@enterprise.ai',
  name: 'Super Admin',
  department: 'IT Security',
  role: Role.ADMIN,
  securityClearance: ClearanceLevel.RESTRICTED,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockEmployeeItem: IAdminUserListItem = {
  id: 'usr-emp-101',
  email: 'employee@enterprise.ai',
  name: 'Jane Developer',
  role: Role.USER,
  department: 'Engineering',
  securityClearance: ClearanceLevel.INTERNAL,
  permissions: [Permission.DOCUMENTS_UPLOAD, Permission.DOCUMENTS_RETRY],
  effectivePermissions: [Permission.DOCUMENTS_UPLOAD, Permission.DOCUMENTS_RETRY],
  isActive: true,
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

describe('AdminUserDetailPage Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      user: mockAdminUser,
      isAuthenticated: true,
      isLoading: false,
      role: Role.ADMIN,
      clearance: ClearanceLevel.RESTRICTED,
      isAdmin: true,
      hasRole: (r: Role) => r === Role.ADMIN,
      hasClearance: () => true,
      logout: jest.fn(),
    });

    (ApiClient.get as jest.Mock).mockResolvedValue(mockEmployeeItem);
  });

  it('1. Loads and renders employee details and permissions', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <AdminUserDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jane Developer');
    });

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('usr-emp-101')).toBeInTheDocument();
    expect(screen.getByText('employee@enterprise.ai')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deactivate account/i })).toBeInTheDocument();
  });

  it('2. Opens confirmation modal and deactivates employee account', async () => {
    (ApiClient.patch as jest.Mock).mockResolvedValue({
      ...mockEmployeeItem,
      isActive: false,
    });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <AdminUserDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jane Developer');
    });

    const toggleBtn = screen.getByRole('button', { name: /deactivate account/i });
    fireEvent.click(toggleBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /confirm account deactivation/i })).toBeInTheDocument();
    });

    // Confirm deactivation
    const confirmBtn = screen.getByRole('button', { name: /confirm deactivation/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/users/usr-emp-101/status',
        { isActive: false }
      );
    });
  });

  it('3. Prevents self-deactivation when admin views their own account profile', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { ...mockAdminUser, id: 'usr-emp-101' }, // Viewing own profile
      isAuthenticated: true,
      isLoading: false,
      role: Role.ADMIN,
      clearance: ClearanceLevel.RESTRICTED,
      isAdmin: true,
      hasRole: (r: Role) => r === Role.ADMIN,
      hasClearance: () => true,
      logout: jest.fn(),
    });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <AdminUserDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jane Developer');
    });

    expect(screen.getByText(/self-deactivation is disabled/i)).toBeInTheDocument();
    const toggleBtn = screen.getByRole('button', { name: /deactivate account/i });
    expect(toggleBtn).toBeDisabled();
  });
});
