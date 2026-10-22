'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, useToast } from '@/components/ui';
import { ShieldCheck, ShieldAlert, RefreshCw, KeyRound, CheckCircle2, AlertOctagon, Info } from 'lucide-react';
import { ApiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface AuditVerificationData {
  isValid: boolean;
  totalVerified: number;
  error?: string | null;
  atSequence?: number | null;
  details?: Record<string, unknown> | null;
  verifiedAt: string;
  processIsolationNotice: string;
}

export function AuditChainVerifier() {
  const toast = useToast();
  const [verification, setVerification] = useState<AuditVerificationData | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleVerify = async () => {
    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const data = await ApiClient.get<AuditVerificationData>('/api/v1/admin/audit/verify');
      setVerification(data);
      if (data.isValid) {
        toast.success(
          `Successfully verified ${data.totalVerified} audit log entries with zero tampering detected.`,
          'Audit Chain Verified'
        );
      } else {
        toast.error(
          `Audit chain verification failure at sequence #${data.atSequence || 'unknown'}: ${
            data.error || 'Tamper detected'
          }`,
          'Tamper Detected'
        );
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to execute cryptographic audit chain verification';
      setErrorMessage(msg);
      toast.error(msg, 'Verification Error');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Card variant="default" className="p-6 space-y-4 border-brand-primary/20 bg-surface">
      <CardHeader className="p-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="w-5 h-5 text-brand-primary" />
              Cryptographic HMAC-SHA256 Audit Chain Verification
            </CardTitle>
            {verification && (
              <Badge
                variant={verification.isValid ? 'success' : 'error'}
                icon={verification.isValid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertOctagon className="w-3.5 h-3.5" />}
              >
                {verification.isValid ? 'Chain Intact & Valid' : 'Tamper Detected'}
              </Badge>
            )}
          </div>
          <CardDescription>
            Validates monotonic sequence numbering, uncompromised previousHash pointers, and HMAC-SHA256 signatures across the immutable audit log.
          </CardDescription>
        </div>

        <Button
          variant="primary"
          onClick={handleVerify}
          isLoading={isVerifying}
          leftIcon={<ShieldCheck className="w-4 h-4" />}
          className="shrink-0"
          data-testid="verify-chain-button"
        >
          {verification ? 'Re-Verify Chain' : 'Verify Audit Chain'}
        </Button>
      </CardHeader>

      <CardContent className="p-0 space-y-3">
        {errorMessage && (
          <div className="p-3 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {verification && (
          <div className="space-y-3">
            {verification.isValid ? (
              <div className="p-4 rounded-xl border border-status-success/30 bg-status-success/10 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-status-success flex items-center gap-1.5 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    Cryptographic Integrity Confirmed
                  </span>
                  <span className="text-text-muted font-mono">
                    Verified: {new Date(verification.verifiedAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-text-secondary">
                  <strong className="text-text-primary">{verification.totalVerified.toLocaleString()}</strong> sequential
                  audit log records were verified from genesis block. Zero hash breaks, sequence gaps, or payload
                  modifications were detected.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-status-error/40 bg-status-error/10 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-status-error flex items-center gap-1.5 text-sm">
                    <AlertOctagon className="w-4 h-4" />
                    CRITICAL INTEGRITY VIOLATION DETECTED
                  </span>
                  <span className="text-text-muted font-mono">
                    {`Sequence #${verification.atSequence ?? 'unknown'}`}
                  </span>
                </div>
                <p className="font-mono text-status-error bg-surface p-2 rounded border border-status-error/30">
                  {verification.error || 'TAMPER_DETECTED'}
                </p>
                {verification.details && (
                  <pre className="p-2 rounded bg-surface border border-border-subtle font-mono text-[11px] text-text-secondary overflow-x-auto">
                    {JSON.stringify(verification.details, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Architecture notice */}
            {verification.processIsolationNotice && (
              <div className="p-3 rounded-lg border border-border-subtle bg-surface-elevated/40 text-[11px] text-text-muted flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 text-text-muted mt-0.5" />
                <span>{verification.processIsolationNotice}</span>
              </div>
            )}
          </div>
        )}

        {!verification && !isVerifying && !errorMessage && (
          <div className="p-4 rounded-xl border border-dashed border-border-subtle bg-surface-elevated/20 text-xs text-text-muted text-center">
            Click <strong>Verify Audit Chain</strong> above to recalculate cryptographic hashes across all historical records and confirm continuous integrity.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
