'use client';

import React, { forwardRef, useId, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      helperText,
      error,
      id,
      disabled,
      required,
      autoResize = false,
      rows = 3,
      value,
      onChange,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const textareaId = id || generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    const internalRef = useRef<HTMLTextAreaElement | null>(null);

    // Auto-resize logic
    useEffect(() => {
      if (!autoResize) return;
      const target = internalRef.current;
      if (!target) return;

      target.style.height = 'auto';
      target.style.height = `${Math.max(target.scrollHeight, 44)}px`;
    }, [value, autoResize]);

    const handleCombinedRef = (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.max(e.target.scrollHeight, 44)}px`;
      }
      onChange?.(e);
    };

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold uppercase tracking-wider text-secondary"
          >
            {label}
            {required && <span className="text-status-error ml-1">*</span>}
          </label>
        )}

        <textarea
          ref={handleCombinedRef}
          id={textareaId}
          rows={rows}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            'w-full px-3.5 py-2.5 rounded-lg border bg-surface text-primary text-sm placeholder:text-muted transition-colors duration-150',
            'focus:outline-none focus:ring-2 resize-y',
            error
              ? 'border-status-error focus:border-status-error focus:ring-status-error/25'
              : 'border-subtle hover:border-strong focus:border-brand-primary focus:ring-brand-primary/25',
            disabled && 'opacity-50 cursor-not-allowed bg-surface-elevated',
            autoResize && 'resize-none overflow-hidden',
            className
          )}
          {...props}
        />

        {error ? (
          <p id={errorId} role="alert" className="text-xs text-status-error font-medium">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-muted">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
