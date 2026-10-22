'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, User, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { SidebarNav } from './SidebarNav';
import { TopNavbar } from './TopNavbar';
import { MobileDrawer } from './MobileDrawer';
import { Button, Badge, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  requiredRoles?: Role[];
  requiredClearance?: ClearanceLevel;
  className?: string;
}

export function AppShell({
  children,
  adminOnly = false,
  requiredRoles,
  requiredClearance,
  className,
}: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { user, role, clearance, isAdmin, logout } = useAuth();
  const { info } = useToast();

  const handleOpenMobileDrawer = React.useCallback(() => {
    setMobileDrawerOpen(true);
  }, []);

  const handleCloseMobileDrawer = React.useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

  const handleLogout = async () => {
    await logout();
    info('Logged out safely', 'Session Ended');
  };

  return (
    <ProtectedRoute
      adminOnly={adminOnly}
      requiredRoles={requiredRoles}
      requiredClearance={requiredClearance}
    >
      <div className="min-h-screen flex bg-canvas text-primary relative">
        {/* Skip to Main Content Link for Keyboard / Screen Reader Accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 z-50 px-4 py-2 rounded-lg bg-brand-primary text-white text-xs font-semibold shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-primary"
        >
          Skip to main content
        </a>

        {/* Desktop Fixed Sidebar (visible >= 1024px) */}
        <aside
          aria-label="Desktop Application Sidebar"
          className="hidden lg:flex w-64 flex-col border-r border-subtle bg-surface shrink-0 h-screen sticky top-0 select-none"
        >
          {/* Sidebar Header with Brand Identity */}
          <div className="h-16 px-5 border-b border-subtle flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center text-white shadow-xs shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="font-bold text-sm tracking-tight text-primary block leading-tight">
                Enterprise AI
              </span>
              <span className="text-[11px] text-muted block leading-none">Knowledge Copilot</span>
            </div>
          </div>

          {/* Navigation Items */}
          <div className="flex-1 p-4 overflow-y-auto">
            <SidebarNav />
          </div>

          {/* Sidebar Footer with Authenticated Profile Card */}
          {user && (
            <div className="p-4 border-t border-subtle bg-surface-elevated/60 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-surface border border-subtle flex items-center justify-center text-secondary shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-primary truncate leading-tight">
                    {user.name}
                  </p>
                  <p className="text-[11px] text-muted truncate leading-none mt-0.5">
                    {user.department}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {role && (
                  <Badge variant={isAdmin ? 'brand' : 'default'} size="sm">
                    {role}
                  </Badge>
                )}
                {clearance && (
                  <Badge variant="info" size="sm">
                    {clearance}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Mobile Slide-Over Drawer (< 1024px) */}
        <MobileDrawer
          isOpen={mobileDrawerOpen}
          onClose={handleCloseMobileDrawer}
        />

        {/* Main Content Area with Top Navigation Bar */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <TopNavbar onOpenMobileMenu={handleOpenMobileDrawer} />

          <main
            id="main-content"
            tabIndex={-1}
            className={cn('flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto outline-none', className)}
          >
            {children}
          </main>

          <footer className="border-t border-subtle py-4 px-6 text-center text-xs text-muted">
            Enterprise AI Knowledge &amp; Support Copilot &bull; Authenticated Workspace
          </footer>
        </div>
      </div>
    </ProtectedRoute>
  );
}
