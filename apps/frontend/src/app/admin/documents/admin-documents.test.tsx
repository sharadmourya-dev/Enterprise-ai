import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import AdminDocumentsRedirect from './page';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
  }),
  usePathname: () => '/admin/documents',
}));

describe('/admin/documents Route Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('safely redirects legacy /admin/documents route to the canonical /documents repository', async () => {
    render(<AdminDocumentsRedirect />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/documents');
    });
  });
});
