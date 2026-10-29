import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { app } from '../src/app.js';
import { UserModel } from '../src/models/User.model.js';
import { SessionModel } from '../src/models/Session.model.js';
import { AuditLogModel } from '../src/models/AuditLog.model.js';
import { MailService } from '../src/services/mail.service.js';
import { env } from '../src/config/env.js';
import { AuditAction } from '@enterprise-ai/shared-types';

describe('Milestone 2 — SMTP Mail Delivery & Password Reset Security Integration Tests', () => {
  let mockSendMail: jest.Mock;

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await SessionModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    mockSendMail = jest.fn().mockResolvedValue({
      messageId: '<test-message-id-12345@enterprise-ai.internal>',
      response: '250 OK: Message accepted for delivery',
    });

    MailService.setTransporter({
      sendMail: mockSendMail,
    } as any);
  });

  afterAll(() => {
    MailService.setTransporter(null);
  });

  const testUser = {
    email: 'sarah.engineer@enterprise-ai.com',
    password: 'InitialPassword123!',
    name: 'Sarah Engineer',
    department: 'Engineering',
  };

  async function createTestUser() {
    const passwordHash = await bcrypt.hash(testUser.password, 10);
    return await UserModel.create({
      email: testUser.email,
      passwordHash,
      name: testUser.name,
      department: testUser.department,
      role: 'user',
      securityClearance: 'internal',
      isActive: true,
    });
  }

  describe('1. SMTP Configuration Validation', () => {
    it('validates correct SMTP host, port, and sender address', () => {
      expect(() => {
        MailService.validateConfig({
          SMTP_HOST: 'smtp.sendgrid.net',
          SMTP_PORT: 587,
          SMTP_FROM: 'noreply@enterprise-ai.com',
        });
      }).not.toThrow();
    });

    it('rejects invalid or missing SMTP_HOST with descriptive error', () => {
      expect(() => {
        MailService.validateConfig({
          SMTP_HOST: '',
          SMTP_PORT: 587,
          SMTP_FROM: 'noreply@enterprise-ai.com',
        });
      }).toThrow('SMTP_HOST must be a non-empty string');
    });

    it('rejects out-of-range SMTP_PORT values (< 1 or > 65535)', () => {
      expect(() => {
        MailService.validateConfig({
          SMTP_HOST: 'smtp.example.com',
          SMTP_PORT: 0,
          SMTP_FROM: 'noreply@enterprise-ai.com',
        });
      }).toThrow('SMTP_PORT must be a valid port number');

      expect(() => {
        MailService.validateConfig({
          SMTP_HOST: 'smtp.example.com',
          SMTP_PORT: 70000,
          SMTP_FROM: 'noreply@enterprise-ai.com',
        });
      }).toThrow('SMTP_PORT must be a valid port number');
    });

    it('rejects invalid SMTP_FROM sender format', () => {
      expect(() => {
        MailService.validateConfig({
          SMTP_HOST: 'smtp.example.com',
          SMTP_PORT: 587,
          SMTP_FROM: 'not-an-email',
        });
      }).toThrow('SMTP_FROM must be a valid email address');
    });
  });

  describe('2. Email Sender, Recipient & Reset Link Construction', () => {
    it('correctly constructs absolute reset URL handling base URL trailing slashes and parameter encoding', () => {
      const token = 'abc1234567890def+/=';
      const url1 = MailService.buildResetUrl(token, 'https://copilot.enterprise.com/');
      expect(url1).toBe('https://copilot.enterprise.com/reset-password?token=abc1234567890def%2B%2F%3D');

      const url2 = MailService.buildResetUrl('simple_hex_token_32_bytes', 'https://copilot.enterprise.com');
      expect(url2).toBe('https://copilot.enterprise.com/reset-password?token=simple_hex_token_32_bytes');
    });

    it('dispatches email with configured SMTP_FROM sender and target recipient', async () => {
      await createTestUser();

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUser.email });

      expect(res.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe(testUser.email);
      expect(mailOptions.from).toBe(env.SMTP_FROM);
      expect(mailOptions.subject).toContain('Reset Your Password');
      expect(mailOptions.text).toContain('/reset-password?token=');
      expect(mailOptions.html).toContain('/reset-password?token=');
      expect(mailOptions.html).toContain('Reset Password');
      expect(mailOptions.text).toContain('15 minutes');
    });
  });

  describe('3. Successful Delivery & Database Token State', () => {
    it('stores SHA-256 hashed token with 15-minute expiration on successful delivery', async () => {
      await createTestUser();

      const before = Date.now();
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUser.email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('If an account with that email address exists');

      const updatedUser = await UserModel.findOne({ email: testUser.email });
      expect(updatedUser?.passwordResetTokenHash).toBeDefined();
      expect(typeof updatedUser?.passwordResetTokenHash).toBe('string');
      expect(updatedUser?.passwordResetTokenHash).toHaveLength(64); // SHA-256 hex length

      expect(updatedUser?.passwordResetExpiresAt).toBeDefined();
      const expiresAt = updatedUser!.passwordResetExpiresAt!.getTime();
      const expectedMin = before + 14 * 60 * 1000;
      const expectedMax = before + 16 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(expectedMin);
      expect(expiresAt).toBeLessThan(expectedMax);
    });
  });

  describe('4. SMTP Failure Handling, Fail-Closed Security & Token Invalidation', () => {
    it('invalidates database reset token and fails closed with 503 when SMTP dispatch fails', async () => {
      await createTestUser();

      // Configure mock transport to reject simulating SMTP server connection drop or EAUTH failure
      mockSendMail.mockRejectedValueOnce(new Error('ESOCKET: Connection to SMTP server timed out'));

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUser.email });

      // Must NOT return fake 200 success when email delivery genuinely fails
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Unable to process password reset request at this time');

      // CRITICAL SECURITY ASSERTION: No uncontrolled valid token left in database
      const userAfterFailure = await UserModel.findOne({ email: testUser.email });
      expect(userAfterFailure?.passwordResetTokenHash).toBeNull();
      expect(userAfterFailure?.passwordResetExpiresAt).toBeNull();

      // Verify audit log captured failure event
      const failureAudit = await AuditLogModel.findOne({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
        status: 'error',
      });
      expect(failureAudit).not.toBeNull();
      expect(failureAudit?.details?.reason).toBe('smtp_delivery_failed');
    });

    it('cleans up token state when SMTP authentication fails (EAUTH)', async () => {
      await createTestUser();

      const authErr: any = new Error('EAUTH: Invalid SMTP credentials');
      authErr.code = 'EAUTH';
      authErr.responseCode = 535;
      mockSendMail.mockRejectedValueOnce(authErr);

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUser.email });

      expect(res.status).toBe(503);

      const user = await UserModel.findOne({ email: testUser.email });
      expect(user?.passwordResetTokenHash).toBeNull();
      expect(user?.passwordResetExpiresAt).toBeNull();
    });
  });

  describe('5. Generic Response & Anti-Enumeration Protections', () => {
    it('returns generic response for unknown email without invoking mail transporter', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent.user.999@enterprise-ai.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('If an account with that email address exists');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('does not dispatch email for deactivated or suspended accounts', async () => {
      const passwordHash = await bcrypt.hash('Deactivated123!', 10);
      await UserModel.create({
        email: 'deactivated@enterprise-ai.com',
        passwordHash,
        name: 'Deactivated User',
        department: 'Operations',
        role: 'user',
        securityClearance: 'internal',
        isActive: false, // Inactive
      });

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'deactivated@enterprise-ai.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('If an account with that email address exists');
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  describe('6. Token Verification, Single-Use Enforcement & Password Reset Execution', () => {
    let rawToken: string;
    let validUser: any;

    beforeEach(async () => {
      validUser = await createTestUser();

      rawToken = '7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      validUser.passwordResetTokenHash = tokenHash;
      validUser.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
      await validUser.save();
    });

    it('successfully resets password with valid token and updates passwordHash', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'BrandNewSecurePassword456!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('Password has been reset successfully');

      // Verify user in DB has new password
      const updatedUser = await UserModel.findById(validUser._id);
      expect(updatedUser?.passwordResetTokenHash).toBeNull();
      expect(updatedUser?.passwordResetExpiresAt).toBeNull();

      const isOldPasswordMatch = await bcrypt.compare(testUser.password, updatedUser!.passwordHash);
      expect(isOldPasswordMatch).toBe(false);

      const isNewPasswordMatch = await bcrypt.compare('BrandNewSecurePassword456!', updatedUser!.passwordHash);
      expect(isNewPasswordMatch).toBe(true);
    });

    it('enforces single-use tokens: rejects subsequent reset attempt using the same token', async () => {
      // First reset succeeds
      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'BrandNewSecurePassword456!',
        })
        .expect(200);

      // Reused attempt with same token must fail
      const reuseRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'AnotherPassword789!',
        });

      expect(reuseRes.status).toBe(400);
      expect(reuseRes.body.success).toBe(false);
      expect(reuseRes.body.error.message).toContain('Invalid or expired password reset token');
    });

    it('rejects expired tokens (> 15 minutes old) with 400 Bad Request', async () => {
      // Expire token in database
      await UserModel.updateOne(
        { _id: validUser._id },
        { passwordResetExpiresAt: new Date(Date.now() - 1000) }
      );

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'BrandNewSecurePassword456!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid or expired password reset token');
    });

    it('rejects invalid or tampered tokens with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: 'invalid_unmatched_random_token_12345',
          newPassword: 'BrandNewSecurePassword456!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid or expired password reset token');
    });
  });

  describe('7. Session Revocation Post-Password Reset', () => {
    it('revokes all existing active sessions when password is reset', async () => {
      const user = await createTestUser();

      // Create two active sessions for user
      const s1 = await SessionModel.create({
        sessionId: 'sess_test_1',
        userId: user._id,
        refreshTokenHash: 'hash_s1',
        deviceInfo: { userAgent: 'Chrome on Windows', ip: '127.0.0.1' },
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        isRevoked: false,
      });

      const s2 = await SessionModel.create({
        sessionId: 'sess_test_2',
        userId: user._id,
        refreshTokenHash: 'hash_s2',
        deviceInfo: { userAgent: 'Safari on iPhone', ip: '127.0.0.1' },
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        isRevoked: false,
      });

      const rawToken = 'session_revocation_test_token_abcdef123456';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.passwordResetTokenHash = tokenHash;
      user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();

      // Execute password reset
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'PostSessionRevocationPassword999!',
        });

      expect(res.status).toBe(200);

      // Verify both sessions are now revoked with PASSWORD_RESET reason
      const revokedS1 = await SessionModel.findById(s1._id);
      const revokedS2 = await SessionModel.findById(s2._id);

      expect(revokedS1?.isRevoked).toBe(true);
      expect(revokedS1?.revokedReason).toBe('PASSWORD_RESET');
      expect(revokedS2?.isRevoked).toBe(true);
      expect(revokedS2?.revokedReason).toBe('PASSWORD_RESET');

      // Verify user tokenVersion was incremented
      const updatedUser = await UserModel.findById(user._id);
      expect(updatedUser?.tokenVersion).toBeGreaterThan(0);
    });
  });

  describe('8. Zero Secret & Token Leakage Hygiene', () => {
    it('never exposes raw reset token or SMTP credentials in API responses', async () => {
      await createTestUser();

      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUser.email });

      expect(forgotRes.status).toBe(200);
      const forgotJson = JSON.stringify(forgotRes.body);
      expect(forgotJson).not.toContain(env.SMTP_PASS || 'smtp_password');
      expect(forgotJson).not.toContain('/reset-password?token=');

      // Intercept the token from the mail mock
      const mailCall = mockSendMail.mock.calls[0][0];
      const match = mailCall.text.match(/token=([a-f0-9]+)/i);
      expect(match).not.toBeNull();
      const rawToken = match[1];

      // Reset response does not echo token or secrets
      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'HygieneVerifiedPassword123!',
        });

      expect(resetRes.status).toBe(200);
      const resetJson = JSON.stringify(resetRes.body);
      expect(resetJson).not.toContain(rawToken);
      expect(resetJson).not.toContain(env.SMTP_PASS || 'smtp_password');

      // Audit logs do not contain raw token or password
      const auditLogs = await AuditLogModel.find({ userId: (await UserModel.findOne({ email: testUser.email }))?._id });
      for (const log of auditLogs) {
        const logJson = JSON.stringify(log);
        expect(logJson).not.toContain(rawToken);
        if (env.SMTP_PASS) {
          expect(logJson).not.toContain(env.SMTP_PASS);
        }
      }
    });
  });
});
