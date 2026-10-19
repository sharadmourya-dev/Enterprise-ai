import crypto from 'crypto';
import mongoose from 'mongoose';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';
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

export interface IAuditVerificationResult {
  isValid: boolean;
  totalVerified: number;
  error?: string;
  atSequence?: number;
  details?: Record<string, unknown>;
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
    if (!secret || secret.length < 16) {
      return {
        isValid: false,
        totalVerified: 0,
        error: 'INVALID_HMAC_SECRET: Cannot verify audit chain without valid secret',
      };
    }

    const records = await AuditLogModel.find().sort({ sequenceNumber: 1 });

    if (records.length === 0) {
      return { isValid: true, totalVerified: 0 };
    }

    let expectedPrevHash = 'GENESIS_HASH_INITIAL_LOG';

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const expectedSeq = i + 1;

      // 1. Check sequence continuity
      if (record.sequenceNumber !== expectedSeq) {
        return {
          isValid: false,
          totalVerified: i,
          error: `SEQUENCE_GAP_OR_REORDERED: Expected sequence ${expectedSeq}, but found ${record.sequenceNumber}`,
          atSequence: record.sequenceNumber,
        };
      }

      // 2. Check previous hash linkage
      if (record.previousHash !== expectedPrevHash) {
        return {
          isValid: false,
          totalVerified: i,
          error: `BROKEN_HASH_LINK: Entry at sequence ${record.sequenceNumber} has previousHash mismatch`,
          atSequence: record.sequenceNumber,
          details: { expected: expectedPrevHash, found: record.previousHash },
        };
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
        return {
          isValid: false,
          totalVerified: i,
          error: `TAMPER_DETECTED_INVALID_HMAC: Entry at sequence ${record.sequenceNumber} was modified`,
          atSequence: record.sequenceNumber,
          details: { expected: record.tamperHash, recalculated: recalculatedHash },
        };
      }

      expectedPrevHash = record.tamperHash;
    }

    return {
      isValid: true,
      totalVerified: records.length,
    };
  }
}
