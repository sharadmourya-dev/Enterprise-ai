'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'default'
  | 'brand'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'outline';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'sm', icon, children, ...props }, ref) => {
    const variants: Record<BadgeVariant, string> = {
      default: 'bg-surface-elevated text-secondary border-subtle',
      brand: 'bg-brand-primary/10 text-brand-primary border-brand-primary/25',
      accent: 'bg-brand-accent/10 text-brand-accent border-brand-accent/25',
      success: 'bg-status-success/10 text-status-success border-status-success/25',
      warning: 'bg-status-warning/10 text-status-warning border-status-warning/25',
      error: 'bg-status-error/10 text-status-error border-status-error/25',
      info: 'bg-status-info/10 text-status-info border-status-info/25',
      outline: 'bg-transparent text-primary border-subtle',
    };

    const sizes: Record<BadgeSize, string> = {
      sm: 'text-[11px] px-2 py-0.5 gap-1',
      md: 'text-xs px-2.5 py-1 gap-1.5',
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center font-medium rounded-full border tracking-wide select-none transition-colors duration-150',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span>{children}</span>
      </span>
    );
  }
);

Badge.displayName = 'Badge';
