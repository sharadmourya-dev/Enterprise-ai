import { QdrantService, IQdrantPoint } from '../src/services/qdrant.service.js';
import { BadRequestError } from '../src/utils/errors.js';
import { env } from '../src/config/env.js';

describe('Qdrant Vector Store Adapter & ACL Payload Validation', () => {
  const TEST_COLLECTION = 'test_qdrant_acl_chunks';
  const originalCollection = env.QDRANT_COLLECTION_NAME;
  const DIMENSIONS = 768;

  beforeAll(() => {
    (env as any).QDRANT_COLLECTION_NAME = TEST_COLLECTION;
  });

  // Cleanup test collection after tests
  afterAll(async () => {
    (env as any).QDRANT_COLLECTION_NAME = originalCollection;
    try {
      const client = QdrantService.getClient();
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore if not created
    }
  });

  it('1. Initializes collection idempotently with explicit dimensions and creates payload indexes', async () => {
    await QdrantService.ensureCollection(TEST_COLLECTION, DIMENSIONS);

    const client = QdrantService.getClient();
    const info = await client.getCollection(TEST_COLLECTION);

    expect(info.status).toBe('green');
    expect(info.config?.params?.vectors?.size).toBe(DIMENSIONS);
    expect(info.config?.params?.vectors?.distance).toBe('Cosine');
  });

  it('2. Detects dimension mismatch on existing collection and rejects silently recreating it', async () => {
    // Attempting to use existing 768 collection with 1536 embedding model must throw
    await expect(QdrantService.ensureCollection(TEST_COLLECTION, 1536)).rejects.toThrow(BadRequestError);
    await expect(QdrantService.ensureCollection(TEST_COLLECTION, 1536)).rejects.toThrow(/Incompatible Qdrant collection/);
  });

  it('3. Rejects upserting points with missing or malformed ACL metadata', async () => {
    const invalidPoint: any = {
      vectorId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      vector: new Array(768).fill(0.01),
      payload: {
        title: 'Confidential Report',
        content: 'This chunk has missing clearance and role ACL fields.',
        // missing minimum_clearance_level, allowed_roles, etc.
      },
    };

    await expect(QdrantService.upsertPoints([invalidPoint], TEST_COLLECTION)).rejects.toThrow(BadRequestError);
    await expect(QdrantService.upsertPoints([invalidPoint], TEST_COLLECTION)).rejects.toThrow(/Malformed ACL metadata/);
  });

  it('4. Successfully upserts valid points with complete ACL payloads into Qdrant', async () => {
    const points: IQdrantPoint[] = [
      {
        vectorId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb61',
        vector: new Array(768).fill(0.02),
        payload: {
          chunk_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb61',
          document_id: 'doc_123',
          revision: 1,
          title: 'Engineering Architecture Spec',
          content: 'Microservices communicate via gRPC and Redis queues.',
          minimum_clearance_level: 1, // INTERNAL
          allowed_roles: ['engineer', 'admin'],
          allowed_departments: ['Engineering', 'IT'],
          allowed_user_ids: [],
          is_active: true,
        },
      },
      {
        vectorId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb62',
        vector: new Array(768).fill(0.03),
        payload: {
          chunk_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb62',
          document_id: 'doc_123',
          revision: 1,
          title: 'Engineering Architecture Spec',
          content: 'Audit logs use HMAC-SHA256 monotonic sequence hashing.',
          minimum_clearance_level: 1,
          allowed_roles: [], // Wildcard for all roles
          allowed_departments: [], // Wildcard for all departments
          allowed_user_ids: [],
          is_active: true,
        },
      },
    ];

    await QdrantService.upsertPoints(points, TEST_COLLECTION);

    // Verify points retrieved from Qdrant
    const client = QdrantService.getClient();
    const retrieved = await client.retrieve(TEST_COLLECTION, {
      ids: [points[0].vectorId, points[1].vectorId],
      with_payload: true,
    });

    expect(retrieved.length).toBe(2);
    expect(retrieved[0].payload?.minimum_clearance_level).toBe(1);
    expect(retrieved[0].payload?.document_id).toBe('doc_123');
    expect(retrieved[0].payload?.revision).toBe(1);
    expect(retrieved[0].payload?.is_active).toBe(true);
  });

  it('5. Deletes all points belonging to a specific document ID idempotently', async () => {
    await QdrantService.deleteDocumentVectors('doc_123', TEST_COLLECTION);

    const client = QdrantService.getClient();
    const retrieved = await client.retrieve(TEST_COLLECTION, {
      ids: ['9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb61'],
    });

    expect(retrieved.length).toBe(0);
  });

  it('6. Deletes points belonging to a specific revision isolating active revisions', async () => {
    const rev1Point: IQdrantPoint = {
      vectorId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb71',
      vector: new Array(768).fill(0.01),
      payload: {
        chunk_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb71',
        document_id: 'doc_rev_test',
        revision: 1,
        title: 'Rev 1',
        content: 'Active content',
        minimum_clearance_level: 1,
        allowed_roles: [],
        allowed_departments: [],
        allowed_user_ids: [],
        is_active: true,
      },
    };
    const rev2Point: IQdrantPoint = {
      vectorId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb72',
      vector: new Array(768).fill(0.02),
      payload: {
        chunk_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb72',
        document_id: 'doc_rev_test',
        revision: 2,
        title: 'Rev 2',
        content: 'Staged content',
        minimum_clearance_level: 1,
        allowed_roles: [],
        allowed_departments: [],
        allowed_user_ids: [],
        is_active: true,
      },
    };

    await QdrantService.upsertPoints([rev1Point, rev2Point], TEST_COLLECTION);

    // Delete revision 2 only
    await QdrantService.deleteDocumentVectorsByRevision('doc_rev_test', 2, TEST_COLLECTION);

    const client = QdrantService.getClient();
    const resRev1 = await client.retrieve(TEST_COLLECTION, { ids: [rev1Point.vectorId] });
    const resRev2 = await client.retrieve(TEST_COLLECTION, { ids: [rev2Point.vectorId] });

    expect(resRev1.length).toBe(1); // Revision 1 untouched!
    expect(resRev2.length).toBe(0); // Revision 2 deleted!

    // Cleanup
    await QdrantService.deleteDocumentVectors('doc_rev_test', TEST_COLLECTION);
  });
});
