'use client';

import React, { useState } from 'react';
import { AuditChainVerifier } from './AuditChainVerifier';
import { AuditLogTable } from './AuditLogTable';
import { Badge } from '@/components/ui';
import { ShieldCheck } from 'lucide-react';

export function AuditDashboard() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border-subtle">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">
              Cryptographic Audit Inspector &amp; Compliance Logs
            </h1>
            <Badge variant="brand" className="text-xs">
              HMAC-SHA256 Chained
            </Badge>
          </div>
          <p className="text-sm text-text-secondary">
            Continuous sequence verification, cryptographic hash chain continuity, and immutable event reporting
          </p>
        </div>
      </div>

      {/* One-Click Cryptographic Verification */}
      <AuditChainVerifier onVerificationComplete={() => setRefreshTrigger((prev) => prev + 1)} />

      {/* Immutable Audit Log Table & Filters */}
      <AuditLogTable externalRefreshKey={refreshTrigger} />
    </div>
  );
}
