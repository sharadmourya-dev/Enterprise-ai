'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  FileText,
  BarChart3,
  ShieldCheck,
  LayoutDashboard,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  adminOnly?: boolean;
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  {
    label: 'Overview',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    label: 'Copilot Chat',
    href: '/chat',
    icon: MessageSquare,
  },
  {
    label: 'Document Repository',
    href: '/documents',
    icon: FileText,
  },
];

export const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    label: 'Analytics & Trends',
    href: '/admin/analytics',
    icon: BarChart3,
    adminOnly: true,
  },
  {
    label: 'Audit Log Inspector',
    href: '/admin/audit',
    icon: ShieldCheck,
    adminOnly: true,
  },
];

export interface SidebarNavProps {
  onNavigate?: () => void;
  className?: string;
}

export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  const isLinkActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderNavList = (items: NavItem[]) => (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isLinkActive(item.href);
        const Icon = item.icon;

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 min-h-[44px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                active
                  ? 'bg-brand-primary/10 text-brand-primary font-semibold shadow-xs'
                  : 'text-secondary hover:text-primary hover:bg-surface-elevated'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={cn(
                    'w-5 h-5 shrink-0 transition-colors',
                    active ? 'text-brand-primary' : 'text-muted group-hover:text-primary'
                  )}
                />
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge && (
                <Badge variant={active ? 'brand' : 'default'} size="sm">
                  {item.badge}
                </Badge>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label="Sidebar Navigation" className={cn('space-y-6', className)}>
      {/* Primary Application Links */}
      <div>
        <div className="px-3.5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Workspace
        </div>
        {renderNavList(MAIN_NAV_ITEMS)}
      </div>

      {/* Administrative Links - Strictly visible to Role.ADMIN or Role.SUPER_ADMIN */}
      {isAdmin && (
        <div>
          <div className="px-3.5 mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>Administration</span>
            <Badge variant="brand" size="sm">
              Privileged
            </Badge>
          </div>
          {renderNavList(ADMIN_NAV_ITEMS)}
        </div>
      )}
    </nav>
  );
}
