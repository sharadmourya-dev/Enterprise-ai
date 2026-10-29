import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  AuditAction,
  AuditResourceType,
  IAuditVerificationResult,
  IAuditSummary,
} from '@enterprise-ai/shared-types';
import { AuditLogModel, AuditCounterModel, AuditChainHeadModel, IAuditLogEntity } from '../models/AuditLog.model.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface ILogAuditParams {
  userId?: string | mongoose.Types.ObjectId | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'denied' | 'error';
  details?: Record<string, unknown>;
  timestamp?: Date;
}

export class AuditService {
  public static readonly CHAIN_HEAD_ID = 'audit_chain_master_head';
  public static readonly GENESIS_HASH = 'GENESIS_HASH_INITIAL_LOG';
  public static readonly MAX_TRANSACTION_RETRIES = 10;

  // Process-local serialization queue to optimize throughput and minimize write conflicts
  private static writeLock: Promise<void> = Promise.resolve();

  /**
   * Constructs the canonical payload string used for HMAC signing
   */
  public static computePayloadToSign(
    previousHash: string,
    sequenceNumber: number,
    action: string,
    resourceType: string,
    resourceId: string,
    status: string,
    isoTimestamp: string
  ): string {
    return `${previousHash}|${sequenceNumber}|${action}|${resourceType}|${resourceId}|${status}|${isoTimestamp}`;
  }

  /**
   * Computes the SHA-256 HMAC of an audit log entry
   */
  public static computeHmac(payload: string, secret = env.AUDIT_LOG_HMAC_SECRET): string {
    if (!secret || secret.length < 16) {
      throw new Error('AUDIT_LOG_HMAC_SECRET is invalid or missing');
    }
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Performs an authoritative transactional write on the shared AuditChainHead and AuditLog collections.
   * Runs inside an ACID MongoDB transaction with bounded retries for write conflicts and transient errors.
   */
  public static async executeTransactionalWrite(
    params: ILogAuditParams,
    maxRetries = AuditService.MAX_TRANSACTION_RETRIES
  ): Promise<IAuditLogEntity | null> {
    const logDate = params.timestamp || new Date();
    const isoTimestamp = logDate.toISOString();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let session: mongoose.ClientSession | null = null;
      try {
        session = await mongoose.startSession();
        session.startTransaction({
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority' },
        });

        // 1. Fetch or initialize the authoritative chain head document
        let head = await AuditChainHeadModel.findOne({ _id: AuditService.CHAIN_HEAD_ID }).session(session);

        if (!head) {
          // First-time initialization: check if existing historical logs exist to preserve chain continuity
          const historicalLogs = await AuditLogModel.find().sort({ sequenceNumber: 1 }).session(session).lean();

          let initialSeq = 0;
          let initialHash = AuditService.GENESIS_HASH;

          if (historicalLogs.length > 0) {
            // Validate the complete historical chain before establishing the chain head
            const verification = this.verifyRecordList(historicalLogs);
            if (!verification.isValid) {
              logger.error('CRITICAL: Historical audit log verification failed during chain head initialization', {
                error: verification.error,
                atSequence: verification.atSequence,
                totalVerified: verification.totalVerified,
              });
              const errorMsg = `HISTORICAL_AUDIT_CHAIN_CORRUPTED: Cannot initialize audit chain head. Historical integrity verification failed at sequence ${verification.atSequence}: ${verification.error}`;
              const corruptionErr = new Error(errorMsg);
              (corruptionErr as any).isFatalCorruption = true;
              throw corruptionErr;
            }

            const latestLog = historicalLogs[historicalLogs.length - 1];
            initialSeq = latestLog.sequenceNumber;
            initialHash = latestLog.tamperHash;
          }

          try {
            const created = await AuditChainHeadModel.create(
              [
                {
                  _id: AuditService.CHAIN_HEAD_ID,
                  sequenceNumber: initialSeq,
                  lastHash: initialHash,
                },
              ],
              { session }
            );
            head = created[0];
          } catch (initErr: any) {
            if (initErr.code === 11000) {
              head = await AuditChainHeadModel.findOne({ _id: AuditService.CHAIN_HEAD_ID }).session(session);
            } else {
              throw initErr;
            }
          }
        }

        if (!head) {
          throw new Error('Failed to acquire audit chain head document');
        }

        const currentSeq = head.sequenceNumber;
        const previousHash = head.lastHash;
        const nextSeq = currentSeq + 1;

        // 2. Compute canonical payload and HMAC
        const payloadToSign = this.computePayloadToSign(
          previousHash,
          nextSeq,
          params.action,
          params.resourceType,
          params.resourceId,
          params.status,
          isoTimestamp
        );

        const tamperHash = this.computeHmac(payloadToSign);

        // 3. Atomically update the chain head document with sequence compare-and-set
        const updatedHead = await AuditChainHeadModel.findOneAndUpdate(
          { _id: AuditService.CHAIN_HEAD_ID, sequenceNumber: currentSeq },
          {
            $set: {
              sequenceNumber: nextSeq,
              lastHash: tamperHash,
            },
          },
          { new: true, session }
        );

        if (!updatedHead) {
          // Concurrency conflict: another transaction updated the chain head first
          const conflictErr = new Error('WriteConflict: AuditChainHead sequence updated concurrently');
          (conflictErr as any).code = 112;
          throw conflictErr;
        }

        // Keep legacy AuditCounterModel in sync for backward compatibility
        await AuditCounterModel.updateOne(
          { _id: 'audit_log_master_sequence' },
          { $set: { seq: nextSeq } },
          { upsert: true, session }
        );

        // 4. Create the audit log record within the same transaction
        const [record] = await AuditLogModel.create(
          [
            {
              sequenceNumber: nextSeq,
              previousHash,
              userId: params.userId ? new mongoose.Types.ObjectId(params.userId.toString()) : null,
              action: params.action,
              resourceType: params.resourceType,
              resourceId: params.resourceId,
              ipAddress: params.ipAddress || 'unknown',
              userAgent: params.userAgent || 'unknown',
              status: params.status,
              details: params.details || {},
              tamperHash,
              createdAt: logDate,
            },
          ],
          { session }
        );

        await session.commitTransaction();
        return record;
      } catch (err: any) {
        if (session) {
          await session.abortTransaction().catch(() => {});
        }

        if (err?.isFatalCorruption) {
          logger.error('Aborting audit write due to fatal historical chain corruption', {
            error: err.message,
          });
          return null;
        }

        const isTransient =
          err?.hasErrorLabel?.('TransientTransactionError') ||
          err?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
          err?.code === 112 || // WriteConflict
          err?.code === 251 || // NoSuchTransaction
          err?.message?.includes('WriteConflict') ||
          err?.message?.includes('concurrency conflict');

        if (isTransient && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 20);
          const backoffMs = Math.min(25 * Math.pow(2, attempt - 1) + jitter, 500);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        logger.error('Failed to write audit log entry', { error: err.message, attempt, code: err.code });
        return null;
      } finally {
        if (session) {
          await session.endSession().catch(() => {});
        }
      }
    }

    return null;
  }

