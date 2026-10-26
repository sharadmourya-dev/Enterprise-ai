'use client';

import React from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { UserManagementDashboard } from '@/components/admin';

export default function AdminUsersPage() {
  return (
    <AppShell adminOnly>
      <UserManagementDashboard />
    </AppShell>
  );
}
