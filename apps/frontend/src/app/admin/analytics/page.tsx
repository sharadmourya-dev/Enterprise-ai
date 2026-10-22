'use client';

import React from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AnalyticsDashboard } from '@/components/admin';

export default function AdminAnalyticsPage() {
  return (
    <AppShell adminOnly>
      <AnalyticsDashboard />
    </AppShell>
  );
}
