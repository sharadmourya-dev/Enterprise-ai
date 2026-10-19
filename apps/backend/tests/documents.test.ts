import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { UserModel } from '../src/models/User.model.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { DocumentChunkModel } from '../src/models/DocumentChunk.model.js';
import { env } from '../src/config/env.js';
import { Role, ClearanceLevel, DocumentStatus, IJwtPayload } from '@enterprise-ai/shared-types';

describe('Document Upload, Lifecycle & Authorization API Integration Tests', () => {
  const userInternalId = '671350a12f3e8b0012345671';
  const userConfidentialId = '671350a12f3e8b0012345672';
  const adminId = '671350a12f3e8b0012345673';

  function createTestToken(
    userId: string,
    role: Role,
    clearance: ClearanceLevel,
    department: string
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

  const userInternalToken = createTestToken(
    userInternalId,
    Role.USER,
    ClearanceLevel.INTERNAL,
    'Engineering'
  );
  const userConfidentialToken = createTestToken(
    userConfidentialId,
    Role.USER,
    ClearanceLevel.CONFIDENTIAL,
    'Executive'
  );
  const adminToken = createTestToken(
    adminId,
    Role.SUPER_ADMIN,
    ClearanceLevel.RESTRICTED,
    'IT'
  );

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DocumentModel.deleteMany({});
    await DocumentChunkModel.deleteMany({});
  });

  describe('POST /api/v1/documents/upload', () => {
    it('1. Uploads valid text document successfully and enqueues background processing', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Enterprise security policies and engineering guidelines.'), 'guidelines.txt')
        .field('title', 'Corporate Guidelines')
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.data.documentId).toBeDefined();
      expect(res.body.data.status).toBe(DocumentStatus.QUEUED);
      expect(res.body.data.jobId).toBeDefined();

      const savedDoc = await DocumentModel.findById(res.body.data.documentId);
      expect(savedDoc).toBeDefined();
      expect(savedDoc!.title).toBe('Corporate Guidelines');
      expect(savedDoc!.uploadedBy.toString()).toBe(userInternalId);
      expect(savedDoc!.status).toBe(DocumentStatus.QUEUED);
    });

    it('2. Rejects upload without authentication token with 401', async () => {
      await request(app)
        .post('/api/v1/documents/upload')
        .attach('file', Buffer.from('Unauthenticated content'), 'notes.txt')
        .expect(401);
    });

    it('3. Rejects unsupported file format (.exe) with 400', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('binary payload'), 'malicious.exe')
        .expect(400);

      expect(res.body.error.message).toContain('Unsupported file format');
    });

    it('4. Rejects spoofed PDF (executable disguised as .pdf) with 400', async () => {
      const fakePdf = Buffer.from('MZ\x90\x00Not a real PDF');
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', fakePdf, 'fake.pdf')
        .expect(400);

      expect(res.body.error.message).toContain('does not have %PDF- header');
    });

    it('5. Rejects privilege escalation: user cannot set clearance exceeding own rank', async () => {
      // Alice has INTERNAL clearance; attempting to upload as RESTRICTED must fail
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Top secret research material.'), 'classified.txt')
        .field('minimumClearance', ClearanceLevel.RESTRICTED)
        .expect(403);

      expect(res.body.error.message).toContain('exceeding your own clearance');
    });

    it('6. Rejects duplicate upload by the same user with 409 Conflict', async () => {
      const fileContent = 'Unique policy text for duplicate detection test.';

      // First upload
      await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from(fileContent), 'policy_v1.txt')
        .expect(202);

      // Second upload with identical bytes
      const dupRes = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from(fileContent), 'policy_v2.txt')
        .expect(409);

      expect(dupRes.body.error.message).toContain('identical content has already been uploaded');
    });
  });

  describe('GET /api/v1/documents/:id and GET /api/v1/documents', () => {
    let internalDocId: string;
    let confidentialDocId: string;

    beforeEach(async () => {
      // Upload INTERNAL document by Alice
      const res1 = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Engineering handbook.'), 'handbook.txt')
        .field('title', 'Engineering Handbook');
      internalDocId = res1.body.data.documentId;

      // Upload CONFIDENTIAL document by Carol
      const res2 = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userConfidentialToken}`)
        .attach('file', Buffer.from('Financial projections for Q4.'), 'projections.txt')
        .field('title', 'Financial Projections')
        .field('minimumClearance', ClearanceLevel.CONFIDENTIAL);
      confidentialDocId = res2.body.data.documentId;
    });

    it('1. User with INTERNAL clearance cannot view CONFIDENTIAL document (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${confidentialDocId}`)
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(403);

      expect(res.body.error.message).toContain('Insufficient security clearance');
    });

    it('2. User with CONFIDENTIAL clearance can view CONFIDENTIAL document', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${confidentialDocId}`)
        .set('Authorization', `Bearer ${userConfidentialToken}`)
        .expect(200);

      expect(res.body.data.title).toBe('Financial Projections');
    });

    it('3. Admin can view all documents regardless of clearance', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${confidentialDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.title).toBe('Financial Projections');
    });

    it('4. Listing documents filters out items exceeding user clearance level', async () => {
      // Alice listing documents: should see only Engineering Handbook, not Financial Projections
      const aliceList = await request(app)
        .get('/api/v1/documents')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(200);

      expect(aliceList.body.data.documents.length).toBe(1);
      expect(aliceList.body.data.documents[0].title).toBe('Engineering Handbook');

      // Carol listing documents: can see both INTERNAL and CONFIDENTIAL
      const carolList = await request(app)
        .get('/api/v1/documents')
        .set('Authorization', `Bearer ${userConfidentialToken}`)
        .expect(200);

      expect(carolList.body.data.documents.length).toBe(2);
    });

    it('5. Listing documents filters out documents restricted to other departments, roles, or users even with matching clearance', async () => {
      // Create a document with INTERNAL clearance, but restricted to 'HR' department
      await DocumentModel.create({
        title: 'HR Benefits Summary',
        originalFilename: 'hr.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        storagePath: './data/uploads/hr.txt',
        fileHash: 'hash_hr_123',
        status: DocumentStatus.READY,
        uploadedBy: adminId,
        accessControl: {
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedDepartments: ['HR'],
          allowedRoles: [],
          allowedUserIds: [],
        },
      });

      // Create a document with INTERNAL clearance, but restricted to Role.COMPLIANCE_OFFICER
      await DocumentModel.create({
        title: 'Compliance Audit Checklist',
        originalFilename: 'compliance.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        storagePath: './data/uploads/comp.txt',
        fileHash: 'hash_comp_123',
        status: DocumentStatus.READY,
        uploadedBy: adminId,
        accessControl: {
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedDepartments: [],
          allowedRoles: [Role.COMPLIANCE_OFFICER],
          allowedUserIds: [],
        },
      });

      // Create a document restricted to a specific user ID
      await DocumentModel.create({
        title: 'Specific User Letter',
        originalFilename: 'letter.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        storagePath: './data/uploads/letter.txt',
        fileHash: 'hash_letter_123',
        status: DocumentStatus.READY,
        uploadedBy: adminId,
        accessControl: {
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedDepartments: [],
          allowedRoles: [],
          allowedUserIds: [userConfidentialId],
        },
      });

      // Alice (Engineering, Role.USER, userInternalId) requests document list:
      // Must NOT see HR Benefits, Compliance Checklist, or Specific User Letter
      const aliceRes = await request(app)
        .get('/api/v1/documents')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(200);

      const returnedTitles = aliceRes.body.data.documents.map((d: any) => d.title);
      expect(returnedTitles).toContain('Engineering Handbook');
      expect(returnedTitles).not.toContain('HR Benefits Summary');
      expect(returnedTitles).not.toContain('Compliance Audit Checklist');
      expect(returnedTitles).not.toContain('Specific User Letter');
    });

    it('6. Rejects non-admin attempting to query documents belonging to a foreign department', async () => {
      // Alice is in Engineering; querying ?department=HR must return 403 Forbidden
      const res = await request(app)
        .get('/api/v1/documents?department=HR')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(403);

      expect(res.body.error.message).toContain('not authorized to filter documents belonging to other departments');
    });

    it('7. Direct GET /api/v1/documents/:id rejects access when user does not match department, role, or user ID', async () => {
      const hrDoc = await DocumentModel.create({
        title: 'Restricted HR Doc',
        originalFilename: 'hr.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        storagePath: './data/uploads/hr2.txt',
        fileHash: 'hash_hr_234',
        status: DocumentStatus.READY,
        uploadedBy: adminId,
        accessControl: {
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedDepartments: ['HR'],
          allowedRoles: [],
          allowedUserIds: [],
        },
      });

      // Alice (Engineering) tries to get HR doc by ID
      const resDept = await request(app)
        .get(`/api/v1/documents/${hrDoc._id}`)
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(403);

      expect(resDept.body.error.message).toContain('restricted to departments: [HR]');
    });
  });

  describe('Upload ACL Manipulation Prevention', () => {
    it('1. Rejects non-admin attempting to assign document to foreign department', async () => {
      // Alice is in Engineering; cannot upload with allowedDepartments: ['Finance']
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Finance document'), 'finance.txt')
        .field('allowedDepartments', 'Finance')
        .expect(403);

      expect(res.body.error.message).toContain('Cannot assign document to foreign department');
    });

    it('2. Rejects non-admin attempting to assign document to privileged role', async () => {
      // Alice is Role.USER; cannot upload with allowedRoles: ['admin']
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Admin document'), 'admin_doc.txt')
        .field('allowedRoles', Role.ADMIN)
        .expect(403);

      expect(res.body.error.message).toContain('Cannot assign document to role');
    });

    it('3. Rejects non-admin attempting to specify allowedUserIds', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Confidential document'), 'target.txt')
        .field('allowedUserIds', userConfidentialId)
        .expect(403);

      expect(res.body.error.message).toContain('Only administrators can configure user-specific access restrictions');
    });
  });

  describe('POST /api/v1/documents/:id/retry and DELETE /api/v1/documents/:id', () => {
    it('1. Cannot retry document that is not in FAILED status (400 Bad Request)', async () => {
      const uploadRes = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Retry test doc.'), 'retry.txt');

      const docId = uploadRes.body.data.documentId;

      const res = await request(app)
        .post(`/api/v1/documents/${docId}/retry`)
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(400);

      expect(res.body.error.message).toContain('Only FAILED documents can be retried');
    });

    it('2. Successfully retries a FAILED document, transitioning status to QUEUED', async () => {
      const uploadRes = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Failed test doc.'), 'failed.txt');

      const docId = uploadRes.body.data.documentId;

      // Manually set status to FAILED in MongoDB
      await DocumentModel.updateOne({ _id: docId }, { status: DocumentStatus.FAILED, errorMessage: 'Timeout' });

      const retryRes = await request(app)
        .post(`/api/v1/documents/${docId}/retry`)
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(200);

      expect(retryRes.body.data.jobId).toBeDefined();

      const updated = await DocumentModel.findById(docId);
      expect(updated!.status).toBe(DocumentStatus.QUEUED);
      expect(updated!.errorMessage).toBeNull();
    });

    it('3. Deletes document and cleans up database record', async () => {
      const uploadRes = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Document to delete.'), 'delete_me.txt');

      const docId = uploadRes.body.data.documentId;

      await request(app)
        .delete(`/api/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${userInternalToken}`)
        .expect(200);

      const deletedDoc = await DocumentModel.findById(docId);
      expect(deletedDoc).toBeNull();
    });

    it('4. Regular user cannot delete document owned by someone else (403 Forbidden)', async () => {
      const uploadRes = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${userInternalToken}`)
        .attach('file', Buffer.from('Alice document.'), 'alice_doc.txt');

      const docId = uploadRes.body.data.documentId;

      // Carol attempts to delete Alice's document
      await request(app)
        .delete(`/api/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${userConfidentialToken}`)
        .expect(403);

      const stillExists = await DocumentModel.findById(docId);
      expect(stillExists).toBeDefined();
    });
  });
});
