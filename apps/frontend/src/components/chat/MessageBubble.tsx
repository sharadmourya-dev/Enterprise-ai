'use client';

import React, { useState } from 'react';
import {
  User,
  Bot,
  Copy,
  Check,
  RotateCcw,
  AlertCircle,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { IMessage, MessageSender } from '@enterprise-ai/shared-types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { FeedbackButtons } from './FeedbackButtons';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { CitationItem } from './CitationDrawer';

export interface MessageBubbleProps {
  message: IMessage;
  isStreaming?: boolean;
  streamingStage?: 'retrieving' | 'generating' | 'validating' | null;
  onCitationClick?: (citationId: string) => void;
  onRetry?: () => void;
  className?: string;
}

export function MessageBubble({
  message,
  isStreaming = false,
  streamingStage,
  onCitationClick,
  onRetry,
  className,
}: MessageBubbleProps) {
  const isUser = message.sender === MessageSender.USER;
  const isFailed = message.status === 'failed' || Boolean(message.errorMessage);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied
    }
  };

  const citations: CitationItem[] = (message.citations as unknown as CitationItem[]) || [];

  if (isUser) {
    return (
      <div className={cn('flex justify-end gap-2.5 my-3', className)}>
        <div className="max-w-[85%] sm:max-w-[75%] space-y-1">
          {/* Header metadata */}
          <div className="flex items-center justify-end gap-2 text-[11px] text-muted pr-1">
            <span className="font-semibold text-primary">You</span>
            <span>&bull;</span>
            <span>
              {message.createdAt
                ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'Just now'}
            </span>
          </div>

          {/* Electric-Blue User Bubble */}
          <div className="bg-brand-primary text-white px-4 py-3 rounded-2xl rounded-tr-xs shadow-sm text-sm leading-relaxed break-words">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex gap-3 sm:gap-4 my-4 p-4 sm:p-5 rounded-2xl rounded-tl-xs bg-surface-elevated/70 border border-subtle/80 shadow-xs transition-colors',
        className
      )}
    >
      {/* Assistant Avatar */}
      <div className="w-8 h-8 rounded-lg bg-brand-primary text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
        <Sparkles className="w-4 h-4" />
      </div>

      {/* Message Body & Metadata */}
      <div className="flex-1 min-w-0 space-y-2.5">
        {/* Header line with Sender name & Model info */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-primary">Knowledge Copilot</span>

            {message.modelName && (
              <Badge variant="default" size="sm" className="hidden sm:inline-flex text-[10px] py-0 px-1.5 font-mono">
                {message.modelName}
              </Badge>
            )}

            {isStreaming && streamingStage && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-brand-primary/10 text-brand-primary animate-pulse">
                <Sparkles className="w-3 h-3 animate-spin" />
                <span className="capitalize">{streamingStage}...</span>
              </span>
            )}
          </div>

          <span className="text-[11px] text-muted whitespace-nowrap">
            {message.createdAt
              ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'Just now'}
          </span>
        </div>

        {/* Content Section */}
        {isFailed ? (
          <div className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Generation Failed</span>
            </div>
            <p className="leading-relaxed">
              {message.errorMessage || 'An error occurred while generating the response. Please retry.'}
            </p>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                className="mt-1 text-xs"
              >
                Retry
              </Button>
            )}
          </div>
        ) : (
          <div className="text-sm text-primary leading-relaxed break-words space-y-2">
            <MarkdownRenderer
              content={message.content}
              onCitationClick={onCitationClick}
            />
            {isStreaming && (
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-4 bg-brand-primary ml-1 animate-pulse align-middle"
              />
            )}
          </div>
        )}

        {/* Sources & Evidence Ribbon beneath response */}
        {!isFailed && citations.length > 0 && (
          <div className="pt-3 border-t border-subtle/70 mt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-primary" />
              <span>Sources ({citations.length})</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {citations.map((c, cIdx) => {
                const label = c.evidenceId ? `[${c.evidenceId}]` : `[Doc #${cIdx + 1}]`;
                const title = c.source || c.title || 'Document';
                const pageText = c.page ?? c.pageNumber ? ` • p.${c.page ?? c.pageNumber}` : '';

                return (
                  <button
                    key={`cit-btn-${cIdx}-${c.chunkId || c.documentId}`}
                    type="button"
                    onClick={() => onCitationClick?.(c.evidenceId || c.chunkId || c.documentId)}
                    title={`Click to view snippet from ${title}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface hover:bg-brand-primary/10 hover:border-brand-primary/30 border border-subtle transition-all cursor-pointer select-none text-secondary hover:text-primary max-w-[280px] truncate shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 text-brand-primary" />
                    <span className="font-semibold text-brand-primary shrink-0">{label}</span>
                    <span className="truncate">{title}{pageText}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer actions for completed assistant messages */}
        {!isStreaming && !isFailed && (
          <div className="flex items-center justify-between pt-2 text-[11px] text-muted">
            <div className="flex items-center gap-3">
              {message.latencyMs !== undefined && message.latencyMs > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{(message.latencyMs / 1000).toFixed(2)}s</span>
                </span>
              )}
              {message.tokensUsed?.totalTokens !== undefined && (
                <span>{message.tokensUsed.totalTokens.toLocaleString()} tokens</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy response text"
                title="Copy response"
                className="p-1.5 rounded-md hover:bg-surface text-muted hover:text-primary transition-colors flex items-center justify-center min-h-[32px] min-w-[32px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-status-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>

              <FeedbackButtons
                conversationId={message.conversationId}
                messageId={message.id}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
