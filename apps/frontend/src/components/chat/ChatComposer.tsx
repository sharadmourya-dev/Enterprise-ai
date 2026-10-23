'use client';

import React, { useRef, useEffect } from 'react';
import { Send, Square, Sparkles, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (overrideText?: string) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  suggestedActions?: string[];
  className?: string;
}

const DEFAULT_SUGGESTED_ACTIONS = [
  'Summarize key points',
  'Create a checklist',
  'Explain in simple terms',
];

const MAX_CHAR_LIMIT = 4000;

export function ChatComposer({
  value,
  onChange,
  onSend,
  onCancel,
  isStreaming = false,
  disabled = false,
  placeholder = 'Ask anything about your company knowledge...',
  suggestedActions = DEFAULT_SUGGESTED_ACTIONS,
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height up to 180px
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 180);
    textarea.style.height = `${Math.max(newHeight, 44)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && value.trim() && !disabled) {
        onSend();
      }
    }
  };

  const handleActionClick = (actionText: string) => {
    if (disabled || isStreaming) return;
    const newText = value.trim() ? `${value.trim()}\n\nPlease ${actionText.toLowerCase()}.` : actionText;
    onChange(newText);
    textareaRef.current?.focus();
  };

  const isOverLimit = value.length > MAX_CHAR_LIMIT;
  const canSend = value.trim().length > 0 && !disabled && !isStreaming && !isOverLimit;

  return (
    <div className={cn('relative w-full space-y-2', className)}>
      {/* Quick Action Chips from Reference UI Board */}
      {suggestedActions && suggestedActions.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-1">
          {suggestedActions.map((action, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleActionClick(action)}
              disabled={disabled || isStreaming}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-subtle bg-surface-elevated/80 text-secondary hover:text-primary hover:border-brand-primary/40 hover:bg-surface-elevated transition-all flex items-center gap-1 select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:opacity-50"
            >
              <Sparkles className="w-2.5 h-2.5 text-brand-primary shrink-0" />
              <span>{action}</span>
            </button>
          ))}
        </div>
      )}

      {/* Composer Input Area */}
      <div
        className={cn(
          'relative rounded-xl border border-subtle bg-surface shadow-sm transition-all duration-150',
          'focus-within:ring-2 focus-within:ring-brand-primary focus-within:border-transparent',
          disabled && 'opacity-60 pointer-events-none'
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isStreaming}
          rows={1}
          placeholder={placeholder}
          aria-label="Message prompt input"
          className={cn(
            'w-full py-3 pl-4 pr-14 bg-transparent text-sm text-primary placeholder:text-muted resize-none',
            'outline-none focus:outline-none min-h-[48px] max-h-[180px] leading-relaxed'
          )}
        />

        {/* Action Button: Send or Stop */}
        <div className="absolute right-2.5 bottom-2 flex items-center gap-1.5">
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop generating response"
              title="Stop generation"
              className="w-8 h-8 rounded-lg bg-status-error text-white flex items-center justify-center hover:bg-status-error/90 active:scale-95 transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-error"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSend()}
              disabled={!canSend}
              aria-label="Send message"
              title="Send message (Enter)"
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                canSend
                  ? 'bg-brand-primary text-white hover:bg-brand-hover active:scale-95'
                  : 'bg-surface-elevated text-muted cursor-not-allowed'
              )}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Character limit feedback if approaching limit */}
      {value.length > MAX_CHAR_LIMIT - 200 && (
        <div className="text-right px-1">
          <span
            className={cn(
              'text-[10px] font-medium',
              isOverLimit ? 'text-status-error' : 'text-muted'
            )}
          >
            {value.length} / {MAX_CHAR_LIMIT} characters
          </span>
        </div>
      )}
    </div>
  );
}
