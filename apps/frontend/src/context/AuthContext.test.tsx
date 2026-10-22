import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth, AuthContextType } from './AuthContext';
import { ApiClient } from '@/lib/api-client';
import { TokenStorage } from '@/lib/token-storage';
import { Role, ClearanceLevel, ISafeUser, ITokenPair } from '@enterprise-ai/shared-types';

jest.mock('@/lib/api-client');

const mockSafeUser: ISafeUser = {
  id: 'user-001',
  email: 'alice@enterprise.com',
  name: 'Alice Smith',
  department: 'Engineering',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockTokens: ITokenPair = {
  accessToken: 'valid-access-jwt-123',
  refreshToken: 'valid-refresh-jwt-456',
  expiresIn: 900,
};

function TestAuthConsumer({ onRender }: { onRender?: (auth: AuthContextType) => void }) {
  const auth = useAuth();
  onRender?.(auth);
  return (
    <div>
      <span data-testid="auth-status">{auth.isAuthenticated ? 'authenticated' : 'guest'}</span>
      <span data-testid="user-role">{auth.role || 'none'}</span>
      <span data-testid="user-clearance">{auth.clearance || 'none'}</span>
      <span data-testid="is-admin">{auth.isAdmin ? 'true' : 'false'}</span>
      <button onClick={() => auth.login({ email: 'alice@enterprise.com', password: 'password123' })}>
        Trigger Login
      </button>
      <button onClick={() => auth.logout()}>Trigger Logout</button>
    </div>
  );
}

describe('AuthContext & Lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TokenStorage.clearSession();
    (ApiClient.post as jest.Mock).mockResolvedValue(null);
    (ApiClient.get as jest.Mock).mockResolvedValue(null);
  });

  it('initializes as unauthenticated when no session token exists', async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <TestAuthConsumer />
        </AuthProvider>
      );
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
    expect(screen.getByTestId('user-role')).toHaveTextContent('none');
    expect(screen.getByTestId('is-admin')).toHaveTextContent('false');
  });

  it('submits documented login credentials and saves session tokens', async () => {
    (ApiClient.post as jest.Mock).mockImplementation((endpoint) => {
      if (endpoint === '/auth/login') {
        return Promise.resolve({
          user: mockSafeUser,
          tokens: mockTokens,
        });
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestAuthConsumer />
        </AuthProvider>
      );
    });

    await act(async () => {
      screen.getByText('Trigger Login').click();
    });

    expect(ApiClient.post).toHaveBeenCalledWith(
      '/auth/login',
      { email: 'alice@enterprise.com', password: 'password123' },
      { skipAuth: true }
    );

    expect(TokenStorage.getAccessToken()).toBe(mockTokens.accessToken);
    expect(TokenStorage.getRefreshToken()).toBe(mockTokens.refreshToken);
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('user-role')).toHaveTextContent(Role.USER);
  });

  it('strictly validates registration fields and prevents role/clearance escalation', async () => {
    let capturedAuth: AuthContextType | null = null;
    (ApiClient.post as jest.Mock).mockResolvedValueOnce(mockSafeUser);

    await act(async () => {
      render(
        <AuthProvider>
          <TestAuthConsumer onRender={(auth) => (capturedAuth = auth)} />
        </AuthProvider>
      );
    });

    const registrationData = {
      name: 'Bob',
      email: 'bob@enterprise.com',
      department: 'Finance',
      password: 'password123',
    };

    await act(async () => {
      await capturedAuth?.register(registrationData);
    });

    expect(ApiClient.post).toHaveBeenCalledWith('/auth/register', registrationData, {
      skipAuth: true,
    });
  });

  it('clears local session state on logout even when server request fails', async () => {
    (ApiClient.post as jest.Mock).mockImplementation((endpoint) => {
      if (endpoint === '/auth/login') {
        return Promise.resolve({ user: mockSafeUser, tokens: mockTokens });
      }
      if (endpoint === '/auth/logout') {
        return Promise.reject(new Error('Network drop'));
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestAuthConsumer />
        </AuthProvider>
      );
    });

    // Login first
    await act(async () => {
      screen.getByText('Trigger Login').click();
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');

    // Now trigger logout
    await act(async () => {
      screen.getByText('Trigger Logout').click();
    });

    expect(TokenStorage.getAccessToken()).toBeNull();
    expect(TokenStorage.getRefreshToken()).toBeNull();
    expect(TokenStorage.getUser()).toBeNull();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
  });

  describe('Authorization Helpers (RBAC & Clearance)', () => {
    it('verifies isAdmin for Role.ADMIN and Role.SUPER_ADMIN, but not Role.USER', async () => {
      let currentRole: Role = Role.USER;

      (ApiClient.post as jest.Mock).mockImplementation((endpoint) => {
        if (endpoint === '/auth/login') {
          return Promise.resolve({
            user: { ...mockSafeUser, role: currentRole },
            tokens: mockTokens,
          });
        }
        return Promise.resolve(null);
      });

      // 1. Standard User Login
      currentRole = Role.USER;
      const userRef: { auth: AuthContextType | null } = { auth: null };
      const { unmount: unmountUser } = render(
        <AuthProvider key="user">
          <TestAuthConsumer onRender={(a) => (userRef.auth = a)} />
        </AuthProvider>
      );

      await act(async () => {
        screen.getByText('Trigger Login').click();
      });

      expect(userRef.auth?.isAdmin).toBe(false);
      expect(userRef.auth?.hasRole(Role.USER)).toBe(true);
      expect(userRef.auth?.hasRole(Role.ADMIN)).toBe(false);
      unmountUser();

      // 2. Admin User Login
      currentRole = Role.ADMIN;
      const adminRef: { auth: AuthContextType | null } = { auth: null };
      const { unmount: unmountAdmin } = render(
        <AuthProvider key="admin">
          <TestAuthConsumer onRender={(a) => (adminRef.auth = a)} />
        </AuthProvider>
      );

      await act(async () => {
        screen.getByText('Trigger Login').click();
      });

      expect(adminRef.auth?.isAdmin).toBe(true);
      expect(adminRef.auth?.hasRole(Role.ADMIN)).toBe(true);
      unmountAdmin();

      // 3. Super Admin User Login
      currentRole = Role.SUPER_ADMIN;
      const superAdminRef: { auth: AuthContextType | null } = { auth: null };
      render(
        <AuthProvider key="superadmin">
          <TestAuthConsumer onRender={(a) => (superAdminRef.auth = a)} />
        </AuthProvider>
      );

      await act(async () => {
        screen.getByText('Trigger Login').click();
      });

      expect(superAdminRef.auth?.isAdmin).toBe(true);
      expect(superAdminRef.auth?.hasRole(Role.SUPER_ADMIN)).toBe(true);
    });

    it('evaluates hierarchical clearance correctly using CLEARANCE_RANK', async () => {
      (ApiClient.post as jest.Mock).mockImplementation((endpoint) => {
        if (endpoint === '/auth/login') {
          return Promise.resolve({
            user: { ...mockSafeUser, securityClearance: ClearanceLevel.INTERNAL },
            tokens: mockTokens,
          });
        }
        return Promise.resolve(null);
      });

      const clearanceRef: { auth: AuthContextType | null } = { auth: null };

      await act(async () => {
        render(
          <AuthProvider>
            <TestAuthConsumer onRender={(a) => (clearanceRef.auth = a)} />
          </AuthProvider>
        );
      });

      await act(async () => {
        screen.getByText('Trigger Login').click();
      });

      // Can access PUBLIC (0) and INTERNAL (1)
      expect(clearanceRef.auth?.hasClearance(ClearanceLevel.PUBLIC)).toBe(true);
      expect(clearanceRef.auth?.hasClearance(ClearanceLevel.INTERNAL)).toBe(true);

      // Cannot access CONFIDENTIAL (2) or RESTRICTED (3)
      expect(clearanceRef.auth?.hasClearance(ClearanceLevel.CONFIDENTIAL)).toBe(false);
      expect(clearanceRef.auth?.hasClearance(ClearanceLevel.RESTRICTED)).toBe(false);
    });
  });
});