  /**
   * Records an audit log with guaranteed monotonic sequence and cryptographic HMAC chaining.
   * Concurrency is serialized across independent processes via an ACID MongoDB transaction on AuditChainHead,
   * with in-process promise queueing to optimize single-instance throughput.
   */
  public static async log(params: ILogAuditParams): Promise<IAuditLogEntity | null> {
    return new Promise((resolve) => {
      this.writeLock = this.writeLock
        .then(async () => {
          try {
            const result = await this.executeTransactionalWrite(params);
            resolve(result);
          } catch (error) {
            logger.error('Failed to queue audit log entry', error);
            resolve(null);
          }
        })
        .catch((fatalErr) => {
          logger.error('Unexpected fatal error in audit write queue', fatalErr);
          resolve(null);
        });
    });
  }

  /**
   * Evaluates the cryptographic integrity, previous-hash linkage, and monotonic sequence
   * of an in-memory list of audit log entities without depending on the chain head document.
   */
  public static verifyRecordList(
    records: Array<{
      sequenceNumber: number;
      previousHash: string;
      action: string;
      resourceType: string;
      resourceId: string;
      status: string;
      tamperHash: string;
      createdAt: Date | string;
    }>,
    secret = env.AUDIT_LOG_HMAC_SECRET
  ): {
    status: 'PASS' | 'FAIL';
    isValid: boolean;
    totalVerified: number;
    invalidSignatureCount: number;
    brokenPreviousHashCount: number;
    sequenceGapCount: number;
    firstInvalidSequence: number | null;
    atSequence: number | null;
    error: string | null;
    details: Record<string, unknown> | null;
  } {
    if (!secret || secret.length < 16) {
      return {
        status: 'FAIL',
        isValid: false,
        totalVerified: 0,
        invalidSignatureCount: 0,
        brokenPreviousHashCount: 0,
        sequenceGapCount: 0,
        firstInvalidSequence: null,
        atSequence: null,
        error: 'INVALID_HMAC_SECRET: Cannot verify audit chain without valid secret',
        details: null,
      };
    }

    if (records.length === 0) {
      return {
        status: 'PASS',
        isValid: true,
        totalVerified: 0,
        invalidSignatureCount: 0,
        brokenPreviousHashCount: 0,
        sequenceGapCount: 0,
        firstInvalidSequence: null,
        atSequence: null,
        error: null,
        details: null,
      };
    }

    let expectedPrevHash = AuditService.GENESIS_HASH;
    let invalidSignatureCount = 0;
    let brokenPreviousHashCount = 0;
    let sequenceGapCount = 0;
    let firstInvalidSequence: number | null = null;
    let firstError: string | null = null;
    let firstDetails: Record<string, unknown> | null = null;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const expectedSeq = i + 1;

      // 1. Check sequence continuity
      if (record.sequenceNumber !== expectedSeq) {
        sequenceGapCount++;
        if (firstInvalidSequence === null) {
          firstInvalidSequence = record.sequenceNumber;
          firstError = `SEQUENCE_GAP_OR_REORDERED: Expected sequence ${expectedSeq}, but found ${record.sequenceNumber}`;
        }
      }

      // 2. Check previous hash linkage
      if (record.previousHash !== expectedPrevHash) {
        brokenPreviousHashCount++;
        if (firstInvalidSequence === null) {
          firstInvalidSequence = record.sequenceNumber;
          firstError = `BROKEN_HASH_LINK: Entry at sequence ${record.sequenceNumber} has previousHash mismatch`;
          firstDetails = { expected: expectedPrevHash, found: record.previousHash };
        }
      }

      // 3. Recalculate HMAC and assert integrity
      const isoTimestamp =
        record.createdAt instanceof Date ? record.createdAt.toISOString() : new Date(record.createdAt).toISOString();

      const payload = this.computePayloadToSign(
        record.previousHash,
        record.sequenceNumber,
        record.action,
        record.resourceType,
        record.resourceId,
        record.status,
        isoTimestamp
      );

      const recalculatedHash = this.computeHmac(payload, secret);

      if (recalculatedHash !== record.tamperHash) {
        invalidSignatureCount++;
        if (firstInvalidSequence === null) {
          firstInvalidSequence = record.sequenceNumber;
          firstError = `TAMPER_DETECTED_INVALID_HMAC: Entry at sequence ${record.sequenceNumber} was modified`;
          firstDetails = { expected: record.tamperHash, recalculated: recalculatedHash };
        }
      }

      expectedPrevHash = record.tamperHash;
    }

