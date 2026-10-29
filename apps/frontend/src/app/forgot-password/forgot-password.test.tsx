import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ForgotPasswordPage from './page';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';

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

jest.mock('@/lib/api-client', () => {
  class MockApiClientError extends Error {
    constructor(
      message: string,
      public statusCode = 0,
      public code = 'NETWORK_ERROR',
      public details?: any,
      public requestId?: string
    ) {
      super(message);
      this.name = 'ApiClientError';
    }
  }

  return {
    ApiClient: {
      post: jest.fn(),
    },
    ApiClientError: MockApiClientError,
  };
});

describe('ForgotPasswordPage Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. Renders forgot password form with corporate email field', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ForgotPasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/corporate email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send recovery link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('2. Shows validation error when email is empty or invalid format', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ForgotPasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    const submitBtn = screen.getByRole('button', { name: /send recovery link/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/please enter your corporate email address/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/corporate email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/please enter a valid email address/i)).toBeInTheDocument();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  it('3. Submits valid email and renders generic non-revealing confirmation message', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      message: 'If an account with that email address exists, password reset instructions have been sent.',
    });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ForgotPasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.change(screen.getByLabelText(/corporate email/i), {
      target: { value: 'employee@enterprise.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send recovery link/i }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/api/v1/auth/forgot-password', {
        email: 'employee@enterprise.com',
      });
    });

    const confirmations = await screen.findAllByText(/request received/i);
    expect(confirmations.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/password recovery notice/i)).toBeInTheDocument();
  });

  it('4. Displays connection error toast when a network error occurs', async () => {
    const { ApiClientError } = require('@/lib/api-client');
    (ApiClient.post as jest.Mock).mockRejectedValueOnce(
      new ApiClientError('Failed to fetch', 0, 'NETWORK_ERROR')
    );

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ForgotPasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.change(screen.getByLabelText(/corporate email/i), {
      target: { value: 'employee@enterprise.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send recovery link/i }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalled();
    });

    expect(await screen.findByText(/unable to reach authentication server/i)).toBeInTheDocument();
    expect(screen.queryByText(/request received/i)).not.toBeInTheDocument();
  });

  it('5. Displays service unavailable toast when backend reports 503 error', async () => {
    const { ApiClientError } = require('@/lib/api-client');
    (ApiClient.post as jest.Mock).mockRejectedValueOnce(
      new ApiClientError('Unable to process password reset request at this time. Please try again later.', 503, 'SERVICE_UNAVAILABLE')
    );

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ForgotPasswordPage />
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.change(screen.getByLabelText(/corporate email/i), {
      target: { value: 'employee@enterprise.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send recovery link/i }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalled();
    });

    expect(await screen.findByText(/unable to process password reset request/i)).toBeInTheDocument();
    expect(screen.queryByText(/request received/i)).not.toBeInTheDocument();
  });
});
