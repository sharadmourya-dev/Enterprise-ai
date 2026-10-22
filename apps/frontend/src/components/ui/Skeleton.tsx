'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
}

export function Skeleton({ className, variant = 'rectangular', ...props }: SkeletonProps) {
  const variants = {
    text: 'h-4 w-full rounded-md',
    circular: 'rounded-full aspect-square',
    rectangular: 'rounded-lg w-full',
  };

  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-surface-elevated border border-subtle/50',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
