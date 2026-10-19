import { IngestionWorker } from '../src/queue/ingestion.worker.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { DocumentChunkModel } from '../src/models/DocumentChunk.model.js';
import { StorageService } from '../src/services/storage.service.js';
import { QdrantService } from '../src/services/qdrant.service.js';
import { EmbeddingFactory } from '../src/services/embeddings/embedding.factory.js';
import { MockEmbeddingProvider } from '../src/services/embeddings/mock.embedding.js';
import {
  DocumentMimeType,
  DocumentStatus,
  ClearanceLevel,
  Role,
} from '@enterprise-ai/shared-types';

describe('Ingestion Pipeline & Vector Indexing Integration Tests', () => {
  const TEST_COLLECTION = 'test_pipeline_chunks';
  const mockUserId = '671350a12f3e8b0012345678';
  let documentStoragePath: string;

  beforeAll(async () => {
    EmbeddingFactory.setProvider(new MockEmbeddingProvider(768));
    await QdrantService.ensureCollection(TEST_COLLECTION, 768);
  });

  afterAll(async () => {
    EmbeddingFactory.setProvider(null);
    try {
      const client = QdrantService.getClient();
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore cleanup error
    }
  });

  beforeEach(async () => {
    await DocumentModel.deleteMany({});
    await DocumentChunkModel.deleteMany({});
  });

  it('1. End-to-end ingestion pipeline: parses, chunks, embeds, indexes in Qdrant, and marks document READY', async () => {
    const documentText =
      'Executive Summary: Enterprise AI Copilot architecture.\n\n' +
      'Data Security: All vectors are tagged with clearance and department ACLs.\n\n' +
      'High Availability: MongoDB replica set, Redis queue, and Qdrant cluster.';

    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'architecture.txt'
    );
    documentStoragePath = storagePath;

    const doc = await DocumentModel.create({
      title: 'Architecture Overview',
      originalFilename: 'architecture.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_pipeline_test_hash_1',
      status: DocumentStatus.QUEUED,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [Role.USER, Role.ADMIN],
        allowedDepartments: ['Engineering'],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    const mockJob: any = {
      id: 'job_1',
      data: { documentId: doc._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    // Run the pipeline worker
    await IngestionWorker.processJob(mockJob);

    // 1. Verify Document state in MongoDB
    const updatedDoc = await DocumentModel.findById(doc._id);
    expect(updatedDoc).toBeDefined();
    expect(updatedDoc!.status).toBe(DocumentStatus.READY);
    expect(updatedDoc!.chunkCount).toBeGreaterThan(0);
    expect(updatedDoc!.tokenCount).toBeGreaterThan(0);
    expect(updatedDoc!.errorMessage).toBeNull();

    // 2. Verify DocumentChunks in MongoDB
    const chunks = await DocumentChunkModel.find({ documentId: doc._id });
    expect(chunks.length).toBe(updatedDoc!.chunkCount);
    expect(chunks[0].vectorId).toBeDefined();
    expect(chunks[0].content.length).toBeGreaterThan(0);
    expect(chunks[0].accessControl.minimumClearance).toBe(ClearanceLevel.INTERNAL);

    // 3. Verify points in Qdrant
    const client = QdrantService.getClient();
    const qdrantPoints = await client.retrieve(TEST_COLLECTION, {
      ids: [chunks[0].vectorId],
      with_payload: true,
      with_vector: true,
    });

    // Note: If QDRANT_COLLECTION_NAME in env is different from TEST_COLLECTION,
    // worker uses env.QDRANT_COLLECTION_NAME. Let's verify points in that collection:
    const defaultCollection = process.env.QDRANT_COLLECTION_NAME || 'enterprise_knowledge_chunks';
    const pointsInDefault = await client.retrieve(defaultCollection, {
      ids: [chunks[0].vectorId],
      with_payload: true,
    });

    expect(pointsInDefault.length).toBe(1);
    expect(pointsInDefault[0].payload?.document_id).toBe(doc._id.toString());
    expect(pointsInDefault[0].payload?.minimum_clearance_level).toBe(1); // INTERNAL
    expect(pointsInDefault[0].payload?.allowed_departments).toEqual(['Engineering']);
    expect(pointsInDefault[0].payload?.is_active).toBe(true);
  });

  it('2. Repeated processing (re-indexing) is idempotent and does not create duplicate chunks or vectors', async () => {
    const documentText = 'Re-index test document content with multiple paragraphs.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'reindex.txt'
    );

    const doc = await DocumentModel.create({
      title: 'Reindex Test',
      originalFilename: 'reindex.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_reindex_test_hash',
      status: DocumentStatus.QUEUED,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    const mockJob: any = {
      id: 'job_reindex_1',
      data: { documentId: doc._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    // Run first time
    await IngestionWorker.processJob(mockJob);
    const initialChunks = await DocumentChunkModel.countDocuments({ documentId: doc._id });

    // Run second time (simulating worker re-delivery or retry)
    await IngestionWorker.processJob(mockJob);
    const afterChunks = await DocumentChunkModel.countDocuments({ documentId: doc._id });

    // Chunk count must be identical, not doubled
    expect(afterChunks).toBe(initialChunks);
    const updated = await DocumentModel.findById(doc._id);
    expect(updated!.currentRevision).toBeGreaterThanOrEqual(1);
  });

  it('3. Failure recovery: marks document FAILED on final attempt and cleans up partial vectors for un-indexed document', async () => {
    // Non-existent storage file
    const doc = await DocumentModel.create({
      title: 'Missing File Doc',
      originalFilename: 'missing.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: 100,
      storagePath: '/non/existent/path/file.txt',
      fileHash: 'sha256_missing_file_hash',
      status: DocumentStatus.QUEUED,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    const mockJobFinalAttempt: any = {
      id: 'job_fail_final',
      data: { documentId: doc._id.toString() },
      attemptsMade: 2, // 3rd attempt
      opts: { attempts: 3 },
    };

    // Worker will throw and mark FAILED
    await expect(IngestionWorker.processJob(mockJobFinalAttempt)).rejects.toThrow();

    const failedDoc = await DocumentModel.findById(doc._id);
    expect(failedDoc!.status).toBe(DocumentStatus.FAILED);
    expect(failedDoc!.errorMessage).toContain('Processing failed');

    // Chunks in MongoDB must be empty
    const chunks = await DocumentChunkModel.countDocuments({ documentId: doc._id });
    expect(chunks).toBe(0);
  });

  it('4. Blue/Green Safe Re-indexing: active READY document and vectors remain intact when re-index fails during embedding', async () => {
    const documentText = 'Initial valid content for active document version.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'active_doc.txt'
    );

    // Initial indexing to READY status (revision 1)
    const doc = await DocumentModel.create({
      title: 'Active Document',
      originalFilename: 'active_doc.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_active_doc_hash',
      status: DocumentStatus.QUEUED,
      currentRevision: 1,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    await IngestionWorker.processJob({
      id: 'job_rev1',
      data: { documentId: doc._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    const readyDoc = await DocumentModel.findById(doc._id);
    expect(readyDoc!.status).toBe(DocumentStatus.READY);
    expect(readyDoc!.currentRevision).toBe(1);

    const rev1Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 1 });
    expect(rev1Chunks.length).toBeGreaterThan(0);

    // Simulate failure during embedding for re-indexing (revision 2)
    const mockProvider = new MockEmbeddingProvider(768);
    jest.spyOn(mockProvider, 'embedBatch').mockRejectedValueOnce(new Error('Simulated upstream AI provider outage'));
    EmbeddingFactory.setProvider(mockProvider);

    const reindexJob: any = {
      id: 'job_rev2_fail',
      data: { documentId: doc._id.toString() },
      attemptsMade: 2, // Final attempt
      opts: { attempts: 3 },
    };

    await expect(IngestionWorker.processJob(reindexJob)).rejects.toThrow('Simulated upstream AI provider outage');

    // CRITICAL RELIABILITY CHECK: Active revision 1 must NOT be destroyed!
    const preservedDoc = await DocumentModel.findById(doc._id);
    expect(preservedDoc!.status).toBe(DocumentStatus.READY); // Document remains READY!
    expect(preservedDoc!.currentRevision).toBe(1);
    expect(preservedDoc!.stagedRevision).toBeNull();

    // Revision 1 chunks must still exist in MongoDB
    const remainingRev1Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 1 });
    expect(remainingRev1Chunks.length).toBe(rev1Chunks.length);

    // Staged revision 2 chunks must be 0
    const rev2Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 2 });
    expect(rev2Chunks.length).toBe(0);

    // Restore mock provider
    EmbeddingFactory.setProvider(new MockEmbeddingProvider(768));
  });

  it('5. Safe recovery: partial Qdrant failure cleans up staged revision without affecting active revision', async () => {
    const documentText = 'Initial stable content.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'stable_doc.txt'
    );

    const doc = await DocumentModel.create({
      title: 'Stable Document',
      originalFilename: 'stable_doc.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_stable_doc_hash',
      status: DocumentStatus.QUEUED,
      currentRevision: 1,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    // Successfully index revision 1
    await IngestionWorker.processJob({
      id: 'job_stable_1',
      data: { documentId: doc._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    // Mock QdrantService.upsertPoints to throw on re-index
    const upsertSpy = jest.spyOn(QdrantService, 'upsertPoints').mockRejectedValueOnce(new Error('Qdrant network timeout'));

    const reindexJob: any = {
      id: 'job_reindex_partial_fail',
      data: { documentId: doc._id.toString() },
      attemptsMade: 2,
      opts: { attempts: 3 },
    };

    await expect(IngestionWorker.processJob(reindexJob)).rejects.toThrow('Qdrant network timeout');

    const preserved = await DocumentModel.findById(doc._id);
    expect(preserved!.status).toBe(DocumentStatus.READY);
    expect(preserved!.currentRevision).toBe(1);

    // Active chunks intact
    const activeChunks = await DocumentChunkModel.countDocuments({ documentId: doc._id, revision: 1 });
    expect(activeChunks).toBeGreaterThan(0);

    upsertSpy.mockRestore();
  });

  it('6. Stale job protection: older superseded revision cannot overwrite or corrupt a newer revision', async () => {
    const documentText = 'Stale job protection test content.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'stale_test.txt'
    );

    const doc = await DocumentModel.create({
      title: 'Stale Test Doc',
      originalFilename: 'stale_test.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_stale_test_hash',
      status: DocumentStatus.READY,
      currentRevision: 3, // Already advanced to revision 3 by a newer job
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    // Create chunks for revision 3
    await DocumentChunkModel.create({
      documentId: doc._id,
      chunkIndex: 0,
      revision: 3,
      content: 'Revision 3 active chunk',
      tokenCount: 5,
      vectorId: '6ba7b810-9dad-11d1-80b4-00c04fd43099',
      metadata: { title: 'Stale Test Doc' },
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    // Delayed stale job targeting revision 2 arrives
    const staleJob: any = {
      id: 'job_stale_rev2',
      data: { documentId: doc._id.toString(), revision: 2 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    // Stale job should process safely and discard revision 2 without overwriting revision 3
    await IngestionWorker.processJob(staleJob);

    const currentDoc = await DocumentModel.findById(doc._id);
    expect(currentDoc!.currentRevision).toBe(3); // Preserved at revision 3!

    // Revision 2 chunks must have been discarded
    const rev2Count = await DocumentChunkModel.countDocuments({ documentId: doc._id, revision: 2 });
    expect(rev2Count).toBe(0);

    // Revision 3 chunks remain
    const rev3Count = await DocumentChunkModel.countDocuments({ documentId: doc._id, revision: 3 });
    expect(rev3Count).toBe(1);
  });

  it('7. Concurrency: Two competing revisions completing in Order 1 (Rev 2 finishes, then Rev 3 finishes)', async () => {
    const documentText = 'Competing revisions test content for Order 1.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'competing_order1.txt'
    );

    // Initial indexing to READY (rev 1)
    const doc = await DocumentModel.create({
      title: 'Competing Order 1',
      originalFilename: 'competing_order1.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_competing_order1_hash',
      status: DocumentStatus.QUEUED,
      currentRevision: 1,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    await IngestionWorker.processJob({
      id: 'job_order1_rev1',
      data: { documentId: doc._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    // Step A: Job for Rev 2 runs and finishes first
    await IngestionWorker.processJob({
      id: 'job_order1_rev2',
      data: { documentId: doc._id.toString(), revision: 2 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    const docAfterRev2 = await DocumentModel.findById(doc._id);
    expect(docAfterRev2!.currentRevision).toBe(2);
    expect(docAfterRev2!.status).toBe(DocumentStatus.READY);

    const rev2Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 2 });
    expect(rev2Chunks.length).toBeGreaterThan(0);

    // Step B: Job for Rev 3 runs and finishes second
    await IngestionWorker.processJob({
      id: 'job_order1_rev3',
      data: { documentId: doc._id.toString(), revision: 3 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    const docAfterRev3 = await DocumentModel.findById(doc._id);
    expect(docAfterRev3!.currentRevision).toBe(3);
    expect(docAfterRev3!.status).toBe(DocumentStatus.READY);

    // Persisted MongoDB verification: Rev 3 chunks exist, Rev 2 chunks cleaned up
    const rev3Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 3 });
    expect(rev3Chunks.length).toBeGreaterThan(0);

    const remainingRev2Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 2 });
    expect(remainingRev2Chunks.length).toBe(0);

    // Persisted Qdrant points verification: Rev 3 points exist
    const client = QdrantService.getClient();
    const defaultCollection = process.env.QDRANT_COLLECTION_NAME || 'enterprise_knowledge_chunks';
    const rev3Points = await client.retrieve(defaultCollection, {
      ids: [rev3Chunks[0].vectorId],
      with_payload: true,
    });
    expect(rev3Points.length).toBe(1);
    expect(rev3Points[0].payload?.revision).toBe(3);

    // Rev 2 points in Qdrant must be purged
    const rev2Points = await client.retrieve(defaultCollection, {
      ids: [rev2Chunks[0].vectorId],
    });
    expect(rev2Points.length).toBe(0);
  });

  it('8. Concurrency: Two competing revisions completing in Order 2 (Newer Rev 3 finishes BEFORE older Rev 2)', async () => {
    const documentText = 'Competing revisions test content for Order 2.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'competing_order2.txt'
    );

    // Initial indexing to READY (rev 1)
    const doc = await DocumentModel.create({
      title: 'Competing Order 2',
      originalFilename: 'competing_order2.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_competing_order2_hash',
      status: DocumentStatus.QUEUED,
      currentRevision: 1,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    await IngestionWorker.processJob({
      id: 'job_order2_rev1',
      data: { documentId: doc._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    // Step A: Job for Rev 3 finishes first
    await IngestionWorker.processJob({
      id: 'job_order2_rev3',
      data: { documentId: doc._id.toString(), revision: 3 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    const docAfterRev3 = await DocumentModel.findById(doc._id);
    expect(docAfterRev3!.currentRevision).toBe(3);

    const rev3Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 3 });
    expect(rev3Chunks.length).toBeGreaterThan(0);

    // Step B: Delayed Job for Rev 2 finishes second
    await IngestionWorker.processJob({
      id: 'job_order2_rev2_delayed',
      data: { documentId: doc._id.toString(), revision: 2 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    // CRITICAL: Persisted state must remain at Rev 3!
    const docAfterDelayedRev2 = await DocumentModel.findById(doc._id);
    expect(docAfterDelayedRev2!.currentRevision).toBe(3);

    // Rev 2 chunks must NOT be present in MongoDB
    const rev2Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 2 });
    expect(rev2Chunks.length).toBe(0);

    // Rev 3 chunks remain intact in MongoDB
    const remainingRev3Chunks = await DocumentChunkModel.find({ documentId: doc._id, revision: 3 });
    expect(remainingRev3Chunks.length).toBe(rev3Chunks.length);

    // Qdrant verification: Rev 3 points exist
    const client = QdrantService.getClient();
    const defaultCollection = process.env.QDRANT_COLLECTION_NAME || 'enterprise_knowledge_chunks';
    const rev3Points = await client.retrieve(defaultCollection, {
      ids: [rev3Chunks[0].vectorId],
      with_payload: true,
    });
    expect(rev3Points.length).toBe(1);
    expect(rev3Points[0].payload?.revision).toBe(3);
  });

  it('9. Concurrency: Older revision cannot overwrite active revision when document is in PROCESSING status', async () => {
    const documentText = 'Processing status CAS guard test.';
    const { storagePath } = await StorageService.saveFile(
      Buffer.from(documentText, 'utf-8'),
      'cas_processing.txt'
    );

    // Document is currently at revision 2, but in PROCESSING status (a newer re-index was queued/started)
    const doc = await DocumentModel.create({
      title: 'CAS Processing Guard',
      originalFilename: 'cas_processing.txt',
      mimeType: DocumentMimeType.TXT,
      fileSizeBytes: Buffer.byteLength(documentText),
      storagePath,
      fileHash: 'sha256_cas_processing_hash',
      status: DocumentStatus.PROCESSING, // Not READY!
      currentRevision: 2,
      stagedRevision: 3,
      uploadedBy: mockUserId as any,
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    // Create chunks for active revision 2
    await DocumentChunkModel.create({
      documentId: doc._id,
      chunkIndex: 0,
      revision: 2,
      content: 'Revision 2 chunk content',
      tokenCount: 5,
      vectorId: '6ba7b810-9dad-11d1-80b4-00c04fd43077',
      metadata: { title: 'CAS Processing Guard' },
      accessControl: {
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      },
    });

    // A stale job targeting revision 1 attempts to finish
    const staleJobRev1: any = {
      id: 'job_stale_rev1_racing',
      data: { documentId: doc._id.toString(), revision: 1 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    await IngestionWorker.processJob(staleJobRev1);

    // CRITICAL: Document currentRevision must NOT be demoted to 1!
    const docAfterStale = await DocumentModel.findById(doc._id);
    expect(docAfterStale!.currentRevision).toBe(2);

    // Revision 1 chunks must NOT exist
    const rev1Count = await DocumentChunkModel.countDocuments({ documentId: doc._id, revision: 1 });
    expect(rev1Count).toBe(0);

    // Revision 2 chunks remain
    const rev2Count = await DocumentChunkModel.countDocuments({ documentId: doc._id, revision: 2 });
    expect(rev2Count).toBe(1);
  });
});
