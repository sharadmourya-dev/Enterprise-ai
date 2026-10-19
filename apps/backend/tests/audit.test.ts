import { AuditService } from '../src/services/audit.service.js';
import { AuditLogModel, AuditCounterModel } from '../src/models/AuditLog.model.js';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';

describe('Audit-Log Monotonic Chain Concurrency & Verification', () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditCounterModel.deleteMany({});
  });

  it('1. Sequential writes produce contiguous sequence numbers and valid chain', async () => {
    const log1 = await AuditService.log({
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_101',
      status: 'success',
    });

    const log2 = await AuditService.log({
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: 'd_202',
      status: 'success',
    });

    const log3 = await AuditService.log({
      action: AuditAction.CHAT_QUERY,
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: 'c_303',
      status: 'success',
    });

    expect(log1?.sequenceNumber).toBe(1);
    expect(log2?.sequenceNumber).toBe(2);
    expect(log3?.sequenceNumber).toBe(3);

    expect(log1?.previousHash).toBe('GENESIS_HASH_INITIAL_LOG');
    expect(log2?.previousHash).toBe(log1?.tamperHash);
    expect(log3?.previousHash).toBe(log2?.tamperHash);

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalVerified).toBe(3);
  });

  it('2. Concurrent audit writes produce strictly serialized, non-conflicting sequence numbers without chain forks', async () => {
    // Fire 15 simultaneous audit log requests in parallel
    const writePromises = Array.from({ length: 15 }).map((_, idx) =>
      AuditService.log({
        action: AuditAction.CHAT_QUERY,
        resourceType: AuditResourceType.CONVERSATION,
        resourceId: `c_parallel_${idx}`,
        status: 'success',
        details: { index: idx },
      })
    );

    const results = await Promise.all(writePromises);
    expect(results.every((r) => r !== null)).toBe(true);

    const logs = await AuditLogModel.find().sort({ sequenceNumber: 1 });
    expect(logs.length).toBe(15);

    // Assert strictly monotonic 1..15 with no duplicate sequence numbers
    for (let i = 0; i < 15; i++) {
      expect(logs[i].sequenceNumber).toBe(i + 1);
      if (i > 0) {
        expect(logs[i].previousHash).toBe(logs[i - 1].tamperHash);
      }
    }

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalVerified).toBe(15);
  });

  it('3. Deliberate payload tampering is immediately detected by verifyChain()', async () => {
    // Write 3 records
    for (let i = 1; i <= 3; i++) {
      await AuditService.log({
        action: AuditAction.CHAT_QUERY,
        resourceType: AuditResourceType.CONVERSATION,
        resourceId: `query_${i}`,
        status: 'success',
      });
    }

    // Deliberately tamper with record 2 directly in MongoDB
    await AuditLogModel.updateOne(
      { sequenceNumber: 2 },
      { $set: { status: 'denied' } } // Tampering status without recomputing tamperHash
    );

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('TAMPER_DETECTED_INVALID_HMAC');
    expect(verification.atSequence).toBe(2);
  });

  it('4. Deliberate sequence reordering or gap is detected by verifyChain()', async () => {
    // Write 3 records
    for (let i = 1; i <= 3; i++) {
      await AuditService.log({
        action: AuditAction.CHAT_QUERY,
        resourceType: AuditResourceType.CONVERSATION,
        resourceId: `query_${i}`,
        status: 'success',
      });
    }

    // Delete record 2, creating an artificial gap (1, 3)
    await AuditLogModel.deleteOne({ sequenceNumber: 2 });

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('SEQUENCE_GAP_OR_REORDERED');
    expect(verification.atSequence).toBe(3);
  });

  it('5. Safe failure handling when HMAC secret is invalid or empty', async () => {
    const invalidSecretResult = await AuditService.verifyChain('short_secret');
    expect(invalidSecretResult.isValid).toBe(false);
    expect(invalidSecretResult.error).toContain('INVALID_HMAC_SECRET');
  });
});