    const isValid = invalidSignatureCount === 0 && brokenPreviousHashCount === 0 && sequenceGapCount === 0;

    return {
      status: isValid ? 'PASS' : 'FAIL',
      isValid,
      totalVerified: records.length,
      invalidSignatureCount,
      brokenPreviousHashCount,
      sequenceGapCount,
      firstInvalidSequence,
      atSequence: firstInvalidSequence ?? null,
      error: firstError,
      details: firstDetails,
    };
  }

  /**
   * Verifies the cryptographic integrity and sequence continuity of the audit chain
   */
  public static async verifyChain(secret = env.AUDIT_LOG_HMAC_SECRET): Promise<IAuditVerificationResult> {
    const verifiedAt = new Date().toISOString();
    const processIsolationNotice =
      'Audit chain sequence writes are synchronized via atomic MongoDB transactions on AuditChainHead across distributed instances and process-local callers.';

    const records = await AuditLogModel.find().sort({ sequenceNumber: 1 }).lean();
    const evaluation = this.verifyRecordList(records, secret);

    return {
      ...evaluation,
      verifiedAt,
      processIsolationNotice,
    };
  }

  /**
   * Aggregates summary counts for total, success, failure/denied, and security-critical audit events
   */
  public static async getSummary(query: Record<string, unknown> = {}): Promise<IAuditSummary> {
    const securityCriticalActions = [
      AuditAction.AUTH_FAILED_LOGIN,
      AuditAction.AUTH_TOKEN_REVOKED,
      AuditAction.ADMIN_ROLE_CHANGE,
      AuditAction.ADMIN_CLEARANCE_CHANGE,
      AuditAction.ADMIN_PERMISSION_CHANGE,
      AuditAction.DOC_ACL_UPDATE,
      AuditAction.ADMIN_PURGE,
    ];

    const [summary] = await AuditLogModel.aggregate<{
      total: number;
      success: number;
      denied: number;
      error: number;
      securityCritical: number;
    }>([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          denied: { $sum: { $cond: [{ $eq: ['$status', 'denied'] }, 1, 0] } },
          error: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          securityCritical: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$status', ['denied', 'error']] },
                    { $in: ['$action', securityCriticalActions] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const total = summary?.total || 0;
    const success = summary?.success || 0;
    const denied = summary?.denied || 0;
    const error = summary?.error || 0;
    const failedTotal = denied + error;
    const securityCritical = summary?.securityCritical || 0;

    return {
      total,
      success,
      denied,
      error,
      failedTotal,
      securityCritical,
    };
  }
}
