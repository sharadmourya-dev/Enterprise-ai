'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  preventClose?: boolean;
  className?: string;
  bodyClassName?: string;
}

// Global modal count to manage body scroll locking safely across stacked or rapid modals
let openModalCount = 0;
let previousBodyOverflow = '';

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  preventClose = false,
  className,
  bodyClassName,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus preservation: save trigger element on open and restore on close
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null;
      // Focus the modal content for screen readers / keyboard navigation
      setTimeout(() => {
        contentRef.current?.focus?.();
      }, 50);
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus?.();
      previousActiveElement.current = null;
    }
  }, [isOpen]);

  // Close on Escape key press (unless preventClose is active)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape && !preventClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, preventClose, onClose]);

  // Lock background scroll when open and safely restore previous overflow
  useEffect(() => {
    if (isOpen) {
      if (openModalCount === 0) {
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
      openModalCount++;
    }

    return () => {
      if (isOpen) {
        openModalCount = Math.max(0, openModalCount - 1);
        if (openModalCount === 0) {
          document.body.style.overflow = previousBodyOverflow || 'unset';
        }
      }
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-5xl',
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdropClick && !preventClose && e.target === overlayRef.current) {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto bg-black/60 backdrop-blur-xs animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-describedby={description ? 'modal-description' : undefined}
      data-testid="modal-overlay"
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          'relative w-full my-auto flex flex-col rounded-2xl bg-surface border border-subtle shadow-2xl overflow-hidden',
          'max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3.5rem)] animate-slide-down focus:outline-none',
          sizes[size],
          className
        )}
      >
        {/* Pinned Header */}
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between p-5 md:p-6 pb-4 border-b border-subtle shrink-0 bg-surface z-10">
            <div>
              {title && (
                <h2 id="modal-title" className="text-lg font-semibold tracking-tight text-primary">
                  {title}
                </h2>
              )}
              {description && (
                <p id="modal-description" className="mt-1 text-sm text-secondary">
                  {description}
                </p>
              )}
            </div>

            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                disabled={preventClose}
                aria-label="Close dialog"
                className="p-2 -mr-2 rounded-lg text-muted hover:text-primary hover:bg-surface-elevated transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Independently Scrollable Body */}
        <div
          data-testid="modal-body"
          className={cn(
            'p-5 md:p-6 overflow-y-auto flex-1 min-h-0 focus:outline-none overscroll-contain',
            bodyClassName
          )}
        >
          {children}
        </div>

        {/* Optional Direct Pinned Footer */}
        {footer && (
          <div
            data-testid="modal-pinned-footer"
            className="p-4 px-5 md:px-6 bg-surface-elevated border-t border-subtle flex items-center justify-end gap-3 shrink-0 z-10"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export function ModalFooter({
  children,
  className,
  sticky = true,
}: {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      data-testid="modal-footer"
      className={cn(
        'mt-6 -mx-5 -mb-5 md:-mx-6 md:-mb-6 p-4 px-5 md:px-6 bg-surface-elevated border-t border-subtle flex items-center justify-end gap-3',
        sticky &&
          'sticky bottom-0 z-10 bg-surface-elevated shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)]',
        className
      )}
    >
      {children}
    </div>
  );
}

