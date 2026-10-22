import mongoose from 'mongoose';
import {
  RetrievalService,
} from '../src/services/retrieval.service.js';
import { QdrantService, IQdrantPoint } from '../src/services/qdrant.service.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { EmbeddingFactory } from '../src/services/embeddings/embedding.factory.js';
import { MockEmbeddingProvider } from '../src/services/embeddings/mock.embedding.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  CLEARANCE_RANK,
  DocumentStatus,
  DocumentMimeType,
} from '@enterprise-ai/shared-types';
import { ForbiddenError, BadGatewayError } from '../src/utils/errors.js';
import { env } from '../src/config/env.js';

describe('Secure Retrieval Service & Multi-Dimensional Authorization Filter Tests', () => {
  const TEST_COLLECTION = 'test_retrieval_secure_chunks';
  const originalCollection = env.QDRANT_COLLECTION_NAME;
  const DIMENSIONS = 768;

  beforeAll(async () => {
    (env as any).QDRANT_COLLECTION_NAME = TEST_COLLECTION;
    EmbeddingFactory.setProvider(new MockEmbeddingProvider(DIMENSIONS));
    await QdrantService.ensureCollection(TEST_COLLECTION, DIMENSIONS);
  });

  afterAll(async () => {
    EmbeddingFactory.setProvider(null);
    (env as any).QDRANT_COLLECTION_NAME = originalCollection;
    try {
      const client = QdrantService.getClient();
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Ignore if not present
    }
  });

  describe('Authorization Filter Construction (Unit Tests)', () => {
    it('1. Throws ForbiddenError when user context is null, undefined, or missing required claims', () => {
      expect(() => RetrievalService.buildQdrantFilter(null as any)).toThrow(ForbiddenError);
      expect(() => RetrievalService.buildQdrantFilter({} as any)).toThrow(ForbiddenError);

      const missingSub: any = {
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
      };
      expect(() => RetrievalService.buildQdrantFilter(missingSub)).toThrow(ForbiddenError);

      const invalidRole: any = {
        sub: 'u1',
        role: 'invalid_role',
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
      };
      expect(() => RetrievalService.buildQdrantFilter(invalidRole)).toThrow(ForbiddenError);

      const missingDept: any = {
        sub: 'u1',
        role: Role.USER,
        securityClearance: ClearanceLevel.INTERNAL,
      };
      expect(() => RetrievalService.buildQdrantFilter(missingDept)).toThrow(ForbiddenError);

      const emptyDept: any = {
        sub: 'u1',
        role: Role.USER,
        department: '   ',
        securityClearance: ClearanceLevel.INTERNAL,
      };
      expect(() => RetrievalService.buildQdrantFilter(emptyDept)).toThrow(ForbiddenError);

      const invalidClearance: any = {
        sub: 'u1',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: 'top_secret',
      };
      expect(() => RetrievalService.buildQdrantFilter(invalidClearance)).toThrow(ForbiddenError);
    });

    it('2. Correctly constructs native Qdrant filter conjoining is_active, clearance, role, department, and user wildcards', () => {
      const user: IJwtPayload = {
        sub: 'user_dev_01',
        email: 'dev@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_1',
      };

      const filter = RetrievalService.buildQdrantFilter(user);

      expect(filter).toHaveProperty('must');
      const must = filter.must as Array<any>;
      expect(Array.isArray(must)).toBe(true);

      // Must require is_active: true
      const activeClause = must.find((c) => c.key === 'is_active');
      expect(activeClause).toEqual({ key: 'is_active', match: { value: true } });

      // Must enforce clearance rank <= 1 (INTERNAL)
      const clearanceClause = must.find((c) => c.key === 'minimum_clearance_level');
      expect(clearanceClause).toEqual({
        key: 'minimum_clearance_level',
        range: { lte: CLEARANCE_RANK[ClearanceLevel.INTERNAL] },
      });

      // Role wildcard clause (empty OR matches 'user')
      const roleClause = must.find(
        (c) => c.should && c.should.some((s: any) => s.key === 'allowed_roles' || s.is_empty?.key === 'allowed_roles')
      );
      expect(roleClause.should).toEqual([
        { is_empty: { key: 'allowed_roles' } },
        { key: 'allowed_roles', match: { value: Role.USER } },
      ]);

      // Department wildcard clause (empty OR matches 'Engineering')
      const deptClause = must.find(
        (c) => c.should && c.should.some((s: any) => s.key === 'allowed_departments' || s.is_empty?.key === 'allowed_departments')
      );
      expect(deptClause.should).toEqual([
        { is_empty: { key: 'allowed_departments' } },
        { key: 'allowed_departments', match: { value: 'Engineering' } },
      ]);

      // User ID wildcard clause (empty OR matches 'user_dev_01')
      const userClause = must.find(
        (c) => c.should && c.should.some((s: any) => s.key === 'allowed_user_ids' || s.is_empty?.key === 'allowed_user_ids')
      );
      expect(userClause.should).toEqual([
        { is_empty: { key: 'allowed_user_ids' } },
        { key: 'allowed_user_ids', match: { value: 'user_dev_01' } },
      ]);
    });
  });

  describe('Secure Vector Retrieval & Active-Revision Validation (Integration)', () => {
    const doc1Id = new mongoose.Types.ObjectId().toString(); // Public, open to all
    const doc2Id = new mongoose.Types.ObjectId().toString(); // Internal, Engineering only
    const doc3Id = new mongoose.Types.ObjectId().toString(); // Internal, HR only
    const doc4Id = new mongoose.Types.ObjectId().toString(); // Confidential, Executive Admin only
    const doc5Id = new mongoose.Types.ObjectId().toString(); // Restricted, IT, user_special only
    const doc6Id = new mongoose.Types.ObjectId().toString(); // Stale Revision: doc is at rev 2, chunk is at rev 1
    const doc7Id = new mongoose.Types.ObjectId().toString(); // Inactive / deleted in MongoDB

    const uploaderId = new mongoose.Types.ObjectId();

    beforeAll(async () => {
      // 1. Seed MongoDB Document records
      await DocumentModel.deleteMany({});

      await DocumentModel.create([
        {
          _id: doc1Id,
          title: 'Company Handbook',
          originalFilename: 'handbook.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 1024,
          storagePath: 'dummy.pdf',
          fileHash: 'hash_doc_1',
          status: DocumentStatus.READY,
          currentRevision: 1,
          chunkCount: 1,
          tokenCount: 100,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [],
            allowedDepartments: [],
            minimumClearance: ClearanceLevel.PUBLIC,
            allowedUserIds: [],
          },
        },
        {
          _id: doc2Id,
          title: 'Engineering Best Practices',
          originalFilename: 'eng_practices.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 2048,
          storagePath: 'dummy2.pdf',
          fileHash: 'hash_doc_2',
          status: DocumentStatus.READY,
          currentRevision: 1,
          chunkCount: 1,
          tokenCount: 200,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [],
            allowedDepartments: ['Engineering'],
            minimumClearance: ClearanceLevel.INTERNAL,
            allowedUserIds: [],
          },
        },
        {
          _id: doc3Id,
          title: 'HR Employee Benefits Guide',
          originalFilename: 'hr_benefits.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 2048,
          storagePath: 'dummy3.pdf',
          fileHash: 'hash_doc_3',
          status: DocumentStatus.READY,
          currentRevision: 1,
          chunkCount: 1,
          tokenCount: 200,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [],
            allowedDepartments: ['HR'],
            minimumClearance: ClearanceLevel.INTERNAL,
            allowedUserIds: [],
          },
        },
        {
          _id: doc4Id,
          title: 'Executive Financial Forecast 2026',
          originalFilename: 'finances.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 4096,
          storagePath: 'dummy4.pdf',
          fileHash: 'hash_doc_4',
          status: DocumentStatus.READY,
          currentRevision: 1,
          chunkCount: 1,
          tokenCount: 300,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [Role.ADMIN],
            allowedDepartments: ['Executive'],
            minimumClearance: ClearanceLevel.CONFIDENTIAL,
            allowedUserIds: [],
          },
        },
        {
          _id: doc5Id,
          title: 'Restricted Key Management Procedure',
          originalFilename: 'key_mgmt.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 512,
          storagePath: 'dummy5.pdf',
          fileHash: 'hash_doc_5',
          status: DocumentStatus.READY,
          currentRevision: 1,
          chunkCount: 1,
          tokenCount: 150,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [],
            allowedDepartments: ['IT'],
            minimumClearance: ClearanceLevel.RESTRICTED,
            allowedUserIds: [new mongoose.Types.ObjectId('671350a12f3e8b0012345999')],
          },
        },
        {
          _id: doc6Id,
          title: 'Infrastructure Runbook',
          originalFilename: 'runbook.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 1024,
          storagePath: 'dummy6.pdf',
          fileHash: 'hash_doc_6',
          status: DocumentStatus.READY,
          currentRevision: 2, // Doc updated to revision 2!
          chunkCount: 1,
          tokenCount: 100,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [],
            allowedDepartments: [],
            minimumClearance: ClearanceLevel.INTERNAL,
            allowedUserIds: [],
          },
        },
        {
          _id: doc7Id,
          title: 'Quarantined Document',
          originalFilename: 'deleted.pdf',
          mimeType: DocumentMimeType.PDF,
          fileSizeBytes: 1024,
          storagePath: 'dummy7.pdf',
          fileHash: 'hash_doc_7',
          status: DocumentStatus.DELETING, // NOT in READY status!
          currentRevision: 1,
          chunkCount: 1,
          tokenCount: 100,
          uploadedBy: uploaderId,
          accessControl: {
            allowedRoles: [],
            allowedDepartments: [],
            minimumClearance: ClearanceLevel.PUBLIC,
            allowedUserIds: [],
          },
        },
      ]);

      // 2. Index points in Qdrant with identical vector (similarity 1.0) for deterministic testing
      const mockVector = new Array(DIMENSIONS).fill(0.05);

      const points: IQdrantPoint[] = [
        {
          vectorId: '11111111-1111-1111-1111-111111111111',
          vector: mockVector,
          payload: {
            chunk_id: '11111111-1111-1111-1111-111111111111',
            document_id: doc1Id,
            revision: 1,
            title: 'Company Handbook',
            content: 'Company core values and general mission statement.',
            minimum_clearance_level: 0,
            allowed_roles: [],
            allowed_departments: [],
            allowed_user_ids: [],
            is_active: true,
          },
        },
        {
          vectorId: '22222222-2222-2222-2222-222222222222',
          vector: mockVector,
          payload: {
            chunk_id: '22222222-2222-2222-2222-222222222222',
            document_id: doc2Id,
            revision: 1,
            title: 'Engineering Best Practices',
            content: 'Git workflows, code reviews, and automated CI pipelines.',
            minimum_clearance_level: 1,
            allowed_roles: [],
            allowed_departments: ['Engineering'],
            allowed_user_ids: [],
            is_active: true,
          },
        },
        {
          vectorId: '33333333-3333-3333-3333-333333333333',
          vector: mockVector,
          payload: {
            chunk_id: '33333333-3333-3333-3333-333333333333',
            document_id: doc3Id,
            revision: 1,
            title: 'HR Employee Benefits Guide',
            content: 'Health insurance policies, PTO accrual, and parental leave.',
            minimum_clearance_level: 1,
            allowed_roles: [],
            allowed_departments: ['HR'],
            allowed_user_ids: [],
            is_active: true,
          },
        },
        {
          vectorId: '44444444-4444-4444-4444-444444444444',
          vector: mockVector,
          payload: {
            chunk_id: '44444444-4444-4444-4444-444444444444',
            document_id: doc4Id,
            revision: 1,
            title: 'Executive Financial Forecast 2026',
            content: 'Confidential EBITDA projections and venture financing allocations.',
            minimum_clearance_level: 2,
            allowed_roles: [Role.ADMIN],
            allowed_departments: ['Executive'],
            allowed_user_ids: [],
            is_active: true,
          },
        },
        {
          vectorId: '55555555-5555-5555-5555-555555555555',
          vector: mockVector,
          payload: {
            chunk_id: '55555555-5555-5555-5555-555555555555',
            document_id: doc5Id,
            revision: 1,
            title: 'Restricted Key Management Procedure',
            content: 'Master cryptographic HSM backup keys and physical safe codes.',
            minimum_clearance_level: 3,
            allowed_roles: [],
            allowed_departments: ['IT'],
            allowed_user_ids: ['671350a12f3e8b0012345999'],
            is_active: true,
          },
        },
        {
          vectorId: '66666666-6666-6666-6666-666666666666',
          vector: mockVector,
          payload: {
            chunk_id: '66666666-6666-6666-6666-666666666666',
            document_id: doc6Id,
            revision: 1, // Stale revision (doc is at rev 2)
            title: 'Infrastructure Runbook',
            content: 'Outdated server deployment commands from revision 1.',
            minimum_clearance_level: 1,
            allowed_roles: [],
            allowed_departments: [],
            allowed_user_ids: [],
            is_active: true,
          },
        },
        {
          vectorId: '77777777-7777-7777-7777-777777777777',
          vector: mockVector,
          payload: {
            chunk_id: '77777777-7777-7777-7777-777777777777',
            document_id: doc7Id,
            revision: 1,
            title: 'Quarantined Document',
            content: 'Quarantined data that was soft-deleted or marked deleting.',
            minimum_clearance_level: 0,
            allowed_roles: [],
            allowed_departments: [],
            allowed_user_ids: [],
            is_active: true,
          },
        },
        {
          vectorId: '88888888-8888-8888-8888-888888888888',
          vector: mockVector,
          payload: {
            chunk_id: '88888888-8888-8888-8888-888888888888',
            document_id: doc1Id,
            revision: 1,
            title: 'Inactive Chunk',
            content: 'This chunk has is_active false and must never be retrieved.',
            minimum_clearance_level: 0,
            allowed_roles: [],
            allowed_departments: [],
            allowed_user_ids: [],
            is_active: false, // Inactive point
          },
        },
      ];

      await QdrantService.upsertPoints(points, TEST_COLLECTION);
    });

    it('3. Engineering user retrieves only Public and Engineering docs (excludes HR, Executive, Restricted, Stale, and Deleting docs)', async () => {
      const engUser: IJwtPayload = {
        sub: 'user_eng_1',
        email: 'eng1@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_eng',
      };

      const result = await RetrievalService.search('best practices', engUser, {
        collectionName: TEST_COLLECTION,
        similarityThreshold: 0.1,
      });

      const docIds = result.candidates.map((c) => c.documentId);

      // Must include Public doc1 and Engineering doc2
      expect(docIds).toContain(doc1Id);
      expect(docIds).toContain(doc2Id);

      // Must strictly exclude unauthorized and invalid docs
      expect(docIds).not.toContain(doc3Id); // HR
      expect(docIds).not.toContain(doc4Id); // Executive Confidential
      expect(docIds).not.toContain(doc5Id); // Restricted
      expect(docIds).not.toContain(doc6Id); // Stale revision
      expect(docIds).not.toContain(doc7Id); // Deleting doc
      expect(result.candidates.some((c) => !c.isActive)).toBe(false); // Inactive point excluded
    });

    it('4. HR user with identical clearance (INTERNAL) retrieves HR docs but NOT Engineering docs', async () => {
      const hrUser: IJwtPayload = {
        sub: 'user_hr_1',
        email: 'hr1@enterprise.com',
        role: Role.USER,
        department: 'HR',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_hr',
      };

      const result = await RetrievalService.search('benefits and policy', hrUser, {
        collectionName: TEST_COLLECTION,
        similarityThreshold: 0.1,
      });

      const docIds = result.candidates.map((c) => c.documentId);

      expect(docIds).toContain(doc1Id); // Public
      expect(docIds).toContain(doc3Id); // HR
      expect(docIds).not.toContain(doc2Id); // Engineering excluded for HR user!
      expect(docIds).not.toContain(doc4Id); // Executive Confidential excluded
    });

    it('5. Executive Admin user retrieves Confidential documents matching Executive department and Admin role', async () => {
      const execAdmin: IJwtPayload = {
        sub: 'user_exec_admin',
        email: 'exec@enterprise.com',
        role: Role.ADMIN,
        department: 'Executive',
        securityClearance: ClearanceLevel.CONFIDENTIAL,
        sessionId: 'sess_exec',
      };

      const result = await RetrievalService.search('financial forecast', execAdmin, {
        collectionName: TEST_COLLECTION,
        similarityThreshold: 0.1,
      });

      const docIds = result.candidates.map((c) => c.documentId);

      expect(docIds).toContain(doc1Id); // Public
      expect(docIds).toContain(doc4Id); // Executive Confidential doc
      expect(docIds).not.toContain(doc5Id); // Restricted doc excluded (clearance rank 2 < 3)
    });

    it('6. Restricted user specific restriction: Only designated user ID can retrieve restricted document', async () => {
      // General IT admin with RESTRICTED clearance but different user ID
      const otherItAdmin: IJwtPayload = {
        sub: 'other_it_admin_id',
        email: 'it_other@enterprise.com',
        role: Role.ADMIN,
        department: 'IT',
        securityClearance: ClearanceLevel.RESTRICTED,
        sessionId: 'sess_it1',
      };

      const otherResult = await RetrievalService.search('master cryptographic keys', otherItAdmin, {
        collectionName: TEST_COLLECTION,
        similarityThreshold: 0.1,
      });

      const otherDocIds = otherResult.candidates.map((c) => c.documentId);
      expect(otherDocIds).not.toContain(doc5Id); // Excluded because sub !== 671350a12f3e8b0012345999

      // Authorized user designated in allowed_user_ids
      const authorizedUser: IJwtPayload = {
        sub: '671350a12f3e8b0012345999',
        email: 'key_custodian@enterprise.com',
        role: Role.USER,
        department: 'IT',
        securityClearance: ClearanceLevel.RESTRICTED,
        sessionId: 'sess_it2',
      };

      const authResult = await RetrievalService.search('master cryptographic keys', authorizedUser, {
        collectionName: TEST_COLLECTION,
        similarityThreshold: 0.1,
      });

      const authDocIds = authResult.candidates.map((c) => c.documentId);
      expect(authDocIds).toContain(doc5Id); // Successfully retrieved for designated user!
    });

    it('7. Rejects candidates below similarity threshold', async () => {
      const engUser: IJwtPayload = {
        sub: 'user_eng_1',
        email: 'eng1@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_eng',
      };

      // Set similarity threshold to 1.1 (impossible for cosine similarity <= 1.0)
      const result = await RetrievalService.search('test query', engUser, {
        collectionName: TEST_COLLECTION,
        similarityThreshold: 1.1,
      });

      expect(result.candidates).toHaveLength(0);
    });

    it('8. Returns empty candidates safely for blank or whitespace query', async () => {
      const engUser: IJwtPayload = {
        sub: 'user_eng_1',
        email: 'eng1@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_eng',
      };

      const result = await RetrievalService.search('   ', engUser, {
        collectionName: TEST_COLLECTION,
      });

      expect(result.candidates).toHaveLength(0);
      expect(result.timings.embeddingMs).toBe(0);
    });

    it('9. Embedding provider error during retrieval throws BadGatewayError and never falls back to an unfiltered search', async () => {
      const engUser: IJwtPayload = {
        sub: 'user_eng_1',
        email: 'eng1@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_eng',
      };

      const failingProvider = {
        name: 'failing_mock',
        dimensions: DIMENSIONS,
        embedText: jest.fn().mockRejectedValue(new Error('Embedding API rate limit or outage')),
        embedBatch: jest.fn(),
      };
      EmbeddingFactory.setProvider(failingProvider as any);

      await expect(
        RetrievalService.search('best practices', engUser, {
          collectionName: TEST_COLLECTION,
        })
      ).rejects.toThrow(BadGatewayError);

      // Restore provider
      EmbeddingFactory.setProvider(new MockEmbeddingProvider(DIMENSIONS));
    });

    it('10. Vector database query failure throws BadGatewayError and never falls back to an unfiltered search', async () => {
      const engUser: IJwtPayload = {
        sub: 'user_eng_1',
        email: 'eng1@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_eng',
      };

      const client = QdrantService.getClient();
      const originalQuery = client.query.bind(client);
      const querySpy = jest.spyOn(client, 'query').mockRejectedValueOnce(new Error('Connection refused to Qdrant cluster'));

      await expect(
        RetrievalService.search('best practices', engUser, {
          collectionName: TEST_COLLECTION,
        })
      ).rejects.toThrow(BadGatewayError);

      querySpy.mockRestore();
    });
  });
});
