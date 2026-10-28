import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConversationDetailPage from './[conversationId]/page';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { Role, ClearanceLevel, ISafeUser, MessageSender } from '@enterprise-ai/shared-types';

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
let mockParams = { conversationId: 'conv-101' };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/chat/conv-101',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => mockParams,
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

const mockUser: ISafeUser = {
  id: 'usr-1',
  email: 'employee@enterprise.ai',
  name: 'Dev User',
  department: 'Engineering',
  role: Role.USER,
  securityClearance: ClearanceLevel.INTERNAL,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockConversations = [
  {
    id: 'conv-101',
    title: 'Deployment Freeze Inquiry',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 2,
  },
  {
    id: 'conv-102',
    title: 'PTO Policy Questions',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 1,
  },
];

const mockMessages = [
  {
    id: 'msg-1',
    conversationId: 'conv-101',
    sender: MessageSender.USER,
    content: 'When is the production deployment freeze window?',
    citations: [],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'msg-2',
    conversationId: 'conv-101',
    sender: MessageSender.ASSISTANT,
    content: 'The production deployment freeze starts on Fridays after 2 PM [S1].',
    citations: [
      {
        evidenceId: 'S1',
        documentId: 'doc-eng-1',
        source: 'Engineering Runbook',
        chunkId: 'chunk-1',
        revision: 1,
        page: 2,
        section: 'Deployment Policies',
      },
    ],
    createdAt: new Date().toISOString(),
  },
];

describe('/chat/[conversationId] Dynamic Route Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { conversationId: 'conv-101' };

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

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/v1/conversations') {
        return Promise.resolve(mockConversations);
      }
      if (url.includes('/api/v1/conversations/conv-101/messages')) {
        return Promise.resolve(mockMessages);
      }
      return Promise.resolve([]);
    });
  });

  it('1. Loads and renders message history for the specified conversationId', async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ConversationDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    // Verify messages from conv-101 are rendered
    await waitFor(() => {
      expect(screen.getByText('When is the production deployment freeze window?')).toBeInTheDocument();
      expect(screen.getByText(/The production deployment freeze starts on Fridays after 2 PM/i)).toBeInTheDocument();
    });

    // Verify conversation title in toolbar
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deployment Freeze Inquiry');
  });

  it('2. Handles missing/unauthorized conversation gracefully without crashing', async () => {
    mockParams = { conversationId: 'conv-nonexistent' };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/v1/conversations') {
        return Promise.resolve(mockConversations);
      }
      if (url.includes('/messages')) {
        return Promise.reject(new Error('Conversation not found'));
      }
      return Promise.resolve([]);
    });

    render(
      <ThemeProvider defaultTheme="light">
        <ToastProvider>
          <ConversationDetailPage />
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Conversation Unavailable')).toBeInTheDocument();
    });
  });
});
