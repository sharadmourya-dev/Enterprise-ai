import mongoose from 'mongoose';
import { assertSafeTestDatabaseUri } from '../../src/config/db.js';
import { AuditService } from '../../src/services/audit.service.js';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';

async function runWorker() {
  const workerId = process.env.WORKER_ID || `worker_${process.pid}`;
  const writeCount = parseInt(process.env.WRITE_COUNT || '5', 10);
  const mongoUri = process.env.MONGODB_TEST_URI;

  if (!mongoUri) {
    console.error(`[Worker ${workerId}] Missing MONGODB_TEST_URI environment variable`);
    process.exit(1);
  }

  // Strict test database safety assertion before connecting
  assertSafeTestDatabaseUri(mongoUri);

  try {
    await mongoose.connect(mongoUri);

    const executeWrites = async () => {
      const results: Array<{ sequenceNumber: number; tamperHash: string }> = [];
      const errors: Array<{ iteration: number; error: string }> = [];

      for (let i = 0; i < writeCount; i++) {
        try {
          const record = await AuditService.executeTransactionalWrite({
            action: AuditAction.AUTH_LOGIN,
            resourceType: AuditResourceType.USER,
            resourceId: `${workerId}_u_${i}`,
            status: 'success',
            details: { workerId, iteration: i, pid: process.pid },
          });

          if (record) {
            results.push({ sequenceNumber: record.sequenceNumber, tamperHash: record.tamperHash });
          } else {
            errors.push({ iteration: i, error: 'Write returned null' });
          }
        } catch (err: any) {
          errors.push({ iteration: i, error: err.message });
        }
      }

      await mongoose.disconnect();

      if (process.send) {
        process.send({
          type: 'DONE',
          workerId,
          pid: process.pid,
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors,
        });
      }

      process.exit(errors.length === 0 ? 0 : 1);
    };

    if (process.send) {
      // IPC mode: signal parent that worker is connected and ready
      process.send({ type: 'READY', workerId, pid: process.pid });

      // Wait for synchronized START signal
      process.on('message', (msg: any) => {
        if (msg && msg.type === 'START') {
          executeWrites().catch((fatalErr) => {
            console.error(`[Worker ${workerId}] Fatal execution error:`, fatalErr);
            process.exit(1);
          });
        }
      });
    } else {
      // Non-IPC mode: execute immediately
      await executeWrites();
    }
  } catch (initErr) {
    console.error(`[Worker ${workerId}] Failed during initialization:`, initErr);
    process.exit(1);
  }
}

runWorker();

