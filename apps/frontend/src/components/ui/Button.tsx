'use client';

import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:active:scale-100';

    const variants: Record<ButtonVariant, string> = {
      primary:
        'bg-brand-primary text-white hover:bg-brand-hover shadow-sm border border-transparent',
      secondary:
        'bg-surface-elevated text-primary border border-subtle hover:bg-surface hover:border-strong shadow-xs',
      outline:
        'bg-transparent border border-subtle text-primary hover:bg-surface-elevated hover:border-strong',
      ghost:
        'bg-transparent text-secondary hover:text-primary hover:bg-surface-elevated border border-transparent',
      danger:
        'bg-status-error text-white hover:opacity-95 shadow-sm border border-transparent',
    };

    const sizes: Record<ButtonSize, string> = {
      sm: 'h-9 px-3 text-xs gap-1.5 rounded-md min-h-[36px]',
      md: 'h-11 px-4 text-sm gap-2 rounded-lg min-h-[44px]',
      lg: 'h-12 px-6 text-base gap-2.5 rounded-lg min-h-[48px]',
      icon: 'h-11 w-11 p-0 rounded-lg min-h-[44px] min-w-[44px]',
    };

    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-current shrink-0" aria-hidden="true" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
