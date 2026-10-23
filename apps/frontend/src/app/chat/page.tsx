'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  Sparkles,
  History,
  AlertCircle,
  FileText,
  ShieldCheck,
  X,
  BookOpen,
  Plus,
  Layers,
  ChevronRight,
  Shield,
} from 'lucide-react';
import {
  IConversation,
  IMessage,
  MessageSender,
  ICitation,
} from '@enterprise-ai/shared-types';
import { AppShell } from '@/components/layout';
import {
  ConversationSidebar,
  MessageBubble,
  ChatComposer,
  CitationDrawer,
  CitationItem,
  RelevantDocumentsPanel,
} from '@/components/chat';
import { ApiClient } from '@/lib/api-client';
import { streamChatMessage } from '@/lib/chat-stream';
import { Button, Card, Badge, Skeleton, useToast } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const SUGGESTED_PROMPTS = [
  'Summarize our corporate onboarding process and key requirements.',
  'What are the standard IT security standards and password policies?',
  'How do I apply for annual leave or submit expense claims?',
  'Explain the clearance requirements for viewing restricted documents.',
];

function ChatContent() {
  const searchParams = useSearchParams();
  const { user, isAdmin, clearance } = useAuth();
  const { error: showErrorToast, info: showInfoToast, success: showSuccessToast } = useToast();

  const [conversations, setConversations] = useState<IConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [composerText, setComposerText] = useState('');

  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  // Streaming State
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStage, setStreamingStage] = useState<'retrieving' | 'generating' | 'validating' | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<ICitation[]>([]);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const activeAbortController = useRef<AbortController | null>(null);

  // Citation Drawer State
  const [citationDrawerOpen, setCitationDrawerOpen] = useState(false);
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [drawerCitations, setDrawerCitations] = useState<CitationItem[]>([]);

  // Panels visibility (Responsive strategy)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [documentsPanelOpen, setDocumentsPanelOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryHandledRef = useRef(false);

  // Close mobile conversation history drawer on Escape key press
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileSidebarOpen]);

  // Scroll smoothly to bottom when messages or streaming content changes
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    });
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages, streamingContent, streamingStage, scrollToBottom]);

  // Load user conversations when user is authenticated
  const loadConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const data = await ApiClient.get<IConversation[]>('/api/v1/conversations');
      const list = Array.isArray(data) ? data : [];
      setConversations(list);

      // Select first conversation if none selected
      if (list.length > 0) {
        setActiveConversationId((prev) => prev || list[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load conversations';
      showErrorToast(msg, 'History Error');
    } finally {
      setIsLoadingConversations(false);
    }
  }, [showErrorToast]);

  useEffect(() => {
    if (user) {
      loadConversations();
    }
  }, [user, loadConversations]);

  // Handle URL query prefill (e.g. /chat?q=How%20do%20I%20apply%20for%20leave%3F)
  useEffect(() => {
    if (queryHandledRef.current) return;
    const qParam = searchParams.get('q') || searchParams.get('query');
    if (qParam && qParam.trim()) {
      setComposerText(qParam.trim());
      queryHandledRef.current = true;
    }
  }, [searchParams]);

  // Load message history when active conversation changes
  const loadMessages = useCallback(async (conversationId: string) => {
    setIsLoadingMessages(true);
    try {
      const data = await ApiClient.get<IMessage[]>(
        `/api/v1/conversations/${conversationId}/messages`,
        { limit: 100 }
      );
      setMessages(Array.isArray(data) ? data : []);
      setStreamingError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load message history';
      showErrorToast(msg, 'History Error');
    } finally {
      setIsLoadingMessages(false);
    }
  }, [showErrorToast]);

  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId, loadMessages]);

  // Create new conversation
  const handleCreateConversation = async () => {
    setIsCreatingConversation(true);
    try {
      const newConv = await ApiClient.post<IConversation>('/api/v1/conversations', {
        title: 'New Conversation',
      });
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newConv.id);
      setMobileSidebarOpen(false);
      setComposerText('');
      setStreamingError(null);
      showSuccessToast('Started new conversation', 'New Chat');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create conversation';
      showErrorToast(msg, 'Creation Error');
    } finally {
      setIsCreatingConversation(false);
    }
  };

  // Delete conversation
  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await ApiClient.delete(`/api/v1/conversations/${conversationId}`);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));

      if (activeConversationId === conversationId) {
        const remaining = conversations.filter((c) => c.id !== conversationId);
        setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
      }
      showInfoToast('Conversation removed', 'Deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete conversation';
      showErrorToast(msg, 'Delete Error');
    }
  };

  // Cancel in-flight generation
  const handleCancelGeneration = () => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
      activeAbortController.current = null;
    }
    setIsStreaming(false);
    setStreamingStage(null);

    if (streamingContent && activeConversationId) {
      const partialMsg: IMessage = {
        id: `cancelled-${Date.now()}`,
        conversationId: activeConversationId,
        sender: MessageSender.ASSISTANT,
        content: streamingContent + ' [Generation stopped]',
        status: 'cancelled',
        citations: streamingCitations as any,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, partialMsg]);
    }

    setStreamingContent('');
    setStreamingCitations([]);
  };

  // Submit message and stream response
  const handleSendMessage = async (textToSend?: string) => {
    const rawContent = (textToSend || composerText).trim();
    if (!rawContent || isStreaming) return;

    let targetConvId = activeConversationId;

    if (!targetConvId) {
      try {
        const newConv = await ApiClient.post<IConversation>('/api/v1/conversations', {
          title: rawContent.slice(0, 40),
        });
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        targetConvId = newConv.id;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to initiate conversation';
        showErrorToast(msg, 'Chat Error');
        return;
      }
    }

    if (!targetConvId) return;

    const userMsg: IMessage = {
      id: `temp-user-${Date.now()}`,
      conversationId: targetConvId,
      sender: MessageSender.USER,
      content: rawContent,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setComposerText('');
    setStreamingError(null);
    setIsStreaming(true);
    setStreamingStage('retrieving');
    setStreamingContent('');
    setStreamingCitations([]);

    const controller = new AbortController();
    activeAbortController.current = controller;
    const idempotencyKey = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    let accumulatedContent = '';
    let accumulatedCitations: ICitation[] = [];

    try {
      await streamChatMessage(targetConvId, rawContent, {
        signal: controller.signal,
        idempotencyKey,
        handlers: {
          onStarted: () => {
            setStreamingStage('retrieving');
          },
          onProgress: (data) => {
            setStreamingStage(data.stage);
          },
          onDelta: (chunk) => {
            accumulatedContent += chunk;
            setStreamingContent(accumulatedContent);
          },
          onCitations: (cits) => {
            accumulatedCitations = cits;
            setStreamingCitations(cits);
          },
          onCompleted: (data) => {
            const assistantMsg: IMessage = {
              id: data.messageId,
              conversationId: targetConvId,
              sender: MessageSender.ASSISTANT,
              content: accumulatedContent,
              status: 'completed',
              citations: accumulatedCitations as any,
              latencyMs: data.latencyMs,
              tokensUsed: data.tokensUsed,
              modelName: data.modelName,
              createdAt: new Date().toISOString(),
            };

            setMessages((prev) => [...prev, assistantMsg]);
            setIsStreaming(false);
            setStreamingStage(null);
            setStreamingContent('');
            setStreamingCitations([]);
            activeAbortController.current = null;
            loadConversations();
          },
          onError: (err) => {
            setStreamingError(err.message || 'Stream generation failed');
            setIsStreaming(false);
            setStreamingStage(null);
            activeAbortController.current = null;

            const errorMsg: IMessage = {
              id: `error-${Date.now()}`,
              conversationId: targetConvId,
              sender: MessageSender.ASSISTANT,
              content: '',
              status: 'failed',
              errorMessage: err.message,
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errorMsg]);
          },
        },
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Streaming encountered an error';
      setStreamingError(msg);
      setIsStreaming(false);
      setStreamingStage(null);
    }
  };

  // Open Citation Drawer
  const handleOpenCitation = (citationId: string, messageCitations: CitationItem[]) => {
    setSelectedCitationId(citationId);
    setDrawerCitations(messageCitations);
    setCitationDrawerOpen(true);
  };

  // Active Citations to display in the Right Relevant Documents Panel:
  // Derived from the active streaming citations or the most recent assistant message citations
  const activeRelevantCitations: CitationItem[] = useMemo(() => {
    if (isStreaming && streamingCitations.length > 0) {
      return streamingCitations as unknown as CitationItem[];
    }
    // Search messages backwards for the latest assistant message with citations
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.sender === MessageSender.ASSISTANT && msg.citations && msg.citations.length > 0) {
        return msg.citations as unknown as CitationItem[];
      }
    }
    return [];
  }, [isStreaming, streamingCitations, messages]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <AppShell className="p-0 sm:p-0 lg:p-0 max-w-full">
      <div className="flex h-[calc(100vh-4rem)] bg-canvas overflow-hidden">
        {/* ========================================================= */}
        {/* PANEL A: Left Conversations Sidebar (Desktop >= 1024px)   */}
        {/* ========================================================= */}
        <div className="hidden lg:block w-72 shrink-0 h-full">
          <ConversationSidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={(id) => setActiveConversationId(id)}
            onCreateConversation={handleCreateConversation}
            onDeleteConversation={handleDeleteConversation}
            isLoading={isLoadingConversations}
            isCreating={isCreatingConversation}
          />
        </div>

        {/* Mobile Left Conversations Slide-Over Drawer (< 1024px) */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Conversation History"
          >
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 w-[280px] max-w-[calc(100vw-40px)] bg-surface shadow-2xl z-50 flex flex-col">
              <div className="p-3 border-b border-subtle flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-muted">
                  Conversations
                </span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  aria-label="Close conversation history drawer"
                  className="p-1 rounded-md text-secondary hover:text-primary min-h-[40px] min-w-[40px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ConversationSidebar
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  onSelectConversation={(id) => {
                    setActiveConversationId(id);
                    setMobileSidebarOpen(false);
                  }}
                  onCreateConversation={handleCreateConversation}
                  onDeleteConversation={handleDeleteConversation}
                  isLoading={isLoadingConversations}
                  isCreating={isCreatingConversation}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* PANEL B: Center Main Chat Workspace                       */}
        {/* ========================================================= */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          {/* Compact Top Toolbar */}
          <div className="h-14 px-4 sm:px-6 border-b border-subtle bg-surface flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-elevated min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Open conversation history"
              >
                <History className="w-5 h-5" />
              </button>

              <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" />
              </div>

              <div className="min-w-0">
                <h1 className="text-sm font-bold text-primary truncate leading-tight">
                  {activeConversation?.title || 'Copilot Chat'}
                </h1>
                <p className="text-[11px] text-muted truncate leading-none mt-0.5">
                  Verified RAG Grounding &bull; Document Clearance Enforced
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-status-success/10 text-status-success border border-status-success/20">
                <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
                Ready
              </span>

              {/* Toggle Right Relevant Documents Panel */}
              <button
                type="button"
                onClick={() => setDocumentsPanelOpen(!documentsPanelOpen)}
                title={documentsPanelOpen ? 'Hide relevant documents' : 'Show relevant documents'}
                aria-label={documentsPanelOpen ? 'Hide relevant documents' : 'Show relevant documents'}
                className={cn(
                  'p-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                  documentsPanelOpen
                    ? 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary'
                    : 'border-subtle bg-surface text-secondary hover:text-primary hover:bg-surface-elevated'
                )}
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                <span className="hidden md:inline">Sources</span>
                {activeRelevantCitations.length > 0 && (
                  <Badge variant="brand" size="sm" className="ml-0.5">
                    {activeRelevantCitations.length}
                  </Badge>
                )}
              </button>
            </div>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-4xl w-full mx-auto">
            {isLoadingMessages ? (
              <div className="space-y-4 py-8">
                <div className="h-16 w-3/4 rounded-2xl bg-surface-elevated animate-pulse ml-auto" />
                <div className="h-32 w-5/6 rounded-2xl bg-surface-elevated animate-pulse" />
                <div className="h-16 w-2/3 rounded-2xl bg-surface-elevated animate-pulse ml-auto" />
              </div>
            ) : messages.length === 0 && !isStreaming ? (
              /* Empty Conversation Welcome State */
              <div className="text-center py-10 sm:py-14 space-y-6 max-w-xl mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-brand-primary text-white flex items-center justify-center mx-auto shadow-md shadow-brand-primary/20">
                  <Sparkles className="w-6 h-6" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-primary tracking-tight">
                    Enterprise Knowledge &amp; Support Copilot
                  </h2>
                  <p className="text-xs text-secondary leading-relaxed">
                    Ask questions grounded strictly in authorized corporate policies, manuals, and technical runbooks. Answers provide verifiable document citations.
                  </p>
                </div>

                {/* Clearance Status Pill */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-subtle bg-surface text-xs text-secondary">
                  <ShieldCheck className="w-4 h-4 text-brand-primary" />
                  <span>Authorized Clearance: <strong className="text-brand-primary font-semibold">{clearance || 'INTERNAL'}</strong></span>
                </div>

                {/* Suggested Inquiries */}
                <div className="space-y-2 pt-2 text-left">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block text-center">
                    Suggested Inquiries
                  </span>
                  <div className="space-y-2">
                    {SUGGESTED_PROMPTS.map((prompt, pIdx) => (
                      <button
                        key={`prompt-${pIdx}`}
                        type="button"
                        onClick={() => {
                          setComposerText(prompt);
                          handleSendMessage(prompt);
                        }}
                        className="w-full text-left p-3 rounded-xl border border-subtle bg-surface hover:bg-surface-elevated hover:border-brand-primary/40 transition-all text-xs text-secondary hover:text-primary flex items-center justify-between group shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                      >
                        <span className="truncate pr-3">{prompt}</span>
                        <Sparkles className="w-3.5 h-3.5 text-muted group-hover:text-brand-primary shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Conversation Message Stream */
              <>
                {messages.map((msg, idx) => (
                  <MessageBubble
                    key={msg.id || `msg-${idx}`}
                    message={msg}
                    onCitationClick={(citId) =>
                      handleOpenCitation(citId, (msg.citations as unknown as CitationItem[]) || [])
                    }
                    onRetry={() => {
                      const prevMsg = messages[idx - 1];
                      if (prevMsg && prevMsg.sender === MessageSender.USER) {
                        handleSendMessage(prevMsg.content);
                      }
                    }}
                  />
                ))}

                {/* In-Flight Streaming Assistant Bubble */}
                {isStreaming && (
                  <MessageBubble
                    message={{
                      id: 'streaming-assistant',
                      conversationId: activeConversationId || '',
                      sender: MessageSender.ASSISTANT,
                      content: streamingContent,
                      citations: streamingCitations as any,
                      createdAt: new Date().toISOString(),
                    }}
                    isStreaming={true}
                    streamingStage={streamingStage}
                    onCitationClick={(citId) =>
                      handleOpenCitation(
                        citId,
                        (streamingCitations as unknown as CitationItem[]) || []
                      )
                    }
                  />
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Fixed Composer Footer */}
          <div className="p-3 sm:p-4 border-t border-subtle bg-surface/90 backdrop-blur-md shrink-0">
            <div className="max-w-4xl mx-auto">
              <ChatComposer
                value={composerText}
                onChange={setComposerText}
                onSend={() => handleSendMessage()}
                onCancel={handleCancelGeneration}
                isStreaming={isStreaming}
                disabled={isLoadingMessages}
                placeholder={
                  isAdmin
                    ? 'Ask anything about your company knowledge...'
                    : 'Ask anything about company policies...'
                }
              />
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* PANEL C: Right Relevant Documents Panel (xl+ screens)     */}
        {/* ========================================================= */}
        {documentsPanelOpen && (
          <div className="hidden xl:block w-80 shrink-0 h-full">
            <RelevantDocumentsPanel
              citations={activeRelevantCitations}
              selectedCitationId={selectedCitationId}
              onSelectCitation={(citId) => {
                setSelectedCitationId(citId);
                setDrawerCitations(activeRelevantCitations);
                setCitationDrawerOpen(true);
              }}
              onClose={() => setDocumentsPanelOpen(false)}
            />
          </div>
        )}

        {/* Source Citation Details Drawer */}
        <CitationDrawer
          isOpen={citationDrawerOpen}
          onClose={() => setCitationDrawerOpen(false)}
          citations={drawerCitations}
          selectedCitationId={selectedCitationId}
          onSelectCitation={(id) => setSelectedCitationId(id)}
        />
      </div>
    </AppShell>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <AppShell className="p-0 sm:p-0 lg:p-0 max-w-full">
          <div className="flex h-[calc(100vh-4rem)] bg-canvas items-center justify-center">
            <Skeleton className="h-12 w-48 rounded-xl" />
          </div>
        </AppShell>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
