'use client';

import React, { useState, useMemo } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Search,
  AlertTriangle,
  FolderOpen,
  Calendar,
  Pencil,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { IConversation } from '@enterprise-ai/shared-types';
import { Button, Modal, ModalFooter, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ConversationSidebarProps {
  conversations: IConversation[];
  activeConversationId?: string | null;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onRenameConversation?: (conversationId: string, newTitle: string) => Promise<void>;
  isLoading?: boolean;
  isCreating?: boolean;
  className?: string;
}

interface GroupedConversations {
  today: IConversation[];
  yesterday: IConversation[];
  previous7Days: IConversation[];
  older: IConversation[];
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  isLoading = false,
  isCreating = false,
  className,
}: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleStartRename = (c: IConversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title || '');
    setRenameError(null);
  };

  const handleCancelRename = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isSavingRename) return;
    setEditingId(null);
    setEditTitle('');
    setRenameError(null);
  };

  const handleSaveRename = async (conversationId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isSavingRename) return;
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setRenameError('Title cannot be empty');
      return;
    }
    if (trimmed.length > 150) {
      setRenameError('Title cannot exceed 150 characters');
      return;
    }

    if (!onRenameConversation) {
      setEditingId(null);
      return;
    }

    setIsSavingRename(true);
    setRenameError(null);
    try {
      await onRenameConversation(conversationId, trimmed);
      setEditingId(null);
      setEditTitle('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to rename conversation';
      setRenameError(msg);
    } finally {
      setIsSavingRename(false);
    }
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
    );
  }, [conversations, searchQuery]);

  // Group conversations chronologically into Today, Yesterday, Previous 7 days, Older
  const grouped = useMemo<GroupedConversations>(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const sevenDaysAgoStart = todayStart - 7 * 24 * 60 * 60 * 1000;

    const res: GroupedConversations = {
      today: [],
      yesterday: [],
      previous7Days: [],
      older: [],
    };

    filteredConversations.forEach((c) => {
      const time = new Date(c.updatedAt || c.createdAt).getTime();
      if (time >= todayStart) {
        res.today.push(c);
      } else if (time >= yesterdayStart) {
        res.yesterday.push(c);
      } else if (time >= sevenDaysAgoStart) {
        res.previous7Days.push(c);
      } else {
        res.older.push(c);
      }
    });

    return res;
  }, [filteredConversations]);

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

  const renderConversationItem = (c: IConversation) => {
    const isActive = c.id === activeConversationId;
    const isEditing = c.id === editingId;

    if (isEditing) {
      return (
        <div
          key={c.id}
          data-conversation-id={c.id}
          className={cn(
            'px-2 py-1.5 rounded-lg border text-xs min-h-[38px] transition-all my-0.5',
            isActive
              ? 'border-brand-primary/60 bg-surface-elevated text-primary shadow-xs'
              : 'border-brand-primary/40 bg-surface-elevated text-primary'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => {
                setEditTitle(e.target.value);
                if (renameError) setRenameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveRename(c.id);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelRename();
                }
              }}
              disabled={isSavingRename}
              maxLength={150}
              autoFocus
              aria-label={`Rename conversation: ${c.title}`}
              placeholder="Title (1-150 chars)"
              className={cn(
                'flex-1 px-2 py-1 text-xs rounded border outline-none min-w-0 transition-colors bg-surface text-primary placeholder:text-muted',
                renameError
                  ? 'border-status-error ring-1 ring-status-error'
                  : 'border-subtle focus:border-brand-primary focus:ring-1 focus:ring-brand-primary'
              )}
            />
            <button
              type="button"
              onClick={(e) => handleSaveRename(c.id, e)}
              disabled={isSavingRename}
              aria-label="Save conversation title"
              title="Save title"
              className="p-1 rounded shrink-0 min-h-[26px] min-w-[26px] flex items-center justify-center transition-colors text-brand-primary hover:text-brand-primary-hover hover:bg-brand-primary/10 disabled:opacity-50"
            >
              {isSavingRename ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => handleCancelRename(e)}
              disabled={isSavingRename}
              aria-label="Cancel renaming"
              title="Cancel"
              className="p-1 rounded shrink-0 min-h-[26px] min-w-[26px] flex items-center justify-center transition-colors text-muted hover:text-primary hover:bg-surface disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {renameError && (
            <div className="text-[10px] text-status-error mt-1 px-1 font-medium leading-tight">
              {renameError}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={c.id}
        role="button"
        tabIndex={0}
        aria-pressed={isActive}
        data-conversation-id={c.id}
        className={cn(
          'group flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all duration-150 select-none min-h-[38px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary',
          isActive
            ? 'bg-brand-primary text-white shadow-xs font-semibold'
            : 'text-secondary hover:text-primary hover:bg-surface-elevated'
        )}
        onClick={() => onSelectConversation(c.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectConversation(c.id);
          }
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-1.5">
          <MessageSquare
            className={cn(
              'w-3.5 h-3.5 shrink-0 transition-colors',
              isActive ? 'text-white' : 'text-muted group-hover:text-primary'
            )}
          />
          <span className="truncate leading-tight">{c.title || 'Untitled Conversation'}</span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => handleStartRename(c, e)}
            aria-label={`Rename conversation: ${c.title}`}
            title="Rename conversation"
            className={cn(
              'p-1 rounded-md transition-all shrink-0 min-h-[28px] min-w-[28px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary',
              isActive
                ? 'hover:bg-white/20 text-white/80 hover:text-white'
                : 'hover:bg-surface hover:text-primary text-muted'
            )}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDeletingId(c.id);
            }}
            aria-label={`Delete conversation: ${c.title}`}
            title="Delete conversation"
            className={cn(
              'p-1 rounded-md transition-all shrink-0 min-h-[28px] min-w-[28px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary',
              isActive
                ? 'hover:bg-white/20 text-white/80 hover:text-white'
                : 'hover:bg-surface hover:text-status-error text-muted'
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderGroup = (label: string, items: IConversation[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1 mb-3">
        <div className="px-3 py-1 text-[11px] font-semibold text-muted uppercase tracking-wider">
          {label}
        </div>
        <div className="space-y-0.5">
          {items.map(renderConversationItem)}
        </div>
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col h-full bg-surface border-r border-subtle select-none', className)}>
      {/* Header with New Chat CTA & Search */}
      <div className="p-3 border-b border-subtle space-y-2.5 shrink-0">
        <Button
          variant="primary"
          size="sm"
          className="w-full justify-center min-h-[40px] font-semibold text-xs shadow-sm bg-brand-primary hover:bg-brand-primary/90 text-white"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={onCreateConversation}
          isLoading={isCreating}
          aria-label="New Conversation"
        >
          New Chat
        </Button>

        {/* Search Filter */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search & filter conversations..."
            aria-label="Filter conversations"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-subtle bg-surface-elevated text-primary placeholder:text-muted outline-none focus:ring-1 focus:ring-brand-primary transition-all"
          />
        </div>
      </div>

      {/* Conversations List with Date Grouping */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="text-center py-10 px-4 text-xs text-muted space-y-2">
            <FolderOpen className="w-8 h-8 mx-auto text-muted/60" />
            <p>
              {searchQuery ? 'No matching conversations found' : 'No previous conversations yet'}
            </p>
          </div>
        ) : searchQuery.trim() ? (
          // When filtering, render flat list of matching items
          <div className="space-y-0.5">
            <div className="px-3 py-1 text-[11px] font-semibold text-muted uppercase tracking-wider">
              Search Results ({filteredConversations.length})
            </div>
            {filteredConversations.map(renderConversationItem)}
          </div>
        ) : (
          // Grouped sections matching reference UI board: Today, Yesterday, Previous 7 days, Older
          <div>
            {renderGroup('Today', grouped.today)}
            {renderGroup('Yesterday', grouped.yesterday)}
            {renderGroup('Previous 7 days', grouped.previous7Days)}
            {renderGroup('Older', grouped.older)}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingId)}
        onClose={() => !isDeleting && setDeletingId(null)}
        preventClose={isDeleting}
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

          <ModalFooter>
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
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
