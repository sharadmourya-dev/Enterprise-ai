'use client';

import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, Theme } from './ThemeProvider';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
  variant?: 'segmented' | 'dropdown' | 'cycle';
}

export function ThemeToggle({ className, variant = 'segmented' }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  if (variant === 'cycle') {
    const handleCycle = () => {
      if (theme === 'system') setTheme('light');
      else if (theme === 'light') setTheme('dark');
      else setTheme('system');
    };

    return (
      <button
        type="button"
        onClick={handleCycle}
        aria-label={`Current theme: ${theme}. Click to switch theme.`}
        className={cn(
          'inline-flex items-center justify-center w-11 h-11 rounded-lg border border-subtle bg-surface text-secondary hover:text-primary hover:bg-surface-elevated transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary active:scale-[0.98]',
          className
        )}
      >
        {resolvedTheme === 'dark' ? (
          <Moon className="w-5 h-5 text-brand-primary transition-transform" />
        ) : (
          <Sun className="w-5 h-5 text-amber-500 transition-transform" />
        )}
      </button>
    );
  }

  // Segmented control layout
  const options: { value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div
      role="group"
      aria-label="Theme selection"
      className={cn(
        'inline-flex items-center p-1 rounded-lg border border-subtle bg-surface-elevated shadow-sm',
        className
      )}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={isActive}
            aria-label={`${label} theme`}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 min-h-[36px] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
              isActive
                ? 'bg-surface text-primary shadow-sm border border-subtle'
                : 'text-muted hover:text-secondary hover:bg-surface/50'
            )}
          >
            <Icon className={cn('w-3.5 h-3.5', isActive && value === 'dark' && 'text-brand-primary', isActive && value === 'light' && 'text-amber-500')} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
