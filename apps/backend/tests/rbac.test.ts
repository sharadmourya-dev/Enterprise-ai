import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { Role, ClearanceLevel, IJwtPayload } from '@enterprise-ai/shared-types';

describe('RBAC & Security Clearance Enforcement', () => {
  function createTestToken(role: Role, securityClearance: ClearanceLevel): string {
    const payload: IJwtPayload = {
      sub: '507f1f77bcf86cd799439011',
      email: 'test@enterprise.com',
      role,
      department: 'Engineering',
      securityClearance,
      sessionId: 'test_session_id',
    };

    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  describe('Role-Based Access Control (RBAC)', () => {
    it('should deny regular USER access to admin-only endpoint with 403 Forbidden', async () => {
      const userToken = createTestToken(Role.USER, ClearanceLevel.INTERNAL);

      const res = await request(app)
        .get('/api/v1/test/admin-only')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE_PERMISSIONS');
    });

    it('should allow ADMIN access to admin-only endpoint', async () => {
      const adminToken = createTestToken(Role.ADMIN, ClearanceLevel.INTERNAL);

      const res = await request(app)
        .get('/api/v1/test/admin-only')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Admin access granted');
    });

    it('should allow SUPER_ADMIN access to admin-only endpoint', async () => {
      const superAdminToken = createTestToken(Role.SUPER_ADMIN, ClearanceLevel.RESTRICTED);

      const res = await request(app)
        .get('/api/v1/test/admin-only')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('Hierarchical Security Clearance Enforcement', () => {
    it('should deny user with INTERNAL clearance access to CONFIDENTIAL endpoint (403)', async () => {
      const internalToken = createTestToken(Role.USER, ClearanceLevel.INTERNAL);

      const res = await request(app)
        .get('/api/v1/test/confidential-clearance')
        .set('Authorization', `Bearer ${internalToken}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_SECURITY_CLEARANCE');
    });

    it('should allow user with CONFIDENTIAL clearance access to CONFIDENTIAL endpoint (200)', async () => {
      const confidentialToken = createTestToken(Role.USER, ClearanceLevel.CONFIDENTIAL);

      const res = await request(app)
        .get('/api/v1/test/confidential-clearance')
        .set('Authorization', `Bearer ${confidentialToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should allow user with higher RESTRICTED clearance access to CONFIDENTIAL endpoint (200)', async () => {
      const restrictedToken = createTestToken(Role.USER, ClearanceLevel.RESTRICTED);

      const res = await request(app)
        .get('/api/v1/test/confidential-clearance')
        .set('Authorization', `Bearer ${restrictedToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
