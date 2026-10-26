import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import {
  Role,
  ClearanceLevel,
  Permission,
  IAdminUserListItem,
  IPermissionMeta,
  PERMISSION_DEFINITIONS,
  IAdminUserListResponse,
} from '@enterprise-ai/shared-types';
import { UserDirectoryTable } from './users/UserDirectoryTable';
import { UserPermissionModal } from './users/UserPermissionModal';
import { UserManagementDashboard } from './users/UserManagementDashboard';
import { useAuth } from '@/context/AuthContext';
import { ApiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/admin/users',
}));

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

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider defaultTheme="light">
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>
  );
}

describe('Admin User Management & Permission Administration UI', () => {
  const mockAvailablePermissions: IPermissionMeta[] = Object.values(PERMISSION_DEFINITIONS);

  const mockUsers: IAdminUserListItem[] = [
    {
      id: 'user-emp-1',
      name: 'Priya Sharma',
      email: 'priya.sharma@enterprise.com',
      role: Role.USER,
      department: 'Operations',
      securityClearance: ClearanceLevel.INTERNAL,
      permissions: [Permission.DOCUMENTS_UPLOAD],
      effectivePermissions: [Permission.DOCUMENTS_UPLOAD],
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'user-km-2',
      name: 'Bob Knowledge',
      email: 'bob.km@enterprise.com',
      role: Role.KNOWLEDGE_MANAGER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.CONFIDENTIAL,
      permissions: [],
      effectivePermissions: [Permission.DOCUMENTS_UPLOAD, Permission.DOCUMENTS_RETRY],
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'user-admin-3',
      name: 'John Morley',
      email: 'john.morley@enterprise.com',
      role: Role.ADMIN,
      department: 'IT',
      securityClearance: ClearanceLevel.RESTRICTED,
      permissions: [],
      effectivePermissions: Object.values(Permission),
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const adminAuthContextValue = {
    user: {
      id: 'user-admin-3',
      name: 'John Morley',
      email: 'john.morley@enterprise.com',
      role: Role.ADMIN,
      department: 'IT',
      securityClearance: ClearanceLevel.RESTRICTED,
      permissions: [],
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    isAuthenticated: true,
    isLoading: false,
    role: Role.ADMIN,
    clearance: ClearanceLevel.RESTRICTED,
    isAdmin: true,
    canUpload: true,
    hasRole: () => true,
    hasClearance: () => true,
    hasPermission: () => true,
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    refreshSession: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue(adminAuthContextValue);
  });

  describe('1. UserDirectoryTable', () => {
    it('renders user rows with name, email, role, department, and active permissions', () => {
      renderWithProviders(
        <UserDirectoryTable
          users={mockUsers}
          isLoading={false}
          total={3}
          page={1}
          limit={10}
          totalPages={1}
          onPageChange={jest.fn()}
          onSelectUser={jest.fn()}
          onResetFilters={jest.fn()}
          hasActiveFilters={false}
        />
      );

      expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
      expect(screen.getByText('priya.sharma@enterprise.com')).toBeInTheDocument();
      expect(screen.getByText('Bob Knowledge')).toBeInTheDocument();
      expect(screen.getByText('documents:upload')).toBeInTheDocument();
      expect(screen.getByText('Full Admin Scope')).toBeInTheDocument();
    });

    it('triggers onSelectUser when Manage Permissions is clicked', () => {
      const handleSelect = jest.fn();
      renderWithProviders(
        <UserDirectoryTable
          users={mockUsers}
          isLoading={false}
          total={3}
          page={1}
          limit={10}
          totalPages={1}
          onPageChange={jest.fn()}
          onSelectUser={handleSelect}
          onResetFilters={jest.fn()}
          hasActiveFilters={false}
        />
      );

      const manageButtons = screen.getAllByRole('button', { name: /Manage Permissions/i });
      fireEvent.click(manageButtons[0]);
      expect(handleSelect).toHaveBeenCalledWith(mockUsers[0]);
    });

    it('renders empty state when no users are found', () => {
      renderWithProviders(
        <UserDirectoryTable
          users={[]}
          isLoading={false}
          total={0}
          page={1}
          limit={10}
          totalPages={1}
          onPageChange={jest.fn()}
          onSelectUser={jest.fn()}
          onResetFilters={jest.fn()}
          hasActiveFilters={true}
        />
      );

      expect(screen.getByText('No users found')).toBeInTheDocument();
      expect(screen.getByText('Reset Filters')).toBeInTheDocument();
    });
  });

  describe('2. UserPermissionModal', () => {
    it('displays user info, permission labels, and actual identifiers', () => {
      renderWithProviders(
        <UserPermissionModal
          isOpen={true}
          onClose={jest.fn()}
          user={mockUsers[0]}
          availablePermissions={mockAvailablePermissions}
          onSuccess={jest.fn()}
        />
      );

      expect(screen.getByText('Manage User Permissions')).toBeInTheDocument();
      expect(screen.getByText('Upload Documents')).toBeInTheDocument();
      expect(screen.getByText('documents:upload')).toBeInTheDocument();
      expect(screen.getByText('Delete Documents')).toBeInTheDocument();
      expect(screen.getByText('documents:delete')).toBeInTheDocument();
    });

    it('locks role-inherited permissions with Role Default badge', () => {
      renderWithProviders(
        <UserPermissionModal
          isOpen={true}
          onClose={jest.fn()}
          user={mockUsers[1]} // Bob Knowledge (Knowledge Manager)
          availablePermissions={mockAvailablePermissions}
          onSuccess={jest.fn()}
        />
      );

      // Bob inherits documents:upload and documents:retry by role policy
      const roleDefaultBadges = screen.getAllByText('Role Default');
      expect(roleDefaultBadges.length).toBeGreaterThanOrEqual(2);
    });

    it('prevents self-modification by currently logged-in administrator', () => {
      renderWithProviders(
        <UserPermissionModal
          isOpen={true}
          onClose={jest.fn()}
          user={mockUsers[2]} // John Morley (the caller himself)
          availablePermissions={mockAvailablePermissions}
          onSuccess={jest.fn()}
        />
      );

      expect(screen.getByText('Self-Modification Prohibited')).toBeInTheDocument();
      const saveBtn = screen.getByRole('button', { name: /Save Permissions/i });
      expect(saveBtn).toBeDisabled();
    });

    it('submits permission patch and calls onSuccess upon saving', async () => {
      const handleSuccess = jest.fn();
      const handleClose = jest.fn();

      (ApiClient.patch as jest.Mock).mockResolvedValueOnce({
        ...mockUsers[0],
        permissions: [Permission.DOCUMENTS_UPLOAD, Permission.DOCUMENTS_RETRY],
      });

      renderWithProviders(
        <UserPermissionModal
          isOpen={true}
          onClose={handleClose}
          user={mockUsers[0]} // Priya
          availablePermissions={mockAvailablePermissions}
          onSuccess={handleSuccess}
        />
      );

      // Toggle Retry permission
      const retrySwitch = screen.getByRole('switch', {
        name: /Retry Failed Ingestion/i,
      });
      fireEvent.click(retrySwitch);

      const saveBtn = screen.getByRole('button', { name: /Save Permissions/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(ApiClient.patch).toHaveBeenCalledWith(
          `/admin/users/${mockUsers[0].id}/permissions`,
          expect.objectContaining({
            permissions: expect.arrayContaining([
              Permission.DOCUMENTS_UPLOAD,
              Permission.DOCUMENTS_RETRY,
            ]),
          })
        );
        expect(handleSuccess).toHaveBeenCalled();
        expect(handleClose).toHaveBeenCalled();
      });
    });

    it('keeps modal open and displays error banner when update fails', async () => {
      const handleSuccess = jest.fn();
      const handleClose = jest.fn();

      (ApiClient.patch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error or permission denied')
      );

      renderWithProviders(
        <UserPermissionModal
          isOpen={true}
          onClose={handleClose}
          user={mockUsers[0]}
          availablePermissions={mockAvailablePermissions}
          onSuccess={handleSuccess}
        />
      );

      const saveBtn = screen.getByRole('button', { name: /Save Permissions/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        const alertEl = screen.getByRole('alert');
        expect(alertEl).toBeInTheDocument();
        expect(within(alertEl).getByText('Update Failed')).toBeInTheDocument();
        expect(within(alertEl).getByText('Network error or permission denied')).toBeInTheDocument();
        // Modal must remain open and not call onSuccess or onClose
        expect(handleSuccess).not.toHaveBeenCalled();
        expect(handleClose).not.toHaveBeenCalled();
      });
    });

    it('closes without submitting when Cancel button is clicked', () => {
      const handleClose = jest.fn();
      const handleSuccess = jest.fn();

      renderWithProviders(
        <UserPermissionModal
          isOpen={true}
          onClose={handleClose}
          user={mockUsers[0]}
          availablePermissions={mockAvailablePermissions}
          onSuccess={handleSuccess}
        />
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      expect(handleClose).toHaveBeenCalledTimes(1);
      expect(ApiClient.patch).not.toHaveBeenCalled();
      expect(handleSuccess).not.toHaveBeenCalled();
    });
  });

  describe('3. UserManagementDashboard', () => {
    it('fetches users from /admin/users on mount and populates directory', async () => {
      const mockResponse: IAdminUserListResponse = {
        users: mockUsers,
        pagination: {
          total: 3,
          page: 1,
          limit: 15,
          totalPages: 1,
        },
        availablePermissions: mockAvailablePermissions,
      };

      (ApiClient.get as jest.Mock).mockResolvedValueOnce(mockResponse);

      renderWithProviders(<UserManagementDashboard />);

      await waitFor(() => {
        expect(ApiClient.get).toHaveBeenCalledWith('/admin/users', expect.any(Object));
        expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
        expect(screen.getByText('Bob Knowledge')).toBeInTheDocument();
      });
    });

    it('filters users when search form is submitted', async () => {
      const mockResponse: IAdminUserListResponse = {
        users: [mockUsers[0]],
        pagination: {
          total: 1,
          page: 1,
          limit: 15,
          totalPages: 1,
        },
        availablePermissions: mockAvailablePermissions,
      };

      (ApiClient.get as jest.Mock).mockResolvedValue(mockResponse);

      renderWithProviders(<UserManagementDashboard />);

      await waitFor(() => {
        expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search by full name or corporate email/i);
      fireEvent.change(searchInput, { target: { value: 'Priya' } });

      const searchBtn = screen.getByRole('button', { name: /^Search$/i });
      fireEvent.click(searchBtn);

      await waitFor(() => {
        expect(ApiClient.get).toHaveBeenCalledWith(
          '/admin/users',
          expect.objectContaining({ search: 'Priya' })
        );
      });
    });
  });
});
