import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Role, ClearanceLevel, ISafeUser } from '@enterprise-ai/shared-types';

jest.mock('@/context/AuthContext');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

const mockUser: ISafeUser = {
  id: 'user-001',
  email: 'user@enterprise.com',
  name: 'User One',
  department: 'Operations',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ProtectedRoute', () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  it('renders loading skeleton while auth is loading', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });

    const { container } = render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('renders children for authenticated users meeting requirements', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      isAdmin: false,
      hasRole: () => true,
      hasClearance: () => true,
    });

    render(
      <ProtectedRoute>
        <div>Protected User Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Protected User Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('denies access to non-admin users when adminOnly is true', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser, // Role.USER
      isAuthenticated: true,
      isLoading: false,
      isAdmin: false,
      hasRole: () => false,
      hasClearance: () => true,
    });

    render(
      <ProtectedRoute adminOnly>
        <div>Admin Exclusive Data</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText('Admin Exclusive Data')).not.toBeInTheDocument();
    expect(screen.getByText('Administrative Access Denied')).toBeInTheDocument();
    expect(screen.getByText(/Your current profile role:/)).toBeInTheDocument();
  });

  it('allows Role.ADMIN or Role.SUPER_ADMIN when adminOnly is true', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { ...mockUser, role: Role.ADMIN },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: true,
      hasRole: () => true,
      hasClearance: () => true,
    });

    render(
      <ProtectedRoute adminOnly>
        <div>Admin Exclusive Data</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Admin Exclusive Data')).toBeInTheDocument();
  });

  it('denies access when user clearance is lower than requiredClearance', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      isAdmin: false,
      hasRole: () => true,
      hasClearance: (min: ClearanceLevel) => min === ClearanceLevel.INTERNAL, // False for CONFIDENTIAL
    });

    render(
      <ProtectedRoute requiredClearance={ClearanceLevel.CONFIDENTIAL}>
        <div>Classified Financial Reports</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText('Classified Financial Reports')).not.toBeInTheDocument();
    expect(screen.getByText('Security Clearance Restricted')).toBeInTheDocument();
  });
});
