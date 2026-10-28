import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import DashboardRedirect from './page';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
  }),
  usePathname: () => '/dashboard',
}));

describe('/dashboard Route Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('safely redirects /dashboard requests to the canonical / dashboard route', async () => {
    render(<DashboardRedirect />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });
});
