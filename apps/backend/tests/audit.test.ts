import { fork, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { AuditService } from '../src/services/audit.service.js';
import { AuditLogModel, AuditCounterModel, AuditChainHeadModel } from '../src/models/AuditLog.model.js';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';
import { env } from '../src/config/env.js';

describe('Audit-Log Monotonic Chain Concurrency & Verification', () => {
  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditCounterModel.deleteMany({});
    await AuditChainHeadModel.deleteMany({});
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

  it('6. Cross-process concurrency simulation: independent transactional writes resolve write conflicts and preserve chain', async () => {
    // Bypasses the in-process writeLock queue by invoking executeTransactionalWrite directly in parallel
    // This directly exercises MongoDB replica-set transactions, row-level locks, and transient write-conflict retries
    const parallelCount = 10;
    const directPromises = Array.from({ length: parallelCount }).map((_, idx) =>
      AuditService.executeTransactionalWrite({
        action: AuditAction.ADMIN_ROLE_CHANGE,
        resourceType: AuditResourceType.USER,
        resourceId: `u_cross_proc_${idx}`,
        status: 'success',
        details: { threadIndex: idx },
      })
    );

    const results = await Promise.all(directPromises);
    expect(results.every((r) => r !== null)).toBe(true);

    const logs = await AuditLogModel.find().sort({ sequenceNumber: 1 });
    expect(logs.length).toBe(parallelCount);

    for (let i = 0; i < parallelCount; i++) {
      expect(logs[i].sequenceNumber).toBe(i + 1);
      if (i > 0) {
        expect(logs[i].previousHash).toBe(logs[i - 1].tamperHash);
      }
    }

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalVerified).toBe(parallelCount);
    expect(verification.brokenPreviousHashCount).toBe(0);
    expect(verification.sequenceGapCount).toBe(0);
  });

  it('7. Correct genesis initialization on empty collection', async () => {
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments()).toBe(0);

    const firstLog = await AuditService.log({
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_genesis',
      status: 'success',
    });

    expect(firstLog).not.toBeNull();
    expect(firstLog?.sequenceNumber).toBe(1);
    expect(firstLog?.previousHash).toBe('GENESIS_HASH_INITIAL_LOG');

    const chainHead = await AuditChainHeadModel.findById(AuditService.CHAIN_HEAD_ID);
    expect(chainHead).not.toBeNull();
    expect(chainHead?.sequenceNumber).toBe(1);
    expect(chainHead?.lastHash).toBe(firstLog?.tamperHash);
  });

  it('8. Preservation and seamless continuation of historical audit records', async () => {
    // Simulate historical logs created prior to AuditChainHead existence
    const secret = process.env.AUDIT_LOG_HMAC_SECRET!;
    const now = new Date('2026-10-25T10:00:00.000Z');
    let prev = 'GENESIS_HASH_INITIAL_LOG';

    for (let seq = 1; seq <= 5; seq++) {
      const payload = AuditService.computePayloadToSign(
        prev,
        seq,
        AuditAction.AUTH_LOGIN,
        AuditResourceType.USER,
        `hist_${seq}`,
        'success',
        now.toISOString()
      );
      const hash = AuditService.computeHmac(payload, secret);
      await AuditLogModel.create({
        sequenceNumber: seq,
        previousHash: prev,
        action: AuditAction.AUTH_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: `hist_${seq}`,
        status: 'success',
        tamperHash: hash,
        createdAt: now,
      });
      prev = hash;
    }

    // Ensure chain head document does NOT exist yet
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);

    // Write a new record using AuditService.log
    const newLog = await AuditService.log({
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: 'doc_post_migration',
      status: 'success',
      timestamp: new Date('2026-10-25T10:05:00.000Z'),
    });

    expect(newLog).not.toBeNull();
    expect(newLog?.sequenceNumber).toBe(6);
    expect(newLog?.previousHash).toBe(prev);

    // Verify chain head initialized from historical records
    const chainHead = await AuditChainHeadModel.findById(AuditService.CHAIN_HEAD_ID);
    expect(chainHead?.sequenceNumber).toBe(6);
    expect(chainHead?.lastHash).toBe(newLog?.tamperHash);

    // Entire chain including historical records must verify cleanly
    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalVerified).toBe(6);
    expect(verification.sequenceGapCount).toBe(0);
    expect(verification.brokenPreviousHashCount).toBe(0);
  });

  it('9. Transaction rollback: failure mid-transaction does not leave chain head or log inconsistent', async () => {
    // Write an initial valid record
    const validLog = await AuditService.log({
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_init',
      status: 'success',
    });
    expect(validLog?.sequenceNumber).toBe(1);

    // Mock AuditLogModel.create to throw mid-transaction (after chain head update)
    const createSpy = jest.spyOn(AuditLogModel, 'create').mockImplementationOnce(() => {
      throw new Error('Simulated fatal disk failure during audit log insertion');
    });

    const failedLog = await AuditService.log({
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: 'doc_fail',
      status: 'success',
    });

    expect(failedLog).toBeNull();
    createSpy.mockRestore();

    // Assert AuditChainHead and AuditLog were NOT mutated by the failed transaction (atomic rollback)
    const headAfterFailure = await AuditChainHeadModel.findById(AuditService.CHAIN_HEAD_ID);
    expect(headAfterFailure?.sequenceNumber).toBe(1);
    expect(headAfterFailure?.lastHash).toBe(validLog?.tamperHash);

    const logCountAfterFailure = await AuditLogModel.countDocuments();
    expect(logCountAfterFailure).toBe(1);

    // Subsequent write succeeds and acquires sequenceNumber: 2 without gaps
    const nextValidLog = await AuditService.log({
      action: AuditAction.CHAT_QUERY,
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: 'c_after_rollback',
      status: 'success',
    });

    expect(nextValidLog?.sequenceNumber).toBe(2);
    expect(nextValidLog?.previousHash).toBe(validLog?.tamperHash);

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalVerified).toBe(2);
  });

  it('10. Concurrent initialization: parallel calls on fresh database initialize chain head safely', async () => {
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);

    // Fire 6 simultaneous direct transactional writes on an empty database
    const initPromises = Array.from({ length: 6 }).map((_, idx) =>
      AuditService.executeTransactionalWrite({
        action: AuditAction.AUTH_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: `u_init_parallel_${idx}`,
        status: 'success',
        details: { initIndex: idx },
      })
    );

    const results = await Promise.all(initPromises);
    expect(results.every((r) => r !== null)).toBe(true);

    const logs = await AuditLogModel.find().sort({ sequenceNumber: 1 });
    expect(logs.length).toBe(6);

    for (let i = 0; i < 6; i++) {
      expect(logs[i].sequenceNumber).toBe(i + 1);
      if (i > 0) {
        expect(logs[i].previousHash).toBe(logs[i - 1].tamperHash);
      }
    }

    const verification = await AuditService.verifyChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalVerified).toBe(6);
  });

  it('11. Historical HMAC mismatch blocks chain-head initialization and write fails closed', async () => {
    const secret = process.env.AUDIT_LOG_HMAC_SECRET!;
    const now = new Date('2026-10-25T10:00:00.000Z');

    // Create record 1 (valid)
    const p1 = AuditService.computePayloadToSign(
      'GENESIS_HASH_INITIAL_LOG',
      1,
      AuditAction.AUTH_LOGIN,
      AuditResourceType.USER,
      'u_hist_1',
      'success',
      now.toISOString()
    );
    const h1 = AuditService.computeHmac(p1, secret);
    await AuditLogModel.create({
      sequenceNumber: 1,
      previousHash: 'GENESIS_HASH_INITIAL_LOG',
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_hist_1',
      status: 'success',
      tamperHash: h1,
      createdAt: now,
    });

    // Create record 2 with tampered HMAC
    await AuditLogModel.create({
      sequenceNumber: 2,
      previousHash: h1,
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_hist_2',
      status: 'success',
      tamperHash: 'invalid_tampered_hmac_1234567890abcdef1234567890abcdef12345678',
      createdAt: now,
    });

    // Ensure chain head does NOT exist
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);

    // Attempting a write must fail closed
    const writeResult = await AuditService.log({
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: 'doc_blocked',
      status: 'success',
    });

    expect(writeResult).toBeNull();

    // Verify chain head was NOT created
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);

    // Verify no new audit record was appended; existing records preserved
    expect(await AuditLogModel.countDocuments()).toBe(2);
  });

  it('12. Historical sequence gap blocks chain-head initialization and write fails closed', async () => {
    const secret = process.env.AUDIT_LOG_HMAC_SECRET!;
    const now = new Date('2026-10-25T10:00:00.000Z');

    // Create record 1
    const p1 = AuditService.computePayloadToSign(
      'GENESIS_HASH_INITIAL_LOG',
      1,
      AuditAction.AUTH_LOGIN,
      AuditResourceType.USER,
      'u_hist_1',
      'success',
      now.toISOString()
    );
    const h1 = AuditService.computeHmac(p1, secret);
    await AuditLogModel.create({
      sequenceNumber: 1,
      previousHash: 'GENESIS_HASH_INITIAL_LOG',
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_hist_1',
      status: 'success',
      tamperHash: h1,
      createdAt: now,
    });

    // Create record 3 (gap: sequence 2 is missing)
    const p3 = AuditService.computePayloadToSign(
      h1,
      3,
      AuditAction.DOC_UPLOAD,
      AuditResourceType.DOCUMENT,
      'doc_hist_3',
      'success',
      now.toISOString()
    );
    const h3 = AuditService.computeHmac(p3, secret);
    await AuditLogModel.create({
      sequenceNumber: 3,
      previousHash: h1,
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: 'doc_hist_3',
      status: 'success',
      tamperHash: h3,
      createdAt: now,
    });

    expect(await AuditChainHeadModel.countDocuments()).toBe(0);

    // Write must fail closed
    const writeResult = await AuditService.log({
      action: AuditAction.CHAT_QUERY,
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: 'c_blocked',
      status: 'success',
    });

    expect(writeResult).toBeNull();
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments()).toBe(2);
  });

  it('13. Broken previous-hash link blocks chain-head initialization and write fails closed', async () => {
    const secret = process.env.AUDIT_LOG_HMAC_SECRET!;
    const now = new Date('2026-10-25T10:00:00.000Z');

    const p1 = AuditService.computePayloadToSign(
      'GENESIS_HASH_INITIAL_LOG',
      1,
      AuditAction.AUTH_LOGIN,
      AuditResourceType.USER,
      'u_hist_1',
      'success',
      now.toISOString()
    );
    const h1 = AuditService.computeHmac(p1, secret);
    await AuditLogModel.create({
      sequenceNumber: 1,
      previousHash: 'GENESIS_HASH_INITIAL_LOG',
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: 'u_hist_1',
      status: 'success',
      tamperHash: h1,
      createdAt: now,
    });

    // Record 2 with broken previousHash link
    const brokenPrev = 'foreign_non_matching_hash_link_999999999999999999999999999999999999';
    const p2 = AuditService.computePayloadToSign(
      brokenPrev,
      2,
      AuditAction.DOC_UPLOAD,
      AuditResourceType.DOCUMENT,
      'doc_hist_2',
      'success',
      now.toISOString()
    );
    const h2 = AuditService.computeHmac(p2, secret);
    await AuditLogModel.create({
      sequenceNumber: 2,
      previousHash: brokenPrev,
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: 'doc_hist_2',
      status: 'success',
      tamperHash: h2,
      createdAt: now,
    });

    expect(await AuditChainHeadModel.countDocuments()).toBe(0);

    const writeResult = await AuditService.log({
      action: AuditAction.CHAT_QUERY,
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: 'c_blocked',
      status: 'success',
    });

    expect(writeResult).toBeNull();
    expect(await AuditChainHeadModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments()).toBe(2);
  });

  it('14. Genuine independent Node.js processes execute concurrent writes preserving chain integrity', async () => {
    const candidateA = path.resolve(process.cwd(), 'tests/helpers/multiprocess-audit-worker.ts');
    const candidateB = path.resolve(process.cwd(), 'apps/backend/tests/helpers/multiprocess-audit-worker.ts');
    const workerScript = fs.existsSync(candidateA) ? candidateA : candidateB;

    const workerCount = 3;
    const writesPerWorker = 4;
    const totalExpected = workerCount * writesPerWorker;

    const children: ChildProcess[] = [];
    const readyPromises: Promise<void>[] = [];
    const exitPromises: Promise<{ code: number | null; signal: NodeJS.Signals | null }>[] = [];

    for (let i = 0; i < workerCount; i++) {
      const child = fork(workerScript, [], {
        execArgv: ['--import', 'tsx'],
        env: {
          ...process.env,
          WORKER_ID: `proc_${i + 1}`,
          WRITE_COUNT: String(writesPerWorker),
          MONGODB_TEST_URI: env.MONGODB_TEST_URI,
          NODE_ENV: 'test',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      children.push(child);

      readyPromises.push(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Worker ${i + 1} timed out waiting for READY`)), 10000);
          child.on('message', (msg: any) => {
            if (msg?.type === 'READY') {
              clearTimeout(timer);
              resolve();
            }
          });
          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        })
      );

      exitPromises.push(
        new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`Worker ${i + 1} timed out before completing writes`));
          }, 25000);
          child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal });
          });
        })
      );
    }

    try {
      // 1. Wait until all child processes have connected to MongoDB and are READY
      await Promise.all(readyPromises);

      // 2. Broadcast START signal to all child processes simultaneously
      children.forEach((c) => c.send({ type: 'START' }));

      // 3. Await all child process exits
      const exitResults = await Promise.all(exitPromises);
      for (const res of exitResults) {
        expect(res.code).toBe(0);
      }

      // 4. Assert total records and sequence continuity across all independent processes
      const logs = await AuditLogModel.find().sort({ sequenceNumber: 1 });
      expect(logs.length).toBe(totalExpected);

      for (let i = 0; i < totalExpected; i++) {
        expect(logs[i].sequenceNumber).toBe(i + 1);
        if (i > 0) {
          expect(logs[i].previousHash).toBe(logs[i - 1].tamperHash);
        }
      }

      // 5. Assert the master chain head matches the final sequence
      const chainHead = await AuditChainHeadModel.findById(AuditService.CHAIN_HEAD_ID);
      expect(chainHead?.sequenceNumber).toBe(totalExpected);
      expect(chainHead?.lastHash).toBe(logs[totalExpected - 1].tamperHash);

      // 6. Cryptographically verify the complete multi-process chain
      const verification = await AuditService.verifyChain();
      expect(verification.isValid).toBe(true);
      expect(verification.totalVerified).toBe(totalExpected);
      expect(verification.sequenceGapCount).toBe(0);
      expect(verification.brokenPreviousHashCount).toBe(0);
      expect(verification.invalidSignatureCount).toBe(0);
    } finally {
      // Ensure all child processes are cleaned up
      children.forEach((c) => {
        if (!c.killed) c.kill('SIGKILL');
      });
    }
  }, 35000);
});
