import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { AuditLogModel, AuditCounterModel, AuditChainHeadModel } from '../src/models/AuditLog.model.js';
import { AuditService } from '../src/services/audit.service.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';

describe('Phase 6 — Workstream D: Admin Audit Verification & Reporting Integration Tests', () => {
  const adminId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();

  function createToken(sub: string, role: Role): string {
    const payload: IJwtPayload = {
      sub,
      email: `${sub}@enterprise.com`,
      role,
      department: 'Security',
      securityClearance: ClearanceLevel.RESTRICTED,
      sessionId: `sess_${sub}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const adminToken = createToken(adminId, Role.ADMIN);
  const userToken = createToken(userId, Role.USER);

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await AuditCounterModel.deleteMany({});
    await AuditChainHeadModel.deleteMany({});
  });

  describe('D1. Authorization & Role Guards', () => {
    it('1. Rejects unauthenticated verification requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/admin/audit/verify');
      expect(res.status).toBe(401);
    });

    it('2. Denies regular users from verifying audit chain with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit/verify')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('3. Denies regular users from listing audit logs with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit/logs')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('D2. Cryptographic Chain Verification Endpoint', () => {
    it('4. Allows admin to verify valid audit chain and returns status details', async () => {
      // Seed 3 valid audit log entries through AuditService
      await AuditService.log({
        userId: adminId,
        action: AuditAction.AUTH_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: adminId,
        status: 'success',
      });

      await AuditService.log({
        userId: adminId,
        action: AuditAction.DOC_UPLOAD,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: 'doc_123',
        status: 'success',
      });

      await AuditService.log({
        userId: adminId,
        action: AuditAction.RAG_QUERY,
        resourceType: AuditResourceType.SYSTEM,
        resourceId: 'query_123',
        status: 'success',
      });

      const res = await request(app)
        .get('/api/v1/admin/audit/verify')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isValid).toBe(true);
      expect(res.body.data.totalVerified).toBe(3);
      expect(res.body.data.processIsolationNotice).toContain('process-local');
    });

    it('5. Detects payload tampering and identifies compromised sequence number', async () => {
      await AuditService.log({
        userId: adminId,
        action: AuditAction.AUTH_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: adminId,
        status: 'success',
      });

      await AuditService.log({
        userId: adminId,
        action: AuditAction.DOC_UPLOAD,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: 'doc_target',
        status: 'success',
      });

      // Deliberately tamper with record sequence 2 in MongoDB
      await AuditLogModel.updateOne(
        { sequenceNumber: 2 },
        { $set: { status: 'denied' } } // Tampering action/status without updating tamperHash
      );

      const res = await request(app)
        .get('/api/v1/admin/audit/verify')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isValid).toBe(false);
      expect(res.body.data.atSequence).toBe(2);
      expect(res.body.data.error).toContain('TAMPER_DETECTED');
    });
  });

  describe('D3. Bounded Audit Log Listing & Filtering', () => {
    it('6. Allows admin to query audit logs with pagination and filters', async () => {
      await AuditService.log({
        userId: adminId,
        action: AuditAction.AUTH_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: adminId,
        status: 'success',
      });

      await AuditService.log({
        userId: adminId,
        action: AuditAction.DOC_DELETE,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: 'doc_deleted_99',
        status: 'success',
      });

      const res = await request(app)
        .get('/api/v1/admin/audit/logs?limit=10&action=document.delete')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.logs.length).toBe(1);
      expect(res.body.data.logs[0].action).toBe(AuditAction.DOC_DELETE);
      expect(res.body.data.pagination.total).toBe(1);
    });

    it('7. Rejects invalid filter parameters with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit/logs?action=invalid.action.enum')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });
});
