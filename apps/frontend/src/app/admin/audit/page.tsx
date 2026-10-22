'use client';

import React from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuditDashboard } from '@/components/admin';

export default function AdminAuditPage() {
  return (
    <AppShell adminOnly>
      <AuditDashboard />
    </AppShell>
  );
}
