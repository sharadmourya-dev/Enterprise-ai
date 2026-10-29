import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {
  Role,
  ClearanceLevel,
  IRegisterRequest,
  ILoginRequest,
  ISafeUser,
  ITokenPair,
  IJwtPayload,
  IRefreshTokenPayload,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';
import { UserModel, IUserDocument } from '../models/User.model.js';
import { SessionModel } from '../models/Session.model.js';
import { env } from '../config/env.js';
import { BadRequestError, UnauthorizedError, ConflictError } from '../utils/errors.js';
import { AuditService } from './audit.service.js';

const SALT_ROUNDS = 12;

// Precomputed cost-12 dummy hash for timing-equalization when user is not found
const DUMMY_BCRYPT_HASH = '$2b$12$e8p2uV37aF6F.WwB8z29v.J6k8yQ0g0c9N9Z3U4u5m6q7r8s9t0u.';
const ROTATION_GRACE_MS = 30000; // 30-second window for concurrent in-flight refresh requests

export class AuthService {
  /**
   * Registers a new user.
   * SECURITY ENFORCEMENT: Public registration strictly disallows self-assigning
   * elevated roles or security clearances. All public registrations are assigned
   * Role.USER and ClearanceLevel.INTERNAL.
   */
  public static async register(data: IRegisterRequest, clientMeta?: { ip?: string; userAgent?: string }): Promise<ISafeUser> {
    const existing = await UserModel.findOne({ email: data.email.toLowerCase().trim() });
    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const newUser = await UserModel.create({
      email: data.email.toLowerCase().trim(),
      passwordHash,
      name: data.name.trim(),
      role: Role.USER, // Enforced
      department: data.department.trim(),
      securityClearance: ClearanceLevel.INTERNAL, // Enforced
      isActive: true,
      tokenVersion: 0,
      failedLoginAttempts: 0,
    });

    await AuditService.log({
      userId: newUser._id.toString(),
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: newUser._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { email: newUser.email, event: 'user_registered' },
    });

    return this.toSafeUser(newUser);
  }

  /**
   * Authenticates user credentials with timing equalization, atomic lockout increment, and independent device sessions
   */
  public static async login(
    data: ILoginRequest,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<{ user: ISafeUser; tokens: ITokenPair }> {
    const email = data.email.toLowerCase().trim();
    const user = await UserModel.findOne({ email });

    // 1. Account enumeration protection: perform dummy bcrypt compare if user is not found
    if (!user) {
      await bcrypt.compare(data.password, DUMMY_BCRYPT_HASH);

      await AuditService.log({
        action: AuditAction.AUTH_FAILED_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: 'unknown',
        ipAddress: clientMeta?.ip,
        userAgent: clientMeta?.userAgent,
        status: 'denied',
        details: { email, reason: 'user_not_found' },
      });

      // Always return identical generic error message
      throw new UnauthorizedError('Invalid email or password');
    }

    // 2. Lockout check (active lockout window)
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      // Execute dummy compare to equalize response timing even when locked
      await bcrypt.compare(data.password, DUMMY_BCRYPT_HASH);

      await AuditService.log({
        userId: user._id.toString(),
        action: AuditAction.AUTH_FAILED_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: user._id.toString(),
        ipAddress: clientMeta?.ip,
        userAgent: clientMeta?.userAgent,
        status: 'denied',
        details: { reason: 'account_locked_attempt_rejected' },
      });

      // Maintain generic response to prevent confirming account existence/lockout
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      await bcrypt.compare(data.password, DUMMY_BCRYPT_HASH);
      throw new UnauthorizedError('Invalid email or password');
    }

    // 3. Verify password
    const isMatch = await bcrypt.compare(data.password, user.passwordHash);

    if (!isMatch) {
      // Atomic increment & conditional lockout using MongoDB aggregation pipeline
      await UserModel.findOneAndUpdate(
        { _id: user._id },
        [
          {
            $set: {
              failedLoginAttempts: { $add: ['$failedLoginAttempts', 1] },
              lockoutUntil: {
                $cond: {
                  if: { $gte: [{ $add: ['$failedLoginAttempts', 1] }, 5] },
                  then: new Date(Date.now() + 15 * 60 * 1000), // 15-minute lockout
                  else: '$lockoutUntil',
                },
              },
            },
          },
        ]
      );

      await AuditService.log({
        userId: user._id.toString(),
        action: AuditAction.AUTH_FAILED_LOGIN,
        resourceType: AuditResourceType.USER,
        resourceId: user._id.toString(),
        ipAddress: clientMeta?.ip,
        userAgent: clientMeta?.userAgent,
        status: 'denied',
        details: { reason: 'password_mismatch' },
      });

      throw new UnauthorizedError('Invalid email or password');
    }

    // 4. Successful login: reset failed counters atomically
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockoutUntil: null } }
    );

    // 5. Create an independent multi-device session
    const sessionId = crypto.randomUUID();
    const tokenVersion = 0;
    const tokens = this.generateTokenPair(user, sessionId, tokenVersion);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day session lifetime

    await SessionModel.create({
      sessionId,
      userId: user._id,
      refreshTokenHash: this.hashToken(tokens.refreshToken),
      encryptedActiveRefreshToken: this.encryptToken(tokens.refreshToken),
      activeAccessToken: tokens.accessToken,
      tokenVersion,
      userAgent: clientMeta?.userAgent || 'unknown',
      ipAddress: clientMeta?.ip || 'unknown',
      isRevoked: false,
      expiresAt,
    });

    await AuditService.log({
      userId: user._id.toString(),
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: user._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { sessionId },
    });

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  /**
   * Refreshes access tokens for a specific session with atomic rotation,
   * deterministic idempotency during concurrency grace window, and replay detection.
   */
  public static async refreshTokens(
    refreshToken: string,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<ITokenPair> {
    let payload: IRefreshTokenPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as IRefreshTokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (!payload.sessionId || !payload.sub) {
      throw new UnauthorizedError('Invalid refresh token claims');
    }

    const session = await SessionModel.findOne({ sessionId: payload.sessionId, userId: payload.sub });
    if (!session) {
      throw new UnauthorizedError('Session not found or expired');
    }

    const user = await UserModel.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account not found or deactivated');
    }

    if (session.isRevoked) {
      throw new UnauthorizedError('Session has been revoked');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedError('Session has expired');
    }

    const presentedTokenHash = this.hashToken(refreshToken);

    // Prepare replacement tokens for potential rotation winner
    const nextTokenVersion = payload.tokenVersion + 1;
    const newTokens = this.generateTokenPair(user, session.sessionId, nextTokenVersion);
    const newRefreshHash = this.hashToken(newTokens.refreshToken);
    const encryptedNewRefreshToken = this.encryptToken(newTokens.refreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day sliding expiry

    // ATOMIC CONDITIONAL ROTATION:
    // Only ONE concurrent request can successfully update the session document because
    // refreshTokenHash, tokenVersion, unrevoked state, and unexpired validity must match.
    const now = new Date();
    const updatedSession = await SessionModel.findOneAndUpdate(
      {
        _id: session._id,
        sessionId: payload.sessionId,
        refreshTokenHash: presentedTokenHash,
        tokenVersion: payload.tokenVersion,
        isRevoked: false,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          refreshTokenHash: newRefreshHash,
          previousTokenHash: presentedTokenHash,
          rotationGraceUntil: new Date(Date.now() + ROTATION_GRACE_MS),
          encryptedActiveRefreshToken: encryptedNewRefreshToken,
          activeAccessToken: newTokens.accessToken,
          expiresAt: newExpiresAt,
        },
        $inc: { tokenVersion: 1 },
      },
      { new: true }
    );

    // CASE A: This request won the atomic rotation
    if (updatedSession) {
      await AuditService.log({
        userId: user._id.toString(),
        action: AuditAction.AUTH_TOKEN_REFRESH,
        resourceType: AuditResourceType.USER,
        resourceId: user._id.toString(),
        ipAddress: clientMeta?.ip,
        userAgent: clientMeta?.userAgent,
        status: 'success',
        details: { sessionId: session.sessionId, tokenVersion: nextTokenVersion, outcome: 'rotation_winner' },
      });

      return newTokens;
    }

    // CASE B: Request lost the atomic rotation race. Check if this request presented
    // the just-rotated token within the 30-second concurrency grace window.
    const graceSession = await SessionModel.findOne({
      _id: session._id,
      sessionId: payload.sessionId,
      previousTokenHash: presentedTokenHash,
      rotationGraceUntil: { $gt: new Date() },
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (graceSession && graceSession.encryptedActiveRefreshToken && graceSession.activeAccessToken) {
      // Legitimate concurrent in-flight request:
      // Return the EXACT SAME token pair that the winner generated and persisted!
      // This prevents orphaned tokens and ensures all concurrent client tabs hold identical valid credentials.
      const activeRefreshToken = this.decryptToken(graceSession.encryptedActiveRefreshToken);

      return {
        accessToken: graceSession.activeAccessToken,
        refreshToken: activeRefreshToken,
        expiresIn: 900,
      };
    }

    // Check if session was simply revoked or expired concurrently (e.g. concurrent logout)
    const currentSessionState = await SessionModel.findById(session._id);
    if (!currentSessionState || currentSessionState.isRevoked) {
      throw new UnauthorizedError('Session has been revoked');
    }
    if (currentSessionState.expiresAt < new Date()) {
      throw new UnauthorizedError('Session has expired');
    }

    // CASE C: Confirmed Replay / Token Theft Attack
    // The presented token does not match active state AND is outside any legitimate rotation grace window.
    // Defense-in-depth: Terminate the compromised session AND all active sessions for this account.
    await SessionModel.updateMany(
      { userId: user._id },
      {
        $set: {
          isRevoked: true,
          revokedReason: 'replay_attack_detected_account_wide',
          encryptedActiveRefreshToken: null,
          activeAccessToken: null,
        },
      }
    );

    await AuditService.log({
      userId: user._id.toString(),
      action: AuditAction.AUTH_TOKEN_REVOKED,
      resourceType: AuditResourceType.USER,
      resourceId: user._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'denied',
      details: { sessionId: session.sessionId, reason: 'token_replay_detected_account_wide_revocation' },
    });

    throw new UnauthorizedError('Refresh token replay detected. All active sessions have been terminated for security.');
  }

  /**
   * Logs out a specific session by sessionId
   */
  public static async logout(
    userId: string,
    sessionId?: string,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<void> {
    if (sessionId) {
      // Revoke the targeted session only
      await SessionModel.updateOne(
        { sessionId, userId },
        {
          $set: {
            isRevoked: true,
            revokedReason: 'user_logout',
            encryptedActiveRefreshToken: null,
            activeAccessToken: null,
          },
        }
      );
    } else {
      // Fallback: revoke all sessions if sessionId not specified
      await SessionModel.updateMany(
        { userId },
        {
          $set: {
            isRevoked: true,
            revokedReason: 'user_logout_all',
            encryptedActiveRefreshToken: null,
            activeAccessToken: null,
          },
        }
      );
    }

    await AuditService.log({
      userId,
      action: AuditAction.AUTH_LOGOUT,
      resourceType: AuditResourceType.USER,
      resourceId: sessionId || userId,
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { sessionId },
    });
  }

  /**
   * Retrieves user profile
   */
  public static async getProfile(userId: string): Promise<ISafeUser> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new BadRequestError('User not found');
    }
    return this.toSafeUser(user);
  }

  private static generateTokenPair(user: IUserDocument, sessionId: string, tokenVersion: number): ITokenPair {
    const accessPayload: IJwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      department: user.department,
      securityClearance: user.securityClearance,
      permissions: user.permissions || [],
      sessionId,
    };

    const accessToken = jwt.sign(accessPayload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRATION as jwt.SignOptions['expiresIn'],
    });

    const refreshPayload: IRefreshTokenPayload = {
      sub: user._id.toString(),
      sessionId,
      tokenVersion,
    };

    const refreshToken = jwt.sign(refreshPayload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRATION as jwt.SignOptions['expiresIn'],
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  /**
   * Authenticated password change with current password verification, bcrypt hashing, and session revocation
   */
  public static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<{ message: string }> {
    const user = await UserModel.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account not found or deactivated');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestError('Current password is incorrect');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestError('New password must be at least 8 characters long');
    }

    // Hash new password using project standard bcrypt
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = newPasswordHash;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Revoke all existing sessions for this user
    await SessionModel.updateMany(
      { userId: user._id, isRevoked: false },
      { isRevoked: true, revokedReason: 'PASSWORD_CHANGED' }
    );

    await AuditService.log({
      userId: user._id.toString(),
      action: AuditAction.AUTH_PASSWORD_CHANGE,
      resourceType: AuditResourceType.USER,
      resourceId: user._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { reason: 'user_initiated_password_change' },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Public forgot-password request. Timing-equalized generic response prevents account enumeration.
   * Single-use cryptographic reset token is hashed with SHA-256 and stored with 15-minute expiration.
   */
  public static async forgotPassword(
    email: string,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<{ message: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await UserModel.findOne({ email: normalizedEmail });

    if (!user || !user.isActive) {
      // Timing equalization against enumeration attacks
      await bcrypt.compare('dummy_timing_probe', DUMMY_BCRYPT_HASH);
      return {
        message: 'If an account with that email address exists, password reset instructions have been sent.',
      };
    }

    // Generate single-use cryptographically secure reset token
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');

    user.passwordResetTokenHash = resetTokenHash;
    user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await user.save();

    await AuditService.log({
      userId: user._id.toString(),
      action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
      resourceType: AuditResourceType.USER,
      resourceId: user._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { email: user.email },
    });

    // Note: No outbound email provider is configured in this deployment environment.
    // In accordance with security requirements, the token is not leaked to logs or API responses.
    return {
      message: 'If an account with that email address exists, password reset instructions have been sent.',
    };
  }

  /**
   * Public password reset verification and execution using single-use SHA-256 token
   */
  public static async resetPassword(
    token: string,
    newPassword: string,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<{ message: string }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestError('Invalid or missing reset token');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestError('New password must be at least 8 characters long');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const now = new Date();

    const user = await UserModel.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: now },
      isActive: true,
    });

    if (!user) {
      throw new BadRequestError('Invalid or expired password reset token');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = newPasswordHash;
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Revoke all existing sessions upon password reset
    await SessionModel.updateMany(
      { userId: user._id, isRevoked: false },
      { isRevoked: true, revokedReason: 'PASSWORD_RESET' }
    );

    await AuditService.log({
      userId: user._id.toString(),
      action: AuditAction.AUTH_PASSWORD_RESET_SUCCESS,
      resourceType: AuditResourceType.USER,
      resourceId: user._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { email: user.email },
    });

    return {
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }

  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  public static encryptToken(plainText: string, secret = env.JWT_REFRESH_SECRET): string {
    const key = crypto.createHash('sha256').update(secret).digest(); // 32-byte key for AES-256
    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  public static decryptToken(cipherTextPayload: string, secret = env.JWT_REFRESH_SECRET): string {
    const parts = cipherTextPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted token ciphertext');
    }
    const [ivHex, tagHex, encryptedHex] = parts;
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  public static timingSafeHashMatch(hashA: string, hashB: string): boolean {
    const bufA = Buffer.from(hashA, 'hex');
    const bufB = Buffer.from(hashB, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  private static toSafeUser(user: IUserDocument): ISafeUser {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      securityClearance: user.securityClearance,
      permissions: user.permissions || [],
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
