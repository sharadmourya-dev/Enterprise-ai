import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import logger from '../utils/logger.js';
import { RedisService } from '../services/redis.service.js';

export interface IIngestionJobPayload {
  documentId: string;
  revision?: number;
  revisionId?: string;
}

export const INGESTION_QUEUE_NAME = 'document-ingestion';

let ingestionQueueInstance: Queue<IIngestionJobPayload> | null = null;

export function getRedisConnection(): Redis {
  return RedisService.getClient();
}

export function getIngestionQueue(): Queue<IIngestionJobPayload> {
  if (!ingestionQueueInstance) {
    const connection = getRedisConnection();
    ingestionQueueInstance = new Queue<IIngestionJobPayload>(INGESTION_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return ingestionQueueInstance;
}

/**
 * Enqueues a document for background ingestion and vector indexing
 */
export async function enqueueDocumentIngestion(
  documentId: string,
  revision?: number
): Promise<string> {
  const queue = getIngestionQueue();
  const revSuffix = revision ? `_r${revision}` : '';
  const jobId = `doc_${documentId}${revSuffix}_${Date.now()}`;

  const job = await queue.add(
    'process-document',
    { documentId, revision },
    { jobId }
  );

  logger.info(`Enqueued document ingestion job ${job.id} for document ${documentId}`);
  return job.id!;
}

/**
 * Graceful close of queue connections
 */
export async function closeIngestionQueue(): Promise<void> {
  if (ingestionQueueInstance) {
    await ingestionQueueInstance.close();
    ingestionQueueInstance = null;
  }
  await RedisService.closeConnection();
}
