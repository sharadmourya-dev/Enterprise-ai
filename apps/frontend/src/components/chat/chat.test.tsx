import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CitationDrawer, CitationItem } from './CitationDrawer';
import { FeedbackButtons } from './FeedbackButtons';
import { ChatComposer } from './ChatComposer';
import { ConversationSidebar } from './ConversationSidebar';
import { MessageBubble } from './MessageBubble';
import { RelevantDocumentsPanel } from './RelevantDocumentsPanel';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ApiClient } from '@/lib/api-client';
import { IConversation, IMessage, MessageSender, FeedbackRating, FeedbackCategory } from '@enterprise-ai/shared-types';

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

describe('Chat UI Components & Interactions', () => {
  describe('MarkdownRenderer (Safe XSS-Proof Rendering)', () => {
    it('renders headings, bold, italic, and lists correctly', () => {
      const content = `### Section Heading\n\nThis is **bold text** and *italic text*.\n\n- Item One\n- Item Two`;
      render(<MarkdownRenderer content={content} />);

      expect(screen.getByRole('heading', { level: 3, name: /section heading/i })).toBeInTheDocument();
      expect(screen.getByText('bold text')).toBeInTheDocument();
      expect(screen.getByText('italic text')).toBeInTheDocument();
      expect(screen.getByText('Item One')).toBeInTheDocument();
      expect(screen.getByText('Item Two')).toBeInTheDocument();
    });

    it('renders interactive citation pills and triggers callback on click', () => {
      const onCitationClick = jest.fn();
      const content = 'According to security policy [S1], passwords must rotate quarterly [S2].';
      render(<MarkdownRenderer content={content} onCitationClick={onCitationClick} />);

      const s1Btn = screen.getByRole('button', { name: /view citation source s1/i });
      const s2Btn = screen.getByRole('button', { name: /view citation source s2/i });

      expect(s1Btn).toBeInTheDocument();
      expect(s2Btn).toBeInTheDocument();

      fireEvent.click(s1Btn);
      expect(onCitationClick).toHaveBeenCalledWith('S1');

      fireEvent.click(s2Btn);
      expect(onCitationClick).toHaveBeenCalledWith('S2');
    });

    it('strictly sanitizes raw HTML tags and prevents script injection (zero XSS)', () => {
      const malicious = '<script>window.pwned = true;</script><img src="x" onerror="alert(1)" />Safe text';
      render(<MarkdownRenderer content={malicious} />);

      // Ensure no script or img elements were injected into the DOM
      expect(document.querySelector('script')).toBeNull();
      expect(document.querySelector('img')).toBeNull();
      expect(screen.getByText(/Safe text/i)).toBeInTheDocument();
    });

    it('renders code blocks with language tag and copy button', () => {
      const codeBlock = '```typescript\nconst greeting: string = "hello";\n```';
      render(<MarkdownRenderer content={codeBlock} />);

      expect(screen.getByText('typescript')).toBeInTheDocument();
      expect(screen.getByText(/const greeting: string/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /copy code to clipboard/i })).toBeInTheDocument();
    });
  });

  describe('CitationDrawer', () => {
    const mockCitations: CitationItem[] = [
      {
        evidenceId: 'S1',
        documentId: 'doc-alpha',
        title: 'Information Security Standard',
        chunkId: 'chunk-101',
        revision: 2,
        page: 14,
        section: 'Access Control Guidelines',
        snippet: 'All administrative accounts must enforce hardware token MFA.',
        relevanceScore: 0.94,
      },
      {
        evidenceId: 'S2',
        documentId: 'doc-beta',
        title: 'Incident Response Protocol',
        chunkId: 'chunk-202',
        revision: 1,
        page: 3,
        section: 'Severity Tier 1',
        snippet: 'P1 incidents trigger immediate on-call notification within 15 minutes.',
        relevanceScore: 0.88,
      },
    ];

    it('renders citation details including evidence ID, page number, revision, and snippet', () => {
      render(
        <CitationDrawer
          isOpen={true}
          onClose={jest.fn()}
          citations={mockCitations}
          selectedCitationId="S1"
        />
      );

      expect(screen.getByRole('dialog', { name: /source document details/i })).toBeInTheDocument();
      expect(screen.getByText('Evidence [S1]')).toBeInTheDocument();
      expect(screen.getByText('Information Security Standard')).toBeInTheDocument();
      expect(screen.getByText('Page 14')).toBeInTheDocument();
      expect(screen.getByText('Rev v2')).toBeInTheDocument();
      expect(screen.getByText(/All administrative accounts must enforce hardware token MFA/i)).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked or Escape key is pressed', () => {
      const onClose = jest.fn();
      render(
        <CitationDrawer
          isOpen={true}
          onClose={onClose}
          citations={mockCitations}
          selectedCitationId="S1"
        />
      );

      const closeBtn = screen.getByRole('button', { name: /close citation details/i });
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('switches between multiple citations when tabs are clicked', () => {
      const onSelectCitation = jest.fn();
      render(
        <CitationDrawer
          isOpen={true}
          onClose={jest.fn()}
          citations={mockCitations}
          selectedCitationId="S1"
          onSelectCitation={onSelectCitation}
        />
      );

      const s2Tab = screen.getByRole('button', { name: 'S2' });
      fireEvent.click(s2Tab);
      expect(onSelectCitation).toHaveBeenCalledWith('S2');
    });
  });

  describe('FeedbackButtons', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(ApiClient, 'post').mockResolvedValue({ success: true, data: { id: 'fb-1' } });
    });

    it('submits thumbs up feedback directly', async () => {
      renderWithProviders(
        <FeedbackButtons
          conversationId="conv-1"
          messageId="msg-1"
        />
      );

      const thumbsUp = screen.getByRole('button', { name: /submit positive feedback/i });
      fireEvent.click(thumbsUp);

      await waitFor(() => {
        expect(ApiClient.post).toHaveBeenCalledWith('/api/v1/feedback', {
          conversationId: 'conv-1',
          messageId: 'msg-1',
          rating: FeedbackRating.THUMBS_UP,
          category: FeedbackCategory.ACCURATE_HELPFUL,
          userComment: undefined,
        });
      });

      // Both buttons are disabled after submission to prevent duplicate submits
      expect(thumbsUp).toBeDisabled();
      expect(screen.getByRole('button', { name: /submit negative feedback/i })).toBeDisabled();
    });

    it('opens category modal on thumbs down and submits chosen category and comment', async () => {
      renderWithProviders(
        <FeedbackButtons
          conversationId="conv-1"
          messageId="msg-1"
        />
      );

      const thumbsDown = screen.getByRole('button', { name: /submit negative feedback/i });
      fireEvent.click(thumbsDown);

      expect(screen.getByRole('dialog', { name: /report an issue with this answer/i })).toBeInTheDocument();

      // Enter optional comment
      const commentInput = screen.getByPlaceholderText(/tell us what was incorrect/i);
      fireEvent.change(commentInput, { target: { value: 'Citation page was incorrect' } });

      // Submit modal form
      const submitBtn = screen.getByRole('button', { name: /submit feedback/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(ApiClient.post).toHaveBeenCalledWith('/api/v1/feedback', {
          conversationId: 'conv-1',
          messageId: 'msg-1',
          rating: FeedbackRating.THUMBS_DOWN,
          category: FeedbackCategory.HALLUCINATION,
          userComment: 'Citation page was incorrect',
        });
      });
    });
  });

  describe('ChatComposer', () => {
    it('disables send button when text is empty or whitespace', () => {
      const onSend = jest.fn();
      render(
        <ChatComposer
          value="   "
          onChange={jest.fn()}
          onSend={onSend}
        />
      );

      const sendBtn = screen.getByRole('button', { name: /send message/i });
      expect(sendBtn).toBeDisabled();

      fireEvent.click(sendBtn);
      expect(onSend).not.toHaveBeenCalled();
    });

    it('triggers onSend on Enter key without Shift', () => {
      const onSend = jest.fn();
      render(
        <ChatComposer
          value="Explain retention policy"
          onChange={jest.fn()}
          onSend={onSend}
        />
      );

      const textarea = screen.getByLabelText(/message prompt input/i);
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('does not trigger onSend on Shift+Enter (allows newline)', () => {
      const onSend = jest.fn();
      render(
        <ChatComposer
          value="Multi line query"
          onChange={jest.fn()}
          onSend={onSend}
        />
      );

      const textarea = screen.getByLabelText(/message prompt input/i);
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(onSend).not.toHaveBeenCalled();
    });

    it('shows stop button during streaming and triggers onCancel', () => {
      const onCancel = jest.fn();
      render(
        <ChatComposer
          value=""
          onChange={jest.fn()}
          onSend={jest.fn()}
          onCancel={onCancel}
          isStreaming={true}
        />
      );

      const stopBtn = screen.getByRole('button', { name: /stop generating response/i });
      expect(stopBtn).toBeInTheDocument();

      fireEvent.click(stopBtn);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('ConversationSidebar', () => {
    const mockConversations: IConversation[] = [
      {
        id: 'c-1',
        userId: 'u-1',
        title: 'Security Guidelines Query',
        status: 'active',
        selectedModelProvider: 'openai' as any,
        selectedModelName: 'gpt-4o',
        createdAt: '2026-10-21T08:00:00Z',
        updatedAt: '2026-10-21T08:00:00Z',
      },
      {
        id: 'c-2',
        userId: 'u-1',
        title: 'Data Retention Policies',
        status: 'active',
        selectedModelProvider: 'gemini' as any,
        selectedModelName: 'gemini-1.5-pro',
        createdAt: '2026-10-20T08:00:00Z',
        updatedAt: '2026-10-20T08:00:00Z',
      },
    ];

    it('renders conversation items and filters by search query', () => {
      render(
        <ConversationSidebar
          conversations={mockConversations}
          activeConversationId="c-1"
          onSelectConversation={jest.fn()}
          onCreateConversation={jest.fn()}
          onDeleteConversation={jest.fn()}
        />
      );

      expect(screen.getByText('Security Guidelines Query')).toBeInTheDocument();
      expect(screen.getByText('Data Retention Policies')).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText(/filter conversations/i);
      fireEvent.change(searchInput, { target: { value: 'Retention' } });

      expect(screen.queryByText('Security Guidelines Query')).not.toBeInTheDocument();
      expect(screen.getByText('Data Retention Policies')).toBeInTheDocument();
    });

    it('triggers onCreateConversation when New Conversation is clicked', () => {
      const onCreate = jest.fn();
      render(
        <ConversationSidebar
          conversations={mockConversations}
          onSelectConversation={jest.fn()}
          onCreateConversation={onCreate}
          onDeleteConversation={jest.fn()}
        />
      );

      const newBtn = screen.getByRole('button', { name: /new conversation/i });
      fireEvent.click(newBtn);

      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('opens delete confirmation modal and executes deletion', async () => {
      const onDelete = jest.fn().mockResolvedValue(undefined);
      render(
        <ConversationSidebar
          conversations={mockConversations}
          onSelectConversation={jest.fn()}
          onCreateConversation={jest.fn()}
          onDeleteConversation={onDelete}
        />
      );

      const deleteBtn = screen.getByRole('button', {
        name: /delete conversation: security guidelines query/i,
      });
      fireEvent.click(deleteBtn);

      expect(screen.getByRole('dialog', { name: /delete conversation/i })).toBeInTheDocument();

      // Confirm delete in modal
      const confirmBtn = screen.getByRole('button', { name: /delete conversation$/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith('c-1');
      });
    });
  });

  describe('MessageBubble', () => {
    it('renders user message distinct from assistant message', () => {
      const userMessage: IMessage = {
        id: 'msg-u',
        conversationId: 'c-1',
        sender: MessageSender.USER,
        content: 'How do I request high clearance access?',
        createdAt: '2026-10-21T09:00:00Z',
      };

      const { rerender } = render(<MessageBubble message={userMessage} />);
      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('How do I request high clearance access?')).toBeInTheDocument();

      const assistantMessage: IMessage = {
        id: 'msg-a',
        conversationId: 'c-1',
        sender: MessageSender.ASSISTANT,
        content: 'Clearance requests must be submitted through HR Portal.',
        modelName: 'gpt-4o',
        latencyMs: 1200,
        tokensUsed: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        createdAt: '2026-10-21T09:00:02Z',
      };

      rerender(
        <ThemeProvider defaultTheme="light">
          <ToastProvider>
            <MessageBubble message={assistantMessage} />
          </ToastProvider>
        </ThemeProvider>
      );

      expect(screen.getByText('Knowledge Copilot')).toBeInTheDocument();
      expect(screen.getByText('Clearance requests must be submitted through HR Portal.')).toBeInTheDocument();
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
      expect(screen.getByText('1.20s')).toBeInTheDocument();
      expect(screen.getByText('75 tokens')).toBeInTheDocument();
    });
  });

  describe('RelevantDocumentsPanel', () => {
    const mockCitations: CitationItem[] = [
      {
        evidenceId: 'S1',
        documentId: 'doc-1',
        title: 'HR Onboarding Process.pdf',
        chunkId: 'chk-1',
        page: 4,
        snippet: 'Submit completed tax declaration and benefits form.',
      },
      {
        evidenceId: 'S2',
        documentId: 'doc-2',
        title: 'IT Access Policy.docx',
        chunkId: 'chk-2',
        page: 6,
        snippet: 'VPN keys rotate every 30 calendar days.',
      },
    ];

    it('renders empty state when citations array is empty', () => {
      render(
        <RelevantDocumentsPanel
          citations={[]}
          onSelectCitation={jest.fn()}
        />
      );

      expect(screen.getByText('Relevant Documents')).toBeInTheDocument();
      expect(screen.getByText('No sources cited yet')).toBeInTheDocument();
    });

    it('renders unique document cards with page indicators and triggers onSelectCitation', () => {
      const onSelect = jest.fn();
      render(
        <RelevantDocumentsPanel
          citations={mockCitations}
          onSelectCitation={onSelect}
        />
      );

      expect(screen.getByText('HR Onboarding Process.pdf')).toBeInTheDocument();
      expect(screen.getByText('Page 4')).toBeInTheDocument();
      expect(screen.getByText('IT Access Policy.docx')).toBeInTheDocument();
      expect(screen.getByText('Page 6')).toBeInTheDocument();

      const docBtn = screen.getByText('HR Onboarding Process.pdf').closest('button');
      expect(docBtn).not.toBeNull();
      fireEvent.click(docBtn!);

      expect(onSelect).toHaveBeenCalledWith('S1');
    });
  });
});
