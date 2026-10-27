import { AuditService } from '../src/services/audit.service.js';
import { AuditLogModel } from '../src/models/AuditLog.model.js';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';

describe('Audit Service & Verification Unit Tests', () => {
  const TEST_SECRET = 'enterprise_ai_secure_test_hmac_secret_key_32_bytes_long';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUDIT_LOG_HMAC_SECRET = TEST_SECRET;
  });

  describe('AuditService HMAC calculations', () => {
    it('produces deterministic HMAC-SHA256 signatures for canonical payloads', () => {
      const payload1 = AuditService.computePayloadToSign(
        '0000000000000000000000000000000000000000000000000000000000000000',
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'user_123',
        'success',
        '2026-10-26T12:00:00.000Z'
      );

      const hash1 = AuditService.computeHmac(payload1, TEST_SECRET);
      const hash2 = AuditService.computeHmac(payload1, TEST_SECRET);

      expect(typeof hash1).toBe('string');
      expect(hash1).toHaveLength(64); // SHA-256 hex string
      expect(hash1).toBe(hash2);
    });

    it('changes HMAC hash when any canonical payload field changes', () => {
      const payloadA = AuditService.computePayloadToSign(
        'prev_hash',
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'user_123',
        'success',
        '2026-10-26T12:00:00.000Z'
      );

      const payloadB = AuditService.computePayloadToSign(
        'prev_hash',
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'user_123',
        'denied', // Changed status
        '2026-10-26T12:00:00.000Z'
      );

      const hashA = AuditService.computeHmac(payloadA, TEST_SECRET);
      const hashB = AuditService.computeHmac(payloadB, TEST_SECRET);

      expect(hashA).not.toBe(hashB);
    });
  });

  describe('AuditService.verifyChain', () => {
    it('returns PASS for an empty audit log', async () => {
      jest.spyOn(AuditLogModel, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await AuditService.verifyChain(TEST_SECRET);

      expect(result.status).toBe('PASS');
      expect(result.isValid).toBe(true);
      expect(result.totalVerified).toBe(0);
      expect(result.invalidSignatureCount).toBe(0);
      expect(result.brokenPreviousHashCount).toBe(0);
      expect(result.sequenceGapCount).toBe(0);
      expect(result.firstInvalidSequence).toBeNull();
      expect(result.error).toBeNull();
    });

    it('returns PASS for a valid sequentially linked hash chain', async () => {
      const genesisPrev = 'GENESIS_HASH_INITIAL_LOG';
      const now = new Date('2026-10-26T12:00:00.000Z');

      const p1Str = AuditService.computePayloadToSign(
        genesisPrev,
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'u1',
        'success',
        now.toISOString()
      );
      const h1 = AuditService.computeHmac(p1Str, TEST_SECRET);

      const p2Str = AuditService.computePayloadToSign(
        h1,
        2,
        AuditAction.DOC_UPLOAD,
        AuditResourceType.DOCUMENT,
        'doc_1',
        'success',
        now.toISOString()
      );
      const h2 = AuditService.computeHmac(p2Str, TEST_SECRET);

      const p3Str = AuditService.computePayloadToSign(
        h2,
        3,
        AuditAction.ADMIN_ROLE_CHANGE,
        AuditResourceType.USER,
        'u3',
        'success',
        now.toISOString()
      );
      const h3 = AuditService.computeHmac(p3Str, TEST_SECRET);

      const mockLogs = [
        {
          sequenceNumber: 1,
          previousHash: genesisPrev,
          action: AuditAction.AUTH_LOGIN,
          resourceType: AuditResourceType.USER,
          resourceId: 'u1',
          status: 'success',
          tamperHash: h1,
          createdAt: now,
        },
        {
          sequenceNumber: 2,
          previousHash: h1,
          action: AuditAction.DOC_UPLOAD,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: 'doc_1',
          status: 'success',
          tamperHash: h2,
          createdAt: now,
        },
        {
          sequenceNumber: 3,
          previousHash: h2,
          action: AuditAction.ADMIN_ROLE_CHANGE,
          resourceType: AuditResourceType.USER,
          resourceId: 'u3',
          status: 'success',
          tamperHash: h3,
          createdAt: now,
        },
      ];

      jest.spyOn(AuditLogModel, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      } as any);

      const result = await AuditService.verifyChain(TEST_SECRET);

      expect(result.status).toBe('PASS');
      expect(result.isValid).toBe(true);
      expect(result.totalVerified).toBe(3);
      expect(result.invalidSignatureCount).toBe(0);
      expect(result.brokenPreviousHashCount).toBe(0);
      expect(result.sequenceGapCount).toBe(0);
      expect(result.firstInvalidSequence).toBeNull();
      expect(result.error).toBeNull();
    });

    it('detects tampered record signature and flags invalidSignatureCount', async () => {
      const genesisPrev = 'GENESIS_HASH_INITIAL_LOG';
      const now = new Date('2026-10-26T12:00:00.000Z');

      const p1Str = AuditService.computePayloadToSign(
        genesisPrev,
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'u1',
        'success',
        now.toISOString()
      );
      const h1 = AuditService.computeHmac(p1Str, TEST_SECRET);

      const mockLogs = [
        {
          sequenceNumber: 1,
          previousHash: genesisPrev,
          action: AuditAction.AUTH_LOGIN,
          resourceType: AuditResourceType.USER,
          resourceId: 'u1',
          status: 'success',
          tamperHash: h1,
          createdAt: now,
        },
        {
          sequenceNumber: 2,
          previousHash: h1,
          action: AuditAction.DOC_UPLOAD,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: 'doc_1',
          status: 'success',
          tamperHash: 'tampered_bad_signature_1234567890abcdef1234567890abcdef12345678',
          createdAt: now,
        },
      ];

      jest.spyOn(AuditLogModel, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      } as any);

      const result = await AuditService.verifyChain(TEST_SECRET);

      expect(result.status).toBe('FAIL');
      expect(result.isValid).toBe(false);
      expect(result.invalidSignatureCount).toBe(1);
      expect(result.firstInvalidSequence).toBe(2);
      expect(result.atSequence).toBe(2);
      expect(result.error).toContain('TAMPER_DETECTED_INVALID_HMAC');
    });

    it('detects broken previousHash link between records', async () => {
      const genesisPrev = 'GENESIS_HASH_INITIAL_LOG';
      const now = new Date('2026-10-26T12:00:00.000Z');

      const p1Str = AuditService.computePayloadToSign(
        genesisPrev,
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'u1',
        'success',
        now.toISOString()
      );
      const h1 = AuditService.computeHmac(p1Str, TEST_SECRET);

      const p2Str = AuditService.computePayloadToSign(
        'broken_foreign_hash_link_9999999999999999999999999999999999999999',
        2,
        AuditAction.DOC_UPLOAD,
        AuditResourceType.DOCUMENT,
        'doc_1',
        'success',
        now.toISOString()
      );
      const h2 = AuditService.computeHmac(p2Str, TEST_SECRET);

      const mockLogs = [
        {
          sequenceNumber: 1,
          previousHash: genesisPrev,
          action: AuditAction.AUTH_LOGIN,
          resourceType: AuditResourceType.USER,
          resourceId: 'u1',
          status: 'success',
          tamperHash: h1,
          createdAt: now,
        },
        {
          sequenceNumber: 2,
          previousHash: 'broken_foreign_hash_link_9999999999999999999999999999999999999999',
          action: AuditAction.DOC_UPLOAD,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: 'doc_1',
          status: 'success',
          tamperHash: h2,
          createdAt: now,
        },
      ];

      jest.spyOn(AuditLogModel, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      } as any);

      const result = await AuditService.verifyChain(TEST_SECRET);

      expect(result.status).toBe('FAIL');
      expect(result.isValid).toBe(false);
      expect(result.brokenPreviousHashCount).toBe(1);
      expect(result.firstInvalidSequence).toBe(2);
      expect(result.atSequence).toBe(2);
      expect(result.error).toContain('BROKEN_HASH_LINK');
    });

    it('detects sequence gaps / reordered sequence numbers', async () => {
      const genesisPrev = 'GENESIS_HASH_INITIAL_LOG';
      const now = new Date('2026-10-26T12:00:00.000Z');

      const p1Str = AuditService.computePayloadToSign(
        genesisPrev,
        1,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        'u1',
        'success',
        now.toISOString()
      );
      const h1 = AuditService.computeHmac(p1Str, TEST_SECRET);

      const p3Str = AuditService.computePayloadToSign(
        h1,
        3,
        AuditAction.DOC_UPLOAD,
        AuditResourceType.DOCUMENT,
        'doc_1',
        'success',
        now.toISOString()
      );
      const h3 = AuditService.computeHmac(p3Str, TEST_SECRET);

      // Sequence #2 is missing! Jump directly from 1 to 3
      const mockLogs = [
        {
          sequenceNumber: 1,
          previousHash: genesisPrev,
          action: AuditAction.AUTH_LOGIN,
          resourceType: AuditResourceType.USER,
          resourceId: 'u1',
          status: 'success',
          tamperHash: h1,
          createdAt: now,
        },
        {
          sequenceNumber: 3,
          previousHash: h1,
          action: AuditAction.DOC_UPLOAD,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: 'doc_1',
          status: 'success',
          tamperHash: h3,
          createdAt: now,
        },
      ];

      jest.spyOn(AuditLogModel, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      } as any);

      const result = await AuditService.verifyChain(TEST_SECRET);

      expect(result.status).toBe('FAIL');
      expect(result.isValid).toBe(false);
      expect(result.sequenceGapCount).toBe(1);
      expect(result.firstInvalidSequence).toBe(3);
      expect(result.atSequence).toBe(3);
      expect(result.error).toContain('SEQUENCE_GAP_OR_REORDERED');
    });
  });

  describe('AuditService.getSummary', () => {
    it('aggregates metrics with explicit classification policy', async () => {
      jest.spyOn(AuditLogModel, 'aggregate').mockResolvedValue([
        {
          _id: null,
          total: 150,
          success: 130,
          denied: 15,
          error: 5,
          securityCritical: 25,
        },
      ] as any);

      const summary = await AuditService.getSummary({});

      expect(summary.total).toBe(150);
      expect(summary.success).toBe(130);
      expect(summary.denied).toBe(15);
      expect(summary.error).toBe(5);
      expect(summary.failedTotal).toBe(20);
      expect(summary.securityCritical).toBe(25);
    });

    it('returns zero metrics when no records match filter', async () => {
      jest.spyOn(AuditLogModel, 'aggregate').mockResolvedValue([] as any);

      const summary = await AuditService.getSummary({});

      expect(summary.total).toBe(0);
      expect(summary.success).toBe(0);
      expect(summary.denied).toBe(0);
      expect(summary.error).toBe(0);
      expect(summary.failedTotal).toBe(0);
      expect(summary.securityCritical).toBe(0);
    });
  });
});
