import { Worker, Job } from 'bullmq';
import { DocumentStatus, CLEARANCE_RANK, IQdrantChunkPayload } from '@enterprise-ai/shared-types';
import { INGESTION_QUEUE_NAME, IIngestionJobPayload, getRedisConnection } from './ingestion.queue.js';
import { DocumentModel } from '../models/Document.model.js';
import { DocumentChunkModel } from '../models/DocumentChunk.model.js';
import { StorageService } from '../services/storage.service.js';
import { ParserFactory } from '../services/parsers/parser.factory.js';
import { ChunkerService } from '../services/chunking.service.js';
import { EmbeddingFactory } from '../services/embeddings/embedding.factory.js';
import { QdrantService, IQdrantPoint } from '../services/qdrant.service.js';
import { env } from '../config/env.js';
import { RagCacheService } from '../services/cache/rag-cache.service.js';
import logger from '../utils/logger.js';

export class IngestionWorker {
  private workerInstance: Worker<IIngestionJobPayload> | null = null;
  private isReady = false;

  /**
   * Processes a single document ingestion job
   */
  public static async processJob(job: Job<IIngestionJobPayload>): Promise<void> {
    const { documentId, revision: requestedRevision } = job.data;
    logger.info(`Starting ingestion for document ${documentId} (attempt ${job.attemptsMade + 1})`);

    const document = await DocumentModel.findById(documentId);
    if (!document) {
      logger.warn(`Document ${documentId} not found; terminating job.`);
      return;
    }

    if (document.status === DocumentStatus.DELETING) {
      logger.info(`Document ${documentId} is marked for deletion; skipping processing.`);
      return;
    }

    // Determine active and target revision (blue/green staging strategy)
    const isAlreadyReady = document.status === DocumentStatus.READY;
    const activeRevision = document.currentRevision || 1;

    // Early rejection: If job specifies a revision strictly older than the active revision, discard immediately
    if (requestedRevision && requestedRevision < activeRevision) {
      logger.warn(
        `Discarding obsolete job for document ${documentId}: requested revision ${requestedRevision} is older than active revision ${activeRevision}.`
      );
      return;
    }

    const targetRevision =
      requestedRevision ?? (isAlreadyReady ? activeRevision + 1 : activeRevision);

    // 1. Stage revision: If not already READY, transition to PROCESSING. If already READY, keep READY while staging.
    if (!isAlreadyReady) {
      await DocumentModel.updateOne(
        { _id: document._id },
        {
          $set: { status: DocumentStatus.PROCESSING, stagedRevision: targetRevision, errorMessage: null },
          $inc: { processingAttempts: 1 },
        }
      );
    } else {
      await DocumentModel.updateOne(
        { _id: document._id },
        {
          $set: { stagedRevision: targetRevision, errorMessage: null },
          $inc: { processingAttempts: 1 },
        }
      );
    }

    try {
      // 2. Read raw file buffer from storage
      const fileBuffer = await StorageService.readFile(document.storagePath);

      // 3. Parse text safely using MIME adapter
      const parser = ParserFactory.getParser(document.mimeType);
      const parsedDoc = await parser.parse(fileBuffer);

      // 4. Deterministic Chunking under targetRevision
      const chunks = ChunkerService.chunkText(
        document._id.toString(),
        parsedDoc.text,
        undefined,
        targetRevision
      );
      if (chunks.length === 0) {
        throw new Error('Document produced zero chunks after parsing and normalization');
      }

      // 5. If initial ingestion, transition to INDEXING
      if (!isAlreadyReady) {
        await DocumentModel.updateOne(
          { _id: document._id },
          { $set: { status: DocumentStatus.INDEXING } }
        );
      }

      // 6. Generate embeddings
      const embeddingProvider = EmbeddingFactory.getProvider();
      const chunkTexts = chunks.map((c) => c.content);
      const vectors = await embeddingProvider.embedBatch(chunkTexts);

      if (vectors.length !== chunks.length) {
        throw new Error(
          `Embedding mismatch: generated ${vectors.length} vectors for ${chunks.length} chunks`
        );
      }

      // 7. Ensure Qdrant collection exists and matches dimension
      await QdrantService.ensureCollection(
        env.QDRANT_COLLECTION_NAME,
        embeddingProvider.dimensions
      );

      // 8. Prepare Qdrant points with complete ACL metadata & targetRevision
      const minClearanceRank = CLEARANCE_RANK[document.accessControl.minimumClearance] ?? 1;
      const allowedRoles = document.accessControl.allowedRoles || [];
      const allowedDepartments = document.accessControl.allowedDepartments || [];
      const allowedUserIds = (document.accessControl.allowedUserIds || []).map((id) => id.toString());

      const qdrantPoints: IQdrantPoint[] = chunks.map((chunk, idx) => {
        const payload: IQdrantChunkPayload = {
          chunk_id: chunk.vectorId,
          document_id: document._id.toString(),
          revision: targetRevision,
          title: document.title,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
          content: chunk.content,
          minimum_clearance_level: minClearanceRank,
          allowed_roles: allowedRoles,
          allowed_departments: allowedDepartments,
          allowed_user_ids: allowedUserIds,
          is_active: true,
        };

        return {
          vectorId: chunk.vectorId,
          vector: vectors[idx],
          payload,
        };
      });

      // 9. Clean up only targetRevision artifacts before upserting (idempotency guard for job retry)
      // Active revision remains completely intact and queryable!
      await QdrantService.deleteDocumentVectorsByRevision(document._id.toString(), targetRevision);
      await DocumentChunkModel.deleteMany({ documentId: document._id, revision: targetRevision });

      // 10. Upsert staged points into Qdrant
      await QdrantService.upsertPoints(qdrantPoints);

      // 11. Persist staged chunks in MongoDB under targetRevision
      const mongoChunks = chunks.map((chunk) => ({
        documentId: document._id,
        chunkIndex: chunk.chunkIndex,
        revision: targetRevision,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        vectorId: chunk.vectorId,
        metadata: {
          title: document.title,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        },
        accessControl: {
          allowedRoles: document.accessControl.allowedRoles,
          allowedDepartments: document.accessControl.allowedDepartments,
          minimumClearance: document.accessControl.minimumClearance,
          allowedUserIds: document.accessControl.allowedUserIds,
        },
      }));

      await DocumentChunkModel.insertMany(mongoChunks);

      // 12. Atomic switch with Strict Compare-and-Set Guard:
      // An older job must NEVER replace a newer active revision, even if the document is not currently READY.
      // Match condition:
      // 1) currentRevision is strictly less than targetRevision (switching to a newer revision), OR
      // 2) currentRevision equals targetRevision AND status is not yet READY (initial activation of revision 1).
      const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);

      const switchedDoc = await DocumentModel.findOneAndUpdate(
        {
          _id: document._id,
          $or: [
            { currentRevision: { $lt: targetRevision } },
            {
              currentRevision: targetRevision,
              status: { $ne: DocumentStatus.READY },
            },
          ],
        },
        {
          $set: {
            status: DocumentStatus.READY,
            currentRevision: targetRevision,
            stagedRevision: null,
            chunkCount: chunks.length,
            tokenCount: totalTokens,
            errorMessage: null,
          },
        },
        { new: true }
      );

      if (!switchedDoc) {
        // Stale job protection: a newer job already completed and incremented currentRevision
        logger.warn(
          `Superseded stale job for document ${documentId}: target revision ${targetRevision} discarded.`
        );
        // Clean up staged vectors for this obsolete revision
        await QdrantService.deleteDocumentVectorsByRevision(document._id.toString(), targetRevision);
        await DocumentChunkModel.deleteMany({ documentId: document._id, revision: targetRevision });
        return;
      }

      // 13. Clean up previous revision ONLY AFTER successful switch
      if (targetRevision > 1) {
        try {
          await QdrantService.deleteOldRevisions(document._id.toString(), targetRevision);
          await DocumentChunkModel.deleteMany({
            documentId: document._id,
            revision: { $lt: targetRevision },
          });
        } catch (cleanupErr) {
          logger.warn(`Failed to clean up older revisions for document ${documentId}`, {
            error: cleanupErr,
          });
        }
      }

      logger.info(
        `Successfully ingested and indexed document ${documentId} (rev ${targetRevision}): ${chunks.length} chunks, ${totalTokens} tokens.`
      );

      // Invalidate RAG response cache so new revision is reflected
      await RagCacheService.invalidateAll();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Error processing document ${documentId}`, {
        error: errMsg,
        attempt: job.attemptsMade + 1,
      });

      // Compensating cleanup of staged revision vectors and chunks (does not affect active revision)
      try {
        await QdrantService.deleteDocumentVectorsByRevision(document._id.toString(), targetRevision);
        await DocumentChunkModel.deleteMany({
          documentId: document._id,
          revision: targetRevision,
        });
      } catch (cleanupErr) {
        logger.warn(`Failed to clean up staged vectors after document failure`, { error: cleanupErr });
      }

      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 3);

      if (isFinalAttempt) {
        if (!isAlreadyReady) {
          // Initial ingestion failure: mark as FAILED
          await DocumentModel.updateOne(
            { _id: document._id },
            {
              $set: {
                status: DocumentStatus.FAILED,
                stagedRevision: null,
                errorMessage: `Processing failed: ${errMsg.substring(0, 250)}`,
              },
            }
          );
        } else {
          // Re-index failure: preserve active READY status and clear staged revision
          await DocumentModel.updateOne(
            { _id: document._id },
            {
              $set: {
                stagedRevision: null,
                errorMessage: `Re-indexing failed: ${errMsg.substring(0, 250)}`,
              },
            }
          );
          logger.info(
            `Preserved active READY revision ${activeRevision} for document ${documentId} despite re-indexing failure.`
          );
        }
      }

      // Re-throw so BullMQ records the failure and schedules retry if attempts remain
      throw err;
    }
  }

  /**
   * Starts the BullMQ worker instance and waits for the underlying Redis
   * connection/backend readiness signal before resolving.
   * Cleans up all resources if readiness or connection fails.
   */
  public async start(concurrency = 5): Promise<void> {
    if (this.workerInstance) {
      return;
    }

    const connection = getRedisConnection();

    const worker = new Worker<IIngestionJobPayload>(
      INGESTION_QUEUE_NAME,
      async (job) => {
        await IngestionWorker.processJob(job);
      },
      {
        connection,
        concurrency,
      }
    );

    worker.on('error', (err) => {
      logger.error('BullMQ ingestion worker runtime error', { error: err.message });
    });

    worker.on('completed', (job) => {
      logger.info(`Job ${job.id} completed successfully for document ${job.data.documentId}`);
    });

    worker.on('failed', (job, err) => {
      logger.error(`Job ${job?.id} failed for document ${job?.data.documentId}`, { error: err.message });
    });

    this.workerInstance = worker;

    try {
      await worker.waitUntilReady();
      this.isReady = true;
    } catch (readinessErr: unknown) {
      this.isReady = false;
      await this.stop();
      throw readinessErr;
    }
  }

  /**
   * Returns whether the worker instance is currently initialized and ready to consume jobs
   */
  public isRunning(): boolean {
    return this.workerInstance !== null && this.isReady;
  }

  /**
   * Shuts down worker gracefully
   */
  public async stop(): Promise<void> {
    this.isReady = false;
    if (this.workerInstance) {
      const worker = this.workerInstance;
      this.workerInstance = null;
      await worker.close();
    }
  }
}
