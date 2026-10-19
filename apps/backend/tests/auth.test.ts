import request from 'supertest';
import { app } from '../src/app.js';
import { UserModel } from '../src/models/User.model.js';
import { SessionModel } from '../src/models/Session.model.js';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';

describe('Authentication & Session Management API', () => {
  beforeEach(async () => {
    await UserModel.deleteMany({});
    await SessionModel.deleteMany({});
  });

  const validRegistration = {
    email: 'alice.support@enterprise.com',
    password: 'SecurePassword123!',
    name: 'Alice Support',
    department: 'Customer Support',
  };

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user with enforced Role.USER and ClearanceLevel.INTERNAL', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(validRegistration.email);
      expect(res.body.data.name).toBe(validRegistration.name);
      expect(res.body.data.role).toBe(Role.USER);
      expect(res.body.data.securityClearance).toBe(ClearanceLevel.INTERNAL);
      expect(res.body.data.passwordHash).toBeUndefined();

      // Verify in DB that password is encrypted
      const user = await UserModel.findOne({ email: validRegistration.email });
      expect(user).toBeDefined();
      expect(user!.passwordHash).not.toBe(validRegistration.password);
      expect(user!.passwordHash.startsWith('$2')).toBe(true);
    });

    it('should strictly reject privilege escalation attempts in public registration payload', async () => {
      const maliciousPayload = {
        ...validRegistration,
        email: 'attacker@enterprise.com',
        role: Role.SUPER_ADMIN,
        securityClearance: ClearanceLevel.RESTRICTED,
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(maliciousPayload)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject duplicate email registration with 409 Conflict', async () => {
      await request(app).post('/api/v1/auth/register').send(validRegistration).expect(201);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(validRegistration)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(validRegistration);
    });

    it('should authenticate valid credentials and return access + refresh tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: validRegistration.email,
          password: validRegistration.password,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(validRegistration.email);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.tokens.expiresIn).toBe(900);
    });

    it('should reject invalid password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: validRegistration.email,
          password: 'WrongPassword!',
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/v1/auth/refresh & Replay Attack Detection', () => {
    let initialRefreshToken: string;
    let initialAccessToken: string;

    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(validRegistration);
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: validRegistration.email,
        password: validRegistration.password,
      });
      initialRefreshToken = loginRes.body.data.tokens.refreshToken;
      initialAccessToken = loginRes.body.data.tokens.accessToken;
    });

    it('should successfully rotate refresh token and issue new token pair', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialRefreshToken })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.refreshToken).not.toBe(initialRefreshToken);
    });

    it('should detect token replay and revoke all active sessions if an already-rotated token is reused', async () => {
      // 1. Legitimate rotation
      const rotateRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialRefreshToken })
        .expect(200);

      const legitimateNewRefreshToken = rotateRes.body.data.refreshToken;

      // Fast-forward rotation grace window to simulate replay attack outside the in-flight grace period
      await SessionModel.updateOne({}, { rotationGraceUntil: new Date(Date.now() - 1000) });

      // 2. Attacker attempts to replay the OLD refresh token
      const replayRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialRefreshToken })
        .expect(401);

      expect(replayRes.body.success).toBe(false);
      expect(replayRes.body.error.message).toContain('replay');

      // 3. Verify legitimate session was ALSO revoked due to security breach isolation
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: legitimateNewRefreshToken })
        .expect(401);
    });
  });

  describe('GET /api/v1/auth/me & Logout', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(validRegistration);
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: validRegistration.email,
        password: validRegistration.password,
      });
      accessToken = loginRes.body.data.tokens.accessToken;
      refreshToken = loginRes.body.data.tokens.refreshToken;
    });

    it('should retrieve profile with valid bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(validRegistration.email);
    });

    it('should reject request without bearer token', async () => {
      const res = await request(app).get('/api/v1/auth/me').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('should invalidate refresh token upon logout', async () => {
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Attempting to refresh after logout must fail
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });
});
