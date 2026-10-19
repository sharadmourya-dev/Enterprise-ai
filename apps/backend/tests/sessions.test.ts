import crypto from 'crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { UserModel } from '../src/models/User.model.js';
import { SessionModel } from '../src/models/Session.model.js';
import { AuthService } from '../src/services/auth.service.js';

describe('Multi-Device Sessions & Concurrency-Safe Refresh Token Rotation', () => {
  const testUser = {
    email: 'bob.engineer@enterprise.com',
    password: 'SecurePassword123!',
    name: 'Bob Engineer',
    department: 'Engineering',
  };

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await SessionModel.deleteMany({});
    await request(app).post('/api/v1/auth/register').send(testUser);
  });

  // 1. Sequential refresh successfully rotates the token and advances tokenVersion
  it('1. Sequential refresh successfully rotates the token and inspects persisted session state', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    const token0 = loginRes.body.data.tokens.refreshToken;
    const session0 = await SessionModel.findOne();
    expect(session0).toBeDefined();
    expect(session0!.tokenVersion).toBe(0);
    expect(session0!.refreshTokenHash).toBe(AuthService.hashToken(token0));
    expect(session0!.previousTokenHash).toBeNull();

    // First rotation
    const refresh1Res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token0 })
      .expect(200);

    const token1 = refresh1Res.body.data.refreshToken;
    expect(token1).not.toBe(token0);

    const session1 = await SessionModel.findOne();
    expect(session1!.tokenVersion).toBe(1);
    expect(session1!.refreshTokenHash).toBe(AuthService.hashToken(token1));
    expect(session1!.previousTokenHash).toBe(AuthService.hashToken(token0));
    expect(session1!.rotationGraceUntil!.getTime()).toBeGreaterThan(Date.now());

    // Second rotation
    const refresh2Res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token1 })
      .expect(200);

    const token2 = refresh2Res.body.data.refreshToken;
    expect(token2).not.toBe(token1);

    const session2 = await SessionModel.findOne();
    expect(session2!.tokenVersion).toBe(2);
    expect(session2!.refreshTokenHash).toBe(AuthService.hashToken(token2));
    expect(session2!.previousTokenHash).toBe(AuthService.hashToken(token1));
  });

  // 2 & 3 & 4. Concurrency-safe atomic rotation, no orphaned tokens, no account-wide logout
  it('2, 3 & 4. Concurrent refresh requests atomically rotate once, return identical valid token pair, and prevent orphaned tokens', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    const originalToken = loginRes.body.data.tokens.refreshToken;

    // Simulate two simultaneous requests presenting the exact same active refresh token
    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').send({ refreshToken: originalToken }),
      request(app).post('/api/v1/auth/refresh').send({ refreshToken: originalToken }),
    ]);

    // Both requests must complete successfully with 200 OK
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Requirement: Both concurrent requests must receive the EXACT SAME valid credentials
    expect(res1.body.data.refreshToken).toBe(res2.body.data.refreshToken);
    expect(res1.body.data.accessToken).toBe(res2.body.data.accessToken);

    const activeToken = res1.body.data.refreshToken;

    // Requirement: Inspect persisted database session state
    const session = await SessionModel.findOne();
    expect(session).toBeDefined();
    expect(session!.isRevoked).toBe(false);
    // TokenVersion must be incremented exactly once (0 -> 1)
    expect(session!.tokenVersion).toBe(1);
    // Persisted active hash must match the returned token
    expect(session!.refreshTokenHash).toBe(AuthService.hashToken(activeToken));
    // Persisted previous hash must match the original token
    expect(session!.previousTokenHash).toBe(AuthService.hashToken(originalToken));
    // Grace window must be set
    expect(session!.rotationGraceUntil!.getTime()).toBeGreaterThan(Date.now());

    // Requirement 3: No returned refresh token is unusable because its hash was never persisted.
    // Verify by taking the token returned from the concurrent racer and performing a subsequent refresh.
    const subsequentRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: res2.body.data.refreshToken })
      .expect(200);

    expect(subsequentRes.body.data.refreshToken).toBeDefined();
    expect(subsequentRes.body.data.refreshToken).not.toBe(activeToken);

    // Persisted state must have cleanly advanced to tokenVersion 2
    const sessionAfterSubsequent = await SessionModel.findOne();
    expect(sessionAfterSubsequent!.tokenVersion).toBe(2);
    expect(sessionAfterSubsequent!.refreshTokenHash).toBe(AuthService.hashToken(subsequentRes.body.data.refreshToken));

    // Requirement 4: Verify user account and sessions are NOT revoked
    const user = await UserModel.findOne({ email: testUser.email });
    expect(user!.failedLoginAttempts).toBe(0);
    expect(sessionAfterSubsequent!.isRevoked).toBe(false);
  });

  // 5. Genuinely replayed token outside concurrency grace window triggers documented account-wide revocation
  it('5. Replay of rotated token outside grace window triggers replay attack policy and revokes all sessions', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    const originalToken = loginRes.body.data.tokens.refreshToken;

    // Perform legitimate rotation
    const rotateRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalToken })
      .expect(200);

    const validNewToken = rotateRes.body.data.refreshToken;

    // Fast-forward rotationGraceUntil into the past to simulate token replay outside grace window
    await SessionModel.updateOne({}, { rotationGraceUntil: new Date(Date.now() - 5000) });

    // Attacker attempts to replay originalToken outside the grace window
    const replayRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalToken })
      .expect(401);

    expect(replayRes.body.error.message).toContain('replay detected');

    // Inspect persisted database state: all sessions for user must be revoked
    const allSessions = await SessionModel.find();
    expect(allSessions.length).toBeGreaterThan(0);
    expect(allSessions.every((s) => s.isRevoked === true)).toBe(true);
    expect(allSessions[0].revokedReason).toBe('replay_attack_detected_account_wide');
    expect(allSessions[0].encryptedActiveRefreshToken).toBeNull();
    expect(allSessions[0].activeAccessToken).toBeNull();

    // Legitimate token from winning rotation is now also unusable due to defense-in-depth revocation
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: validNewToken })
      .expect(401);
  });

  // 6. One session's rotation and logout do not invalidate unrelated sessions
  it('6. Independent multi-device session isolation during rotation and targeted logout', async () => {
    // Device A Login (Workstation)
    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Workstation-Chrome/120')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    // Device B Login (Mobile)
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Mobile-Safari/17')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    const tokenA0 = loginA.body.data.tokens.refreshToken;
    const accessA0 = loginA.body.data.tokens.accessToken;
    const tokenB0 = loginB.body.data.tokens.refreshToken;

    const sessionAId = loginA.body.data.tokens.accessToken ? (JSON.parse(Buffer.from(accessA0.split('.')[1], 'base64').toString())).sessionId : null;
    expect(sessionAId).toBeDefined();

    // Device A rotates token
    const refreshARes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenA0 })
      .expect(200);

    const tokenA1 = refreshARes.body.data.refreshToken;
    const accessA1 = refreshARes.body.data.accessToken;

    // Verify Device B's persisted session is completely unaffected
    const sessionB = await SessionModel.findOne({ sessionId: { $ne: sessionAId } });
    expect(sessionB).toBeDefined();
    expect(sessionB!.isRevoked).toBe(false);
    expect(sessionB!.tokenVersion).toBe(0);
    expect(sessionB!.refreshTokenHash).toBe(AuthService.hashToken(tokenB0));

    // Device A logs out
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessA1}`)
      .expect(200);

    // Inspect persisted database state: Device A revoked, Device B active
    const sessionAAfterLogout = await SessionModel.findOne({ sessionId: sessionAId });
    expect(sessionAAfterLogout!.isRevoked).toBe(true);
    expect(sessionAAfterLogout!.revokedReason).toBe('user_logout');

    const sessionBAfterLogout = await SessionModel.findOne({ sessionId: sessionB!.sessionId });
    expect(sessionBAfterLogout!.isRevoked).toBe(false);

    // Device A cannot refresh
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenA1 })
      .expect(401);

    // Device B can refresh smoothly
    const refreshBRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenB0 })
      .expect(200);

    expect(refreshBRes.body.data.refreshToken).toBeDefined();
    expect(refreshBRes.body.data.refreshToken).not.toBe(tokenB0);
  });

  // 7. Revoked and expired sessions cannot refresh
  it('7. Revoked and expired sessions cannot refresh', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    const refreshToken = loginRes.body.data.tokens.refreshToken;

    // 7a: Revoked session
    await SessionModel.updateOne({}, { isRevoked: true, revokedReason: 'manual_admin_revocation' });
    const revokedRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(revokedRes.body.error.message).toContain('revoked');

    // 7b: Expired session
    await SessionModel.updateOne({}, { isRevoked: false, expiresAt: new Date(Date.now() - 1000) });
    const expiredRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(expiredRes.body.error.message).toContain('expired');
  });

  // 8. Stored security properties: SHA-256 hashes and AES-256-GCM encryption
  it('8. Refresh token security hygiene: hashed primary storage and AES-256-GCM encrypted grace payload', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    const rawRefreshToken = loginRes.body.data.tokens.refreshToken;
    const session = await SessionModel.findOne();

    expect(session).toBeDefined();
    // Raw token is a JWT
    expect(rawRefreshToken.startsWith('eyJ')).toBe(true);

    // Primary hash is 64-character SHA-256 hex string
    expect(session!.refreshTokenHash).toHaveLength(64);
    expect(session!.refreshTokenHash).not.toBe(rawRefreshToken);

    // Grace cache token is AES-256-GCM encrypted in format "iv:tag:ciphertext"
    const encryptedToken = session!.encryptedActiveRefreshToken!;
    expect(encryptedToken).toBeDefined();
    const parts = encryptedToken.split(':');
    expect(parts.length).toBe(3);
    // iv is 12 bytes = 24 hex characters
    expect(parts[0]).toHaveLength(24);
    // auth tag is 16 bytes = 32 hex characters
    expect(parts[1]).toHaveLength(32);
    // ciphertext must not match plaintext
    expect(encryptedToken).not.toContain(rawRefreshToken);

    // Decrypting the payload with AuthService recovers the exact active token
    const decryptedToken = AuthService.decryptToken(encryptedToken);
    expect(decryptedToken).toBe(rawRefreshToken);
  });
});
