import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ChangePasswordPage from './page';
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
  usePathname: () => '/profile/change-password',
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode = 400, code = 'BAD_REQUEST') {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

const mockUser: ISafeUser = {
  id: 'usr-1',
  email: 'user@enterprise.ai',
  name: 'User One',
  department: 'IT',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ChangePasswordPage Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  it('1. Renders change password form fields and validation rules', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ChangePasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    expect(screen.getByRole('heading', { name: /change corporate password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new password \(min 8 characters\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update password/i })).toBeInTheDocument();
  });

  it('2. Shows client-side validation error when password is under 8 characters', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ChangePasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'CurrentPassword123!' },
    });
    fireEvent.change(screen.getByLabelText(/new password \(min 8 characters\)/i), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'short' },
    });

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/new password must be at least 8 characters long/i)).toBeInTheDocument();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  it('3. Successfully submits valid password change and displays success feedback', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      message: 'Password changed successfully',
    });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ChangePasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'CurrentPassword123!' },
    });
    fireEvent.change(screen.getByLabelText(/new password \(min 8 characters\)/i), {
      target: { value: 'BrandNewSecurePassword123!' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'BrandNewSecurePassword123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/api/v1/auth/change-password', {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'BrandNewSecurePassword123!',
      });
    });

    expect(await screen.findByText(/password successfully updated/i)).toBeInTheDocument();
  });
});
