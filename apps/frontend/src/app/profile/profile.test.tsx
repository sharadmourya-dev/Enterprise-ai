import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProfilePage from './page';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { Role, ClearanceLevel, ISafeUser } from '@enterprise-ai/shared-types';

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

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/profile',
  useParams: () => ({}),
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
}));

const mockStandardUser: ISafeUser = {
  id: 'usr-analyst-1',
  email: 'analyst@enterprise.ai',
  name: 'Security Analyst',
  department: 'Security',
  role: Role.USER,
  securityClearance: ClearanceLevel.CONFIDENTIAL,
  permissions: ['doc:read', 'chat:read'],
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockAdminUser: ISafeUser = {
  id: 'usr-admin-1',
  email: 'admin@enterprise.ai',
  name: 'System Admin',
  department: 'Operations',
  role: Role.ADMIN,
  securityClearance: ClearanceLevel.RESTRICTED,
  permissions: ['admin:all', 'doc:delete'],
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('/profile Route Integration Tests', () => {
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (useAuth as jest.Mock).mockReturnValue({
      user: mockStandardUser,
      isAuthenticated: true,
      isLoading: false,
      role: Role.USER,
      clearance: ClearanceLevel.CONFIDENTIAL,
      isAdmin: false,
      hasRole: (r: Role) => r === Role.USER,
      hasClearance: () => true,
      logout: mockLogout,
    });

    (ApiClient.get as jest.Mock).mockResolvedValue(mockStandardUser);
  });

  it('1. Renders user profile information, clearance badge, and granular permissions', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/User Profile & Clearance/i);
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Security Analyst' })).toBeInTheDocument();
    expect(screen.getAllByText('analyst@enterprise.ai').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Security').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CONFIDENTIAL').length).toBeGreaterThan(0);
    expect(screen.getByText('doc:read')).toBeInTheDocument();
    expect(screen.getByText('chat:read')).toBeInTheDocument();
  });

  it('2. Shows administrator badge and admin workspace navigation when user is admin', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: mockAdminUser,
      isAuthenticated: true,
      isLoading: false,
      role: Role.ADMIN,
      clearance: ClearanceLevel.RESTRICTED,
      isAdmin: true,
      hasRole: (r: Role) => r === Role.ADMIN,
      hasClearance: () => true,
      logout: mockLogout,
    });

    (ApiClient.get as jest.Mock).mockResolvedValue(mockAdminUser);

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'System Admin' })).toBeInTheDocument();
    });

    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getAllByText('RESTRICTED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Document Repository').length).toBeGreaterThan(0);
  });

  it('3. Refreshes credentials via /api/v1/auth/me on button click', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Security Analyst' })).toBeInTheDocument();
    });

    const refreshedUser = {
      ...mockStandardUser,
      name: 'Promoted Analyst',
      securityClearance: ClearanceLevel.RESTRICTED,
    };
    (ApiClient.get as jest.Mock).mockResolvedValueOnce(refreshedUser);

    const refreshBtn = screen.getByRole('button', { name: /refresh credentials/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Promoted Analyst' })).toBeInTheDocument();
      expect(screen.getAllByText('RESTRICTED').length).toBeGreaterThan(0);
    });
  });

  it('4. Handles logout button action', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Security Analyst' })).toBeInTheDocument();
    });

    const logoutBtn = screen.getByTestId('profile-logout-btn');
    fireEvent.click(logoutBtn);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
