import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { DocumentChunkModel } from '../src/models/DocumentChunk.model.js';
import { StorageService } from '../src/services/storage.service.js';
import { QdrantService } from '../src/services/qdrant.service.js';
import { AuditService } from '../src/services/audit.service.js';
import { RagCacheService } from '../src/services/cache/rag-cache.service.js';
import { openapiSpecification } from '../src/docs/swagger.js';
import {
  Role,
  ClearanceLevel,
  DocumentStatus,
  DocumentMimeType,
  IJwtPayload,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';

describe('Phase 3B — Admin Document Deletion Parity & Authorization Regression Tests', () => {
  const adminUserId = new mongoose.Types.ObjectId().toString();
  const superAdminUserId = new mongoose.Types.ObjectId().toString();
  const regularUserId = new mongoose.Types.ObjectId().toString();
  const nonOwnerUserId = new mongoose.Types.ObjectId().toString();
  const supportAgentId = new mongoose.Types.ObjectId().toString();
  const kmUserId = new mongoose.Types.ObjectId().toString();

  const mockDocId = new mongoose.Types.ObjectId().toString();

  function createTestToken(
    userId: string,
    role = Role.USER,
    clearance = ClearanceLevel.INTERNAL,
    department = 'Engineering'
  ): string {
    const payload: IJwtPayload = {
      sub: userId,
      email: `${userId}@enterprise.com`,
      role,
      department,
      securityClearance: clearance,
      sessionId: `sess_${userId}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const adminToken = createTestToken(adminUserId, Role.ADMIN, ClearanceLevel.RESTRICTED, 'IT');
  const superAdminToken = createTestToken(superAdminUserId, Role.SUPER_ADMIN, ClearanceLevel.RESTRICTED, 'IT');
  const ownerUserToken = createTestToken(regularUserId, Role.USER, ClearanceLevel.INTERNAL, 'Engineering');
  const nonOwnerUserToken = createTestToken(nonOwnerUserId, Role.USER, ClearanceLevel.INTERNAL, 'Marketing');
  const supportAgentToken = createTestToken(supportAgentId, Role.SUPPORT_AGENT, ClearanceLevel.INTERNAL, 'Support');
  const kmToken = createTestToken(kmUserId, Role.KNOWLEDGE_MANAGER, ClearanceLevel.CONFIDENTIAL, 'Operations');

  const createMockDocument = (uploadedBy = regularUserId, status = DocumentStatus.READY) => ({
    _id: new mongoose.Types.ObjectId(mockDocId),
    title: 'Enterprise Architecture Blueprint',
    originalFilename: 'architecture_blueprint.pdf',
    mimeType: DocumentMimeType.PDF,
    fileSizeBytes: 4096,
    storagePath: 'documents/2026/architecture_blueprint.pdf',
    fileHash: 'sha256_mock_hash_blueprint_4096',
    status,
    chunkCount: 8,
    tokenCount: 2000,
    currentRevision: 1,
    processingAttempts: 1,
    uploadedBy: new mongoose.Types.ObjectId(uploadedBy),
    accessControl: {
      allowedRoles: [],
      allowedDepartments: [],
      minimumClearance: ClearanceLevel.INTERNAL,
      allowedUserIds: [],
    },
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-01-15T10:00:00Z'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditService, 'log').mockResolvedValue(null as any);
    jest.spyOn(QdrantService, 'deleteDocumentVectors').mockResolvedValue(undefined as any);
    jest.spyOn(StorageService, 'deleteFile').mockResolvedValue(undefined as any);
    jest.spyOn(RagCacheService, 'invalidateAll').mockResolvedValue(undefined as any);
    jest.spyOn(DocumentModel, 'updateOne').mockResolvedValue({} as any);
    jest.spyOn(DocumentChunkModel, 'deleteMany').mockResolvedValue({} as any);
    jest.spyOn(DocumentModel, 'findByIdAndDelete').mockResolvedValue({} as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Step 1 & 2: Route Registration and Role Enforcement
  // =========================================================================
  describe('Admin Route Registration and RBAC Enforcement', () => {
    it('1. Rejects unauthenticated request to DELETE /api/v1/admin/documents/:id with 401', async () => {
      const res = await request(app).delete(`/api/v1/admin/documents/${mockDocId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('2. Rejects request with invalid or malformed bearer token with 401', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', 'Bearer invalid.token.payload');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('3. Rejects regular user (Role.USER) even if document owner with 403 Forbidden', async () => {
      // The admin route strictly enforces requireRole(Role.ADMIN, Role.SUPER_ADMIN)
      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${ownerUserToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('INSUFFICIENT_ROLE_PERMISSIONS');
    });

    it('4. Rejects Support Agent (Role.SUPPORT_AGENT) with 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${supportAgentToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('INSUFFICIENT_ROLE_PERMISSIONS');
    });

    it('5. Rejects Knowledge Manager (Role.KNOWLEDGE_MANAGER) with 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${kmToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('INSUFFICIENT_ROLE_PERMISSIONS');
    });
  });

  // =========================================================================
  // 2. Step 2: Admin Deletion Delegation, Validation & Full Cleanup
  // =========================================================================
  describe('Admin Deletion Execution, Validation & Cleanup', () => {
    it('6. Rejects malformed document ID with 400 Bad Request', async () => {
      const res = await request(app)
        .delete('/api/v1/admin/documents/not-a-valid-object-id')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/invalid document id format/i);
    });

    it('7. Returns 404 Not Found when document does not exist in database', async () => {
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(null);

      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .delete(`/api/v1/admin/documents/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/document not found/i);
    });

    it('8. Successfully deletes document when invoked by Role.ADMIN with complete cleanup & audit', async () => {
      const mockDoc = createMockDocument(regularUserId);
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);

      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/deleted successfully/i);

      // 1. Verify status updated to DELETING
      expect(DocumentModel.updateOne).toHaveBeenCalledWith(
        { _id: mockDoc._id },
        { $set: { status: DocumentStatus.DELETING } }
      );

      // 2. Verify Qdrant vectors deletion
      expect(QdrantService.deleteDocumentVectors).toHaveBeenCalledWith(mockDocId);

      // 3. Verify chunk records deletion
      expect(DocumentChunkModel.deleteMany).toHaveBeenCalledWith({ documentId: mockDoc._id });

      // 4. Verify local file storage deletion
      expect(StorageService.deleteFile).toHaveBeenCalledWith(mockDoc.storagePath);

      // 5. Verify document entity deletion from MongoDB
      expect(DocumentModel.findByIdAndDelete).toHaveBeenCalledWith(mockDoc._id);

      // 6. Verify audit log entry
      expect(AuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: adminUserId,
          action: AuditAction.DOC_DELETE,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: mockDocId,
          status: 'success',
          details: expect.objectContaining({
            documentId: mockDocId,
            title: mockDoc.title,
          }),
        })
      );

      // 7. Verify RAG cache invalidation
      expect(RagCacheService.invalidateAll).toHaveBeenCalled();
    });

    it('9. Successfully deletes document when invoked by Role.SUPER_ADMIN', async () => {
      const mockDoc = createMockDocument(regularUserId);
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);

      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(DocumentModel.findByIdAndDelete).toHaveBeenCalledWith(mockDoc._id);
      expect(AuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: superAdminUserId,
          action: AuditAction.DOC_DELETE,
          status: 'success',
        })
      );
    });

    it('10. Gracefully handles vector deletion error without failing document cleanup', async () => {
      const mockDoc = createMockDocument(regularUserId);
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);
      jest.spyOn(QdrantService, 'deleteDocumentVectors').mockRejectedValue(new Error('Qdrant unreachable'));

      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Even if vector deletion encountered an error, database and storage cleanup still executed
      expect(DocumentChunkModel.deleteMany).toHaveBeenCalledWith({ documentId: mockDoc._id });
      expect(StorageService.deleteFile).toHaveBeenCalledWith(mockDoc.storagePath);
      expect(DocumentModel.findByIdAndDelete).toHaveBeenCalledWith(mockDoc._id);
    });
  });

  // =========================================================================
  // 3. Step 2 & 3: Canonical Endpoint Preservation & Authorization Invariance
  // =========================================================================
  describe('Canonical Route (/api/v1/documents/:id) Equivalence & Parity', () => {
    it('11. Canonical endpoint allows document owner (Role.USER) to delete their own document', async () => {
      const mockDoc = createMockDocument(regularUserId); // owned by regularUserId
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);

      const res = await request(app)
        .delete(`/api/v1/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${ownerUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(DocumentModel.findByIdAndDelete).toHaveBeenCalledWith(mockDoc._id);
    });

    it('12. Canonical endpoint rejects non-owner (Role.USER) attempting to delete another user document with 403', async () => {
      const mockDoc = createMockDocument(regularUserId); // owned by regularUserId, caller is nonOwnerUserId
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);

      const res = await request(app)
        .delete(`/api/v1/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${nonOwnerUserToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(DocumentModel.findByIdAndDelete).not.toHaveBeenCalled();

      // Confirms audit log recorded access denial
      expect(AuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: nonOwnerUserId,
          action: AuditAction.AUTH_ACCESS_DENIED,
          resourceType: AuditResourceType.DOCUMENT,
          status: 'denied',
        })
      );
    });

    it('13. Canonical endpoint allows Role.ADMIN to delete any document', async () => {
      const mockDoc = createMockDocument(regularUserId); // owned by regular user
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);

      const res = await request(app)
        .delete(`/api/v1/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(DocumentModel.findByIdAndDelete).toHaveBeenCalledWith(mockDoc._id);
    });
  });

  // =========================================================================
  // 4. Step 3: Authorization Regression Audit
  // =========================================================================
  describe('Authorization Regression Audit (Registration & Privilege Escalation)', () => {
    it('14. Public registration rejects any attempt to self-assign admin role with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'escalation.attempt@enterprise.com',
          password: 'Password123!',
          name: 'Attacker User',
          department: 'Engineering',
          role: 'admin', // Injected privilege escalation field
        });

      // Strict Zod schema rejects unrecognized properties with 422 VALIDATION_ERROR
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('15. Public registration rejects any attempt to self-assign elevated clearance with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'clearance.attempt@enterprise.com',
          password: 'Password123!',
          name: 'Attacker User',
          department: 'Engineering',
          securityClearance: 'TOP_SECRET', // Injected privilege escalation field
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('16. Sensitive data hygiene: audit logs and error responses do not leak sensitive credentials or tokens', async () => {
      const mockDoc = createMockDocument(regularUserId);
      jest.spyOn(DocumentModel, 'findById').mockResolvedValue(mockDoc as any);

      const res = await request(app)
        .delete(`/api/v1/admin/documents/${mockDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // Verify audit call payload contains no password, token, or secret keys
      const auditCalls = (AuditService.log as jest.Mock).mock.calls;
      for (const [auditEntry] of auditCalls) {
        expect(auditEntry.details).not.toHaveProperty('password');
        expect(auditEntry.details).not.toHaveProperty('passwordHash');
        expect(auditEntry.details).not.toHaveProperty('token');
        expect(auditEntry.details).not.toHaveProperty('accessToken');
        expect(auditEntry.details).not.toHaveProperty('refreshToken');
      }

      // Verify response body contains no sensitive properties
      expect(res.body).not.toHaveProperty('token');
      expect(res.body).not.toHaveProperty('password');
    });
  });

  // =========================================================================
  // 5. OpenAPI Parity Verification
  // =========================================================================
  describe('OpenAPI Specification Parity', () => {
    it('17. openapiSpecification documents /api/v1/admin/documents/{id} delete operation', () => {
      const pathDef = (openapiSpecification.paths as any)['/api/v1/admin/documents/{id}'];
      expect(pathDef).toBeDefined();
      expect(pathDef.delete).toBeDefined();
      expect(pathDef.delete.tags).toContain('Admin - Documents');
      expect(pathDef.delete.security).toEqual([{ bearerAuth: [] }]);
      expect(pathDef.delete.responses['200']).toBeDefined();
      expect(pathDef.delete.responses['401']).toBeDefined();
      expect(pathDef.delete.responses['403']).toBeDefined();
      expect(pathDef.delete.responses['404']).toBeDefined();
    });
  });
});
