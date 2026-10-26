import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  AuditAction,
  AuditResourceType,
  IAuditVerificationResult,
  IAuditSummary,
} from '@enterprise-ai/shared-types';
import { AuditLogModel, AuditCounterModel, IAuditLogEntity } from '../models/AuditLog.model.js';
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
  // Promise-based serialization lock ensuring atomic sequential writes without forks
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
   * Records an audit log with guaranteed monotonic sequence and cryptographic HMAC chaining.
   * Concurrency is serialized via an in-memory queue coupled with atomic MongoDB sequence reservation.
   */
  public static async log(params: ILogAuditParams): Promise<IAuditLogEntity | null> {
    return new Promise((resolve) => {
      this.writeLock = this.writeLock
        .then(async () => {
          try {
            // 1. Atomically reserve monotonic sequence number
            const counter = await AuditCounterModel.findOneAndUpdate(
              { _id: 'audit_log_master_sequence' },
              { $inc: { seq: 1 } },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            const sequenceNumber = counter.seq;

            // 2. Fetch the immediately preceding entry by sequenceNumber
            let previousHash = 'GENESIS_HASH_INITIAL_LOG';
            if (sequenceNumber > 1) {
              const prevLog = await AuditLogModel.findOne({ sequenceNumber: sequenceNumber - 1 }).select('tamperHash');
              if (prevLog) {
                previousHash = prevLog.tamperHash;
              } else {
                logger.warn(`Sequence gap detected: previous log at sequence ${sequenceNumber - 1} not found`);
              }
            }

            const logDate = params.timestamp || new Date();
            const isoTimestamp = logDate.toISOString();
            const payloadToSign = this.computePayloadToSign(
              previousHash,
              sequenceNumber,
              params.action,
              params.resourceType,
              params.resourceId,
              params.status,
              isoTimestamp
            );

            const tamperHash = this.computeHmac(payloadToSign);

            const record = await AuditLogModel.create({
              sequenceNumber,
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
            });

            resolve(record);
          } catch (error) {
            logger.error('Failed to write audit log entry', error);
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
   * Verifies the cryptographic integrity and sequence continuity of the audit chain
   */
  public static async verifyChain(secret = env.AUDIT_LOG_HMAC_SECRET): Promise<IAuditVerificationResult> {
    const verifiedAt = new Date().toISOString();
    const processIsolationNotice =
      'Audit chain sequence writes are synchronized via atomic MongoDB counter and process-local promise queue. Multi-instance clusters require distributed coordination (e.g. distributed locks or sequencer).';

    if (!secret || secret.length < 16) {
      return {
        status: 'FAIL',
        isValid: false,
        totalVerified: 0,
        invalidSignatureCount: 0,
        brokenPreviousHashCount: 0,
        sequenceGapCount: 0,
        firstInvalidSequence: null,
        error: 'INVALID_HMAC_SECRET: Cannot verify audit chain without valid secret',
        verifiedAt,
        processIsolationNotice,
      };
    }

    const records = await AuditLogModel.find().sort({ sequenceNumber: 1 }).lean();

    if (records.length === 0) {
      return {
        status: 'PASS',
        isValid: true,
        totalVerified: 0,
        invalidSignatureCount: 0,
        brokenPreviousHashCount: 0,
        sequenceGapCount: 0,
        firstInvalidSequence: null,
        error: null,
        details: null,
        verifiedAt,
        processIsolationNotice,
      };
    }

    let expectedPrevHash = 'GENESIS_HASH_INITIAL_LOG';
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
      const payload = this.computePayloadToSign(
        record.previousHash,
        record.sequenceNumber,
        record.action,
        record.resourceType,
        record.resourceId,
        record.status,
        record.createdAt.toISOString()
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
      error: firstError,
      details: firstDetails,
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
