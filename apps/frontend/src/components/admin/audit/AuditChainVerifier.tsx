'use client';

import React, { useState } from 'react';
import { IAuditVerificationResult } from '@enterprise-ai/shared-types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  useToast,
} from '@/components/ui';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  CheckCircle2,
  AlertOctagon,
  Info,
  Clock,
  Layers,
  FileSearch,
} from 'lucide-react';
import { ApiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface AuditChainVerifierProps {
  onVerificationComplete?: (result: IAuditVerificationResult) => void;
}

export function AuditChainVerifier({ onVerificationComplete }: AuditChainVerifierProps) {
  const toast = useToast();
  const [verification, setVerification] = useState<IAuditVerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const handleVerify = async () => {
    setIsVerifying(true);
    setServiceError(null);

    try {
      const data = await ApiClient.get<IAuditVerificationResult>('/api/v1/admin/audit/verify');
      setVerification(data);
      onVerificationComplete?.(data);

      if (data.status === 'PASS') {
        toast.success(
          data.totalVerified === 0
            ? 'Cryptographic verification complete: Audit chain is empty.'
            : `Verified ${data.totalVerified.toLocaleString()} sequential records with 0 tamper violations.`,
          'Audit Chain Verified'
        );
      } else {
        toast.error(
          `Integrity anomaly detected at sequence #${data.firstInvalidSequence ?? 'unknown'}: ${
            data.error || 'Tamper detected'
          }`,
          'Verification Failed'
        );
      }
    } catch (err: any) {
      const msg = err.message || 'Verification service unavailable or failed to execute.';
      setServiceError(msg);
      toast.error(msg, 'Service Error');
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
                variant={verification.status === 'PASS' ? 'success' : 'error'}
                icon={
                  verification.status === 'PASS' ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertOctagon className="w-3.5 h-3.5" />
                  )
                }
                data-testid="verification-status-badge"
              >
                {verification.status === 'PASS' ? 'STATUS: PASS' : 'STATUS: FAIL'}
              </Badge>
            )}
          </div>
          <CardDescription>
            Recalculates canonical HMAC signatures, monotonically validates sequence continuity, and checks uncompromised previous-hash pointers across all records.
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
        {serviceError && (
          <div
            className="p-3.5 rounded-lg border border-status-error/30 bg-status-error/10 text-status-error text-xs flex items-center justify-between gap-2"
            data-testid="verification-service-error"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                <strong>Verification Service Failure:</strong> {serviceError}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleVerify}
              className="border-status-error/30 text-status-error hover:bg-status-error/10 text-xs h-7"
            >
              Retry
            </Button>
          </div>
        )}

        {verification && (
          <div className="space-y-3" data-testid="verification-results">
            {verification.status === 'PASS' ? (
              <div className="p-4 rounded-xl border border-status-success/30 bg-status-success/10 text-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="font-semibold text-status-success flex items-center gap-1.5 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    Cryptographic Integrity Confirmed (PASS)
                  </span>
                  <span className="text-text-muted font-mono flex items-center gap-1 text-[11px]">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(verification.verifiedAt).toISOString()} (UTC) ·{' '}
                    {new Date(verification.verifiedAt).toLocaleTimeString()}
                  </span>
                </div>

                <p className="text-text-secondary">
                  {verification.totalVerified === 0 ? (
                    'The audit log repository contains zero records. Genesis chain is initialized.'
                  ) : (
                    <>
                      <strong className="text-text-primary">
                        {verification.totalVerified.toLocaleString()}
                      </strong>{' '}
                      audit log records sequentially verified from genesis. Zero HMAC signature
                      mismatches, zero previous-hash breaks, and zero sequence gaps were detected.
                    </>
                  )}
                </p>

                {/* Structured Verification Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-status-success/20 font-mono text-[11px]">
                  <div className="bg-surface/80 p-2 rounded border border-status-success/20">
                    <span className="text-text-muted text-[10px] uppercase block">Checked</span>
                    <span className="font-bold text-text-primary">
                      {verification.totalVerified.toLocaleString()} records
                    </span>
                  </div>
                  <div className="bg-surface/80 p-2 rounded border border-status-success/20">
                    <span className="text-text-muted text-[10px] uppercase block">Bad Signatures</span>
                    <span className="font-bold text-status-success">
                      {verification.invalidSignatureCount}
                    </span>
                  </div>
                  <div className="bg-surface/80 p-2 rounded border border-status-success/20">
                    <span className="text-text-muted text-[10px] uppercase block">Hash Breaks</span>
                    <span className="font-bold text-status-success">
                      {verification.brokenPreviousHashCount}
                    </span>
                  </div>
                  <div className="bg-surface/80 p-2 rounded border border-status-success/20">
                    <span className="text-text-muted text-[10px] uppercase block">Sequence Gaps</span>
                    <span className="font-bold text-status-success">
                      {verification.sequenceGapCount}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-status-error/40 bg-status-error/10 text-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="font-bold text-status-error flex items-center gap-1.5 text-sm">
                    <AlertOctagon className="w-4 h-4" />
                    CRITICAL INTEGRITY VIOLATION DETECTED (FAIL)
                  </span>
                  <span className="text-text-muted font-mono text-[11px]">
                    First Invalid Sequence:{' '}
                    <strong className="text-status-error font-mono">
                      #{verification.firstInvalidSequence ?? 'unknown'}
                    </strong>
                  </span>
                </div>

                <div className="p-2.5 rounded bg-surface border border-status-error/30 font-mono text-status-error">
                  {verification.error || 'HASH_CHAIN_INTEGRITY_FAILURE'}
                </div>

                {/* Structured Verification Failure Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-status-error/20 font-mono text-[11px]">
                  <div className="bg-surface p-2 rounded border border-status-error/20">
                    <span className="text-text-muted text-[10px] uppercase block">Checked</span>
                    <span className="font-bold text-text-primary">
                      {verification.totalVerified.toLocaleString()} records
                    </span>
                  </div>
                  <div className="bg-surface p-2 rounded border border-status-error/20">
                    <span className="text-text-muted text-[10px] uppercase block">Bad Signatures</span>
                    <span
                      className={cn(
                        'font-bold',
                        verification.invalidSignatureCount > 0 ? 'text-status-error' : 'text-text-primary'
                      )}
                    >
                      {verification.invalidSignatureCount}
                    </span>
                  </div>
                  <div className="bg-surface p-2 rounded border border-status-error/20">
                    <span className="text-text-muted text-[10px] uppercase block">Hash Breaks</span>
                    <span
                      className={cn(
                        'font-bold',
                        verification.brokenPreviousHashCount > 0 ? 'text-status-error' : 'text-text-primary'
                      )}
                    >
                      {verification.brokenPreviousHashCount}
                    </span>
                  </div>
                  <div className="bg-surface p-2 rounded border border-status-error/20">
                    <span className="text-text-muted text-[10px] uppercase block">Sequence Gaps</span>
                    <span
                      className={cn(
                        'font-bold',
                        verification.sequenceGapCount > 0 ? 'text-status-error' : 'text-text-primary'
                      )}
                    >
                      {verification.sequenceGapCount}
                    </span>
                  </div>
                </div>

                {verification.details && (
                  <pre className="p-2.5 rounded bg-surface border border-border-subtle font-mono text-[11px] text-text-secondary overflow-x-auto max-h-40">
                    {JSON.stringify(verification.details, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Read-Only Architecture Notice */}
            <div className="p-3 rounded-lg border border-border-subtle bg-surface-elevated/40 text-[11px] text-text-muted flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 text-text-muted mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-medium text-text-secondary">Read-Only Recalculation Notice:</span>
                <p>
                  Verification recalculates canonical HMAC hashes in-memory without rewriting or mutating records. A passing hash chain confirms append-only cryptographic continuity and detects retroactive tampering, but does not substitute for offsite cryptographic backup and access containment.
                </p>
              </div>
            </div>
          </div>
        )}

        {!verification && !isVerifying && !serviceError && (
          <div className="p-4 rounded-xl border border-dashed border-border-subtle bg-surface-elevated/20 text-xs text-text-muted text-center flex items-center justify-center gap-2">
            <FileSearch className="w-4 h-4 text-brand-primary" />
            <span>
              Click <strong>Verify Audit Chain</strong> above to trigger read-only canonical hash verification and confirm monotonic sequence continuity.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
