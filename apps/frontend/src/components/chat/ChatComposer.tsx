'use client';

import React, { useRef, useEffect } from 'react';
import { Send, Square, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const MAX_CHAR_LIMIT = 4000;

export function ChatComposer({
  value,
  onChange,
  onSend,
  onCancel,
  isStreaming = false,
  disabled = false,
  placeholder = 'Ask a question across your authorized corporate knowledge base...',
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height up to 200px max
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
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

  const isOverLimit = value.length > MAX_CHAR_LIMIT;
  const canSend = value.trim().length > 0 && !disabled && !isStreaming && !isOverLimit;

  return (
    <div className={cn('relative w-full', className)}>
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
            'outline-none focus:outline-none min-h-[48px] max-h-[200px] leading-relaxed'
          )}
        />

        {/* Action Button: Send or Stop */}
        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop generating response"
              title="Stop generation"
              className="w-8 h-8 rounded-lg bg-status-error text-white flex items-center justify-center hover:bg-status-error/90 active:scale-95 transition-all shadow-xs"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send message"
              title="Send message (Enter)"
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all shadow-xs',
                canSend
                  ? 'bg-brand-primary text-white hover:bg-brand-hover active:scale-95'
                  : 'bg-surface-elevated text-muted cursor-not-allowed opacity-50'
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Helper text with keyboard shortcut hints and character count */}
      <div className="flex items-center justify-between px-1.5 pt-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-surface-elevated border border-subtle text-[10px] font-mono">
            Enter
          </kbd>
          <span>to send,</span>
          <kbd className="px-1 py-0.5 rounded bg-surface-elevated border border-subtle text-[10px] font-mono">
            Shift + Enter
          </kbd>
          <span>for new line</span>
        </span>

        {value.length > 3000 && (
          <span className={cn('font-mono', isOverLimit ? 'text-status-error font-semibold' : 'text-muted')}>
            {value.length}/{MAX_CHAR_LIMIT}
          </span>
        )}
      </div>
    </div>
  );
}
