'use client';

import React from 'react';
import Link from 'next/link';
import { Menu, LogOut, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ClearanceLevel } from '@enterprise-ai/shared-types';
import { Button, Badge, useToast } from '@/components/ui';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { cn } from '@/lib/utils';

export interface TopNavbarProps {
  onOpenMobileMenu?: () => void;
  className?: string;
}

export function TopNavbar({ onOpenMobileMenu, className }: TopNavbarProps) {
  const { user, role, clearance, isAdmin, logout } = useAuth();
  const { info } = useToast();

  const handleLogout = async () => {
    await logout();
    info('You have been logged out safely', 'Session Ended');
  };

  const getClearanceBadgeVariant = (level?: ClearanceLevel | null) => {
    switch (level) {
      case ClearanceLevel.RESTRICTED:
        return 'error';
      case ClearanceLevel.CONFIDENTIAL:
        return 'info';
      case ClearanceLevel.INTERNAL:
        return 'default';
      case ClearanceLevel.PUBLIC:
        return 'outline';
      default:
        return 'default';
    }
  };

  return (
    <header
      className={cn(
        'h-16 px-4 md:px-6 border-b border-subtle bg-surface/95 backdrop-blur-xs sticky top-0 z-30 flex items-center justify-between gap-4',
        className
      )}
    >
      {/* Left section: Mobile menu trigger & Brand */}
      <div className="flex items-center gap-3">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open mobile navigation menu"
            className="lg:hidden p-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-elevated transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <Link
          href="/"
          className="lg:hidden flex items-center gap-2 text-primary hover:opacity-90 transition-opacity"
        >
          <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center text-white shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm tracking-tight hidden sm:inline">Enterprise AI</span>
        </Link>
      </div>

      {/* Right section: User claims, Clearance badge, Theme toggle, and Logout */}
      <div className="flex items-center gap-2 sm:gap-3">
        {user && (
          <div className="hidden sm:flex items-center gap-2.5 px-3 py-1 rounded-lg border border-subtle bg-surface-elevated">
            <User className="w-4 h-4 text-muted shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-primary block leading-tight truncate max-w-[140px]">
                {user.name}
              </span>
              <span className="text-[11px] text-muted block leading-none truncate max-w-[140px]">
                {user.department}
              </span>
            </div>

            {/* Clearance badge */}
            {clearance && (
              <Badge variant={getClearanceBadgeVariant(clearance)} size="sm">
                {clearance.toUpperCase()}
              </Badge>
            )}

            {/* Role badge */}
            {role && (
              <Badge variant={isAdmin ? 'brand' : 'default'} size="sm">
                {role}
              </Badge>
            )}
          </div>
        )}

        {/* Theme toggle */}
        <ThemeToggle variant="cycle" />

        {/* Logout trigger */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          aria-label="Sign out of account"
          leftIcon={<LogOut className="w-4 h-4" />}
          className="text-secondary hover:text-status-error min-h-[44px]"
        >
          <span className="hidden md:inline">Sign Out</span>
        </Button>
      </div>
    </header>
  );
}
