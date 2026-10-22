'use client';

import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react';
import { FeedbackRating, FeedbackCategory } from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import { Modal, Button, Textarea, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface FeedbackButtonsProps {
  conversationId: string;
  messageId: string;
  initialRating?: FeedbackRating | null;
  className?: string;
}

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: FeedbackCategory.HALLUCINATION, label: 'Hallucination / Factually Incorrect' },
  { value: FeedbackCategory.MISSING_INFORMATION, label: 'Missing Crucial Information' },
  { value: FeedbackCategory.IRRELEVANT_CONTEXT, label: 'Irrelevant Context' },
  { value: FeedbackCategory.OUTDATED, label: 'Outdated Information' },
  { value: FeedbackCategory.OTHER, label: 'Other Issue' },
];

export function FeedbackButtons({
  conversationId,
  messageId,
  initialRating,
  className,
}: FeedbackButtonsProps) {
  const [currentRating, setCurrentRating] = useState<FeedbackRating | null>(initialRating || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<FeedbackCategory>(
    FeedbackCategory.HALLUCINATION
  );
  const [comment, setComment] = useState('');
  const { success, error: showError } = useToast();

  const submitFeedback = async (
    rating: FeedbackRating,
    category?: FeedbackCategory,
    userComment?: string
  ) => {
    setIsSubmitting(true);
    try {
      await ApiClient.post('/api/v1/feedback', {
        conversationId,
        messageId,
        rating,
        category: category || (rating === FeedbackRating.THUMBS_UP ? FeedbackCategory.ACCURATE_HELPFUL : FeedbackCategory.OTHER),
        userComment: userComment ? userComment.trim().slice(0, 1000) : undefined,
      });

      setCurrentRating(rating);
      setModalOpen(false);
      success(
        rating === FeedbackRating.THUMBS_UP
          ? 'Thank you for your positive feedback!'
          : 'Thank you for helping improve the Copilot.',
        'Feedback Submitted'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit feedback';
      showError(msg, 'Feedback Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleThumbsUp = async () => {
    if (currentRating || isSubmitting) return;
    await submitFeedback(FeedbackRating.THUMBS_UP, FeedbackCategory.ACCURATE_HELPFUL);
  };

  const handleThumbsDown = () => {
    if (currentRating || isSubmitting) return;
    setModalOpen(true);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitFeedback(FeedbackRating.THUMBS_DOWN, selectedCategory, comment);
  };

  return (
    <>
      <div className={cn('flex items-center gap-1', className)}>
        <button
          type="button"
          onClick={handleThumbsUp}
          disabled={Boolean(currentRating) || isSubmitting}
          aria-label="Submit positive feedback"
          title="Helpful response"
          className={cn(
            'p-1.5 rounded-md text-xs transition-colors flex items-center justify-center min-h-[32px] min-w-[32px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed',
            currentRating === FeedbackRating.THUMBS_UP
              ? 'bg-status-success/15 text-status-success font-semibold'
              : 'text-muted hover:text-primary hover:bg-surface-elevated'
          )}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleThumbsDown}
          disabled={Boolean(currentRating) || isSubmitting}
          aria-label="Submit negative feedback"
          title="Report issue with response"
          className={cn(
            'p-1.5 rounded-md text-xs transition-colors flex items-center justify-center min-h-[32px] min-w-[32px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed',
            currentRating === FeedbackRating.THUMBS_DOWN
              ? 'bg-status-error/15 text-status-error font-semibold'
              : 'text-muted hover:text-primary hover:bg-surface-elevated'
          )}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Negative Feedback Category Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Report an Issue with this Answer"
        description="Your feedback directly guides response grounding and retrieval quality."
      >
        <form onSubmit={handleModalSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              Select Feedback Reason
            </label>
            <div className="space-y-1.5">
              {CATEGORY_OPTIONS.map((cat) => (
                <label
                  key={cat.value}
                  className={cn(
                    'flex items-center gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors select-none',
                    selectedCategory === cat.value
                      ? 'border-brand-primary bg-brand-primary/5 text-primary font-medium'
                      : 'border-subtle bg-surface text-secondary hover:bg-surface-elevated'
                  )}
                >
                  <input
                    type="radio"
                    name="feedback-category"
                    value={cat.value}
                    checked={selectedCategory === cat.value}
                    onChange={() => setSelectedCategory(cat.value)}
                    className="accent-brand-primary h-3.5 w-3.5"
                  />
                  <span>{cat.label}</span>
                </label>
              ))}
            </div>
          </div>

          <Textarea
            label="Additional Context (Optional)"
            placeholder="Tell us what was incorrect or missing in the response..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            helperText={`${comment.length}/1000 characters`}
          />

          <div className="flex justify-end gap-2.5 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
            >
              Submit Feedback
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
