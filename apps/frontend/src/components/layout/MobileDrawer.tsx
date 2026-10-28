'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, ShieldCheck, LogOut, User } from 'lucide-react';
import { SidebarNav } from './SidebarNav';
import { useAuth } from '@/context/AuthContext';
import { Button, Badge, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const pathname = usePathname();
  const { user, role, clearance, logout } = useAuth();
  const { info } = useToast();
  const drawerRef = useRef<HTMLDivElement>(null);

  const prevPathname = useRef(pathname);

  // Close drawer automatically on route navigation
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      onClose();
    }
  }, [pathname, onClose]);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock background scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogout = async () => {
    onClose();
    await logout();
    info('Logged out safely', 'Session Ended');
  };

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile Navigation Drawer"
    >
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-200 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed inset-y-0 left-0 w-[280px] max-w-[calc(100vw-40px)] bg-surface border-r border-subtle shadow-xl',
          'flex flex-col justify-between overflow-y-auto animate-slide-up duration-200 z-50'
        )}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center text-white shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm tracking-tight text-primary">Enterprise AI</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close mobile navigation drawer"
            className="p-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-elevated transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body - Navigation Links */}
        <div className="flex-1 p-4 overflow-y-auto">
          <SidebarNav onNavigate={onClose} />
        </div>

        {/* Drawer Footer - User identity & logout */}
        {user && (
          <div className="p-4 border-t border-subtle bg-surface-elevated space-y-3">
            <Link
              href="/profile"
              onClick={onClose}
              className="flex items-center gap-2.5 p-1.5 -m-1.5 rounded-lg hover:bg-surface transition-colors"
              title="View User Profile & Security Clearance"
            >
              <div className="w-8 h-8 rounded-full bg-surface border border-subtle flex items-center justify-center text-secondary shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-primary truncate">{user.name}</p>
                <p className="text-[11px] text-muted truncate">{user.email}</p>
              </div>
            </Link>

            <div className="flex items-center gap-2 flex-wrap">
              {role && (
                <Badge variant="default" size="sm">
                  {role}
                </Badge>
              )}
              {clearance && (
                <Badge variant="info" size="sm">
                  {clearance}
                </Badge>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-secondary hover:text-status-error min-h-[44px]"
              leftIcon={<LogOut className="w-4 h-4" />}
              onClick={handleLogout}
            >
              Sign Out
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
