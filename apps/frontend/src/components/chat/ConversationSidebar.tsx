'use client';

import React, { useState } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Search,
  AlertTriangle,
  FolderOpen,
} from 'lucide-react';
import { IConversation } from '@enterprise-ai/shared-types';
import { Button, Modal, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ConversationSidebarProps {
  conversations: IConversation[];
  activeConversationId?: string | null;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  isLoading?: boolean;
  isCreating?: boolean;
  className?: string;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  isLoading = false,
  isCreating = false,
  className,
}: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const conversationToDelete = conversations.find((c) => c.id === deletingId);

  const confirmDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await onDeleteConversation(deletingId);
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-surface border-r border-subtle select-none', className)}>
      {/* Header with New Chat CTA */}
      <div className="p-3.5 border-b border-subtle space-y-3">
        <Button
          variant="primary"
          size="sm"
          className="w-full justify-center min-h-[40px] font-semibold"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={onCreateConversation}
          isLoading={isCreating}
        >
          New Conversation
        </Button>

        {/* Search Filter */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter conversations..."
            aria-label="Filter conversations"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-subtle bg-surface-elevated text-primary placeholder:text-muted outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="text-center py-10 px-4 text-xs text-muted space-y-2">
            <FolderOpen className="w-8 h-8 mx-auto text-muted/60" />
            <p>
              {searchQuery ? 'No matching conversations found' : 'No previous conversations yet'}
            </p>
          </div>
        ) : (
          filteredConversations.map((c) => {
            const isActive = c.id === activeConversationId;
            return (
              <div
                key={c.id}
                className={cn(
                  'group flex items-center justify-between p-2.5 rounded-lg text-xs font-medium cursor-pointer transition-all duration-150',
                  isActive
                    ? 'bg-brand-primary/10 text-brand-primary font-semibold'
                    : 'text-secondary hover:text-primary hover:bg-surface-elevated'
                )}
                onClick={() => onSelectConversation(c.id)}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                  <MessageSquare
                    className={cn(
                      'w-4 h-4 shrink-0 transition-colors',
                      isActive ? 'text-brand-primary' : 'text-muted group-hover:text-primary'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate leading-tight">{c.title || 'Untitled Conversation'}</p>
                    <p className="text-[10px] text-muted truncate mt-0.5 font-normal">
                      {new Date(c.updatedAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingId(c.id);
                  }}
                  aria-label={`Delete conversation: ${c.title}`}
                  title="Delete conversation"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-md hover:bg-surface hover:text-status-error text-muted transition-all min-h-[32px] min-w-[32px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingId)}
        onClose={() => setDeletingId(null)}
        title="Delete Conversation"
        description="Are you sure you want to delete this conversation?"
      >
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-status-warning/30 bg-status-warning/10 text-xs text-status-warning flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              This will remove &quot;{conversationToDelete?.title}&quot; and all associated message history. This action cannot be undone.
            </p>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeletingId(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={confirmDelete}
              isLoading={isDeleting}
            >
              Delete Conversation
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
