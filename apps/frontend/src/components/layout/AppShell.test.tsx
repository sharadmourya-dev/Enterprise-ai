import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppShell } from './AppShell';
import { SidebarNav } from './SidebarNav';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { Role, ClearanceLevel, ISafeUser } from '@enterprise-ai/shared-types';

jest.mock('@/context/AuthContext');
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}));

const mockUser: ISafeUser = {
  id: 'usr-101',
  email: 'charlie@enterprise.com',
  name: 'Charlie Davis',
  department: 'Security Operations',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider defaultTheme="light">
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>
  );
}

describe('AppShell & Navigation Architecture', () => {
  const mockLogout = jest.fn();
  const mockPush = jest.fn();

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

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (usePathname as jest.Mock).mockReturnValue('/chat');
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      role: Role.USER,
      clearance: ClearanceLevel.INTERNAL,
      isAdmin: false,
      hasRole: (r: Role) => r === Role.USER,
      hasClearance: () => true,
      logout: mockLogout,
    });
  });

  describe('Authenticated Layout Rendering', () => {
    it('renders desktop sidebar, top navbar, user claims, and main content', () => {
      renderWithProviders(
        <AppShell>
          <div>Copilot Content Inside Main</div>
        </AppShell>
      );

      // Verify skip link
      expect(screen.getByText('Skip to main content')).toBeInTheDocument();

      // Verify brand headers
      expect(screen.getAllByText('Enterprise AI').length).toBeGreaterThanOrEqual(1);

      // Verify user claims in top navigation
      expect(screen.getAllByText('Charlie Davis').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('INTERNAL').length).toBeGreaterThanOrEqual(1);

      // Verify main content region
      expect(screen.getByText('Copilot Content Inside Main')).toBeInTheDocument();
    });

    it('triggers logout when sign out button is clicked', async () => {
      renderWithProviders(
        <AppShell>
          <div>Main View</div>
        </AppShell>
      );

      const logoutButtons = screen.getAllByRole('button', { name: /sign out/i });
      expect(logoutButtons.length).toBeGreaterThanOrEqual(1);

      await act(async () => {
        fireEvent.click(logoutButtons[0]);
      });

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Role-Based Navigation Visibility', () => {
    it('shows only standard workspace navigation for standard users (Role.USER)', () => {
      renderWithProviders(<SidebarNav />);

      // Standard links are visible
      expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /copilot chat/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /document repository/i })).toBeInTheDocument();

      // Administrative links are strictly HIDDEN
      expect(screen.queryByText('Administration')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /analytics & trends/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /audit log inspector/i })).not.toBeInTheDocument();
    });

    it('shows administrative links when user has Role.ADMIN or Role.SUPER_ADMIN', () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { ...mockUser, role: Role.ADMIN },
        isAuthenticated: true,
        isLoading: false,
        role: Role.ADMIN,
        clearance: ClearanceLevel.RESTRICTED,
        isAdmin: true,
        hasRole: (r: Role) => r === Role.ADMIN,
        hasClearance: () => true,
        logout: mockLogout,
      });

      renderWithProviders(<SidebarNav />);

      // Both standard and administrative sections are present
      expect(screen.getByText('Administration')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /analytics & trends/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /audit log inspector/i })).toBeInTheDocument();
    });

    it('accurately indicates active navigation state based on current pathname', () => {
      (usePathname as jest.Mock).mockReturnValue('/chat');

      renderWithProviders(<SidebarNav />);

      const chatLink = screen.getByRole('link', { name: /copilot chat/i });
      expect(chatLink).toHaveAttribute('aria-current', 'page');
      expect(chatLink).toHaveClass('text-brand-primary');

      const docsLink = screen.getByRole('link', { name: /document repository/i });
      expect(docsLink).not.toHaveAttribute('aria-current');
    });
  });

  describe('Mobile Navigation Drawer', () => {
    it('opens mobile drawer when menu button is clicked and closes on close button', () => {
      renderWithProviders(
        <AppShell>
          <div>Main App</div>
        </AppShell>
      );

      // Drawer is initially not rendered in DOM
      expect(screen.queryByRole('dialog', { name: /mobile navigation drawer/i })).not.toBeInTheDocument();

      // Open drawer via top nav trigger
      const openBtn = screen.getByRole('button', { name: /open mobile navigation menu/i });
      fireEvent.click(openBtn);

      const drawer = screen.getByRole('dialog', { name: /mobile navigation drawer/i });
      expect(drawer).toBeInTheDocument();

      // Close drawer via close button
      const closeBtn = screen.getByRole('button', { name: /close mobile navigation drawer/i });
      fireEvent.click(closeBtn);

      expect(screen.queryByRole('dialog', { name: /mobile navigation drawer/i })).not.toBeInTheDocument();
    });

    it('closes mobile drawer on Escape key press', () => {
      renderWithProviders(
        <AppShell>
          <div>Main App</div>
        </AppShell>
      );

      const openBtn = screen.getByRole('button', { name: /open mobile navigation menu/i });
      fireEvent.click(openBtn);

      expect(screen.getByRole('dialog', { name: /mobile navigation drawer/i })).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByRole('dialog', { name: /mobile navigation drawer/i })).not.toBeInTheDocument();
    });
  });

  describe('Unauthenticated and Loading Protection', () => {
    it('redirects to /login and does not render shell content when unauthenticated', () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        role: null,
        clearance: null,
        isAdmin: false,
        hasRole: () => false,
        hasClearance: () => false,
        logout: mockLogout,
      });

      renderWithProviders(
        <AppShell>
          <div>Secret Protected Content</div>
        </AppShell>
      );

      expect(screen.queryByText('Secret Protected Content')).not.toBeInTheDocument();
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });
});
