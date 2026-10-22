import mongoose from 'mongoose';
import {
  parsePromoteCliArgs,
  sanitizeMongoIdentity,
  validatePromotionEligibility,
  executePromotionWorkflow,
} from '../src/scripts/promote-user.service.js';
import { UserModel, IUserDocument } from '../src/models/User.model.js';
import { SessionModel } from '../src/models/Session.model.js';
import { AuditService } from '../src/services/audit.service.js';
import { Role, ClearanceLevel, AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';

describe('Administrator Bootstrap & Promotion Service (Unit Tests)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CLI Argument Parsing & Validation', () => {
    it('should parse valid email and default to Role.ADMIN and ClearanceLevel.RESTRICTED', () => {
      const parsed = parsePromoteCliArgs(['--email', 'staff@enterprise.com']);
      expect(parsed.email).toBe('staff@enterprise.com');
      expect(parsed.role).toBe(Role.ADMIN);
      expect(parsed.clearance).toBe(ClearanceLevel.RESTRICTED);
      expect(parsed.confirm).toBe(false);
      expect(parsed.dryRun).toBe(false);
    });

    it('should normalize uppercase emails and trim whitespace', () => {
      const parsed = parsePromoteCliArgs(['--email', '  Admin.User@Enterprise.COM  ']);
      expect(parsed.email).toBe('admin.user@enterprise.com');
    });

    it('should parse --role super_admin and explicit clearance level', () => {
      const parsed = parsePromoteCliArgs([
        '--email',
        'lead@enterprise.com',
        '--role',
        'super_admin',
        '--clearance',
        'confidential',
      ]);
      expect(parsed.role).toBe(Role.SUPER_ADMIN);
      expect(parsed.clearance).toBe(ClearanceLevel.CONFIDENTIAL);
    });

    it('should parse key=value syntax', () => {
      const parsed = parsePromoteCliArgs([
        '--email=staff@enterprise.com',
        '--role=admin',
        '--clearance=restricted',
      ]);
      expect(parsed.email).toBe('staff@enterprise.com');
      expect(parsed.role).toBe(Role.ADMIN);
      expect(parsed.clearance).toBe(ClearanceLevel.RESTRICTED);
    });

    it('should parse confirmation and dry-run flags', () => {
      const parsedConfirm = parsePromoteCliArgs(['--email', 'test@test.com', '--confirm']);
      expect(parsedConfirm.confirm).toBe(true);

      const parsedYes = parsePromoteCliArgs(['--email', 'test@test.com', '-y']);
      expect(parsedYes.confirm).toBe(true);

      const parsedDryRun = parsePromoteCliArgs(['--email', 'test@test.com', '--dry-run']);
      expect(parsedDryRun.dryRun).toBe(true);
    });

    it('should reject missing email argument', () => {
      expect(() => parsePromoteCliArgs([])).toThrow('Missing required argument: --email');
      expect(() => parsePromoteCliArgs(['--role', 'admin'])).toThrow('Missing required argument: --email');
    });

    it('should reject malformed email formats', () => {
      const badEmails = ['plainstring', 'missing-at.com', 'user@', '@domain.com', 'user@domain'];
      for (const bad of badEmails) {
        expect(() => parsePromoteCliArgs(['--email', bad])).toThrow('Invalid email address format');
      }
    });

    it('should reject invalid or non-administrative target roles', () => {
      expect(() => parsePromoteCliArgs(['--email', 'user@test.com', '--role', 'user'])).toThrow(
        /Only 'admin' or 'super_admin' are permitted/
      );
      expect(() => parsePromoteCliArgs(['--email', 'user@test.com', '--role', 'support_agent'])).toThrow(
        /Only 'admin' or 'super_admin' are permitted/
      );
      expect(() => parsePromoteCliArgs(['--email', 'user@test.com', '--role', 'invalid_role'])).toThrow(
        /Only 'admin' or 'super_admin' are permitted/
      );
    });

    it('should reject invalid clearance levels', () => {
      expect(() => parsePromoteCliArgs(['--email', 'user@test.com', '--clearance', 'top_secret'])).toThrow(
        /Invalid clearance level/
      );
    });
  });

  describe('Database Identity Sanitization', () => {
    it('should sanitize mongodb:// connection string without leaking credentials', () => {
      const rawUri = 'mongodb://app_user:SuperSecretPassword123@127.0.0.1:27017/enterprise_ai?replicaSet=rs0';
      const sanitized = sanitizeMongoIdentity(rawUri);

      expect(sanitized.scheme).toBe('mongodb');
      expect(sanitized.host).toBe('127.0.0.1:27017');
      expect(sanitized.database).toBe('enterprise_ai');
      expect(sanitized.displayString).toBe('enterprise_ai on 127.0.0.1:27017');
      expect(sanitized.displayString).not.toContain('SuperSecretPassword123');
      expect(sanitized.displayString).not.toContain('app_user');
    });

    it('should sanitize cloud mongodb+srv:// connection string without leaking credentials', () => {
      const rawUri = 'mongodb+srv://admin_atlas:P%40ssw0rd!@cluster0.abcde.mongodb.net/enterprise_ai?retryWrites=true&w=majority';
      const sanitized = sanitizeMongoIdentity(rawUri);

      expect(sanitized.scheme).toBe('mongodb+srv');
      expect(sanitized.host).toBe('cluster0.abcde.mongodb.net');
      expect(sanitized.database).toBe('enterprise_ai');
      expect(sanitized.displayString).toBe('enterprise_ai on cluster0.abcde.mongodb.net');
      expect(sanitized.displayString).not.toContain('P%40ssw0rd!');
      expect(sanitized.displayString).not.toContain('admin_atlas');
    });

    it('should handle URIs without credentials gracefully', () => {
      const rawUri = 'mongodb://localhost:27017/enterprise_ai';
      const sanitized = sanitizeMongoIdentity(rawUri);

      expect(sanitized.host).toBe('localhost:27017');
      expect(sanitized.database).toBe('enterprise_ai');
      expect(sanitized.displayString).toBe('enterprise_ai on localhost:27017');
    });

    it('should handle empty or undefined URI inputs safely', () => {
      const sanitized = sanitizeMongoIdentity('');
      expect(sanitized.displayString).toBe('unknown');
    });
  });

  describe('Promotion Eligibility Validation', () => {
    const mockUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'engineer@enterprise.com',
      name: 'Test Engineer',
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      isActive: true,
      tokenVersion: 1,
    } as unknown as IUserDocument;

    it('should approve valid active user promotion', () => {
      const result = validatePromotionEligibility(mockUser, Role.ADMIN, ClearanceLevel.RESTRICTED);
      expect(result.canPromote).toBe(true);
      expect(result.previousRole).toBe(Role.USER);
      expect(result.targetRole).toBe(Role.ADMIN);
      expect(result.previousClearance).toBe(ClearanceLevel.INTERNAL);
      expect(result.targetClearance).toBe(ClearanceLevel.RESTRICTED);
    });

    it('should reject nonexistent user (null)', () => {
      const result = validatePromotionEligibility(null, Role.ADMIN, ClearanceLevel.RESTRICTED);
      expect(result.canPromote).toBe(false);
      expect(result.reason).toContain('Target account not found');
    });

    it('should reject inactive/deactivated accounts', () => {
      const inactiveUser = { ...mockUser, isActive: false } as IUserDocument;
      const result = validatePromotionEligibility(inactiveUser, Role.ADMIN, ClearanceLevel.RESTRICTED);
      expect(result.canPromote).toBe(false);
      expect(result.reason).toContain('inactive/deactivated');
    });

    it('should reject repeated execution (no-op) when account already holds target role and clearance', () => {
      const alreadyAdmin = {
        ...mockUser,
        role: Role.ADMIN,
        securityClearance: ClearanceLevel.RESTRICTED,
      } as IUserDocument;
      const result = validatePromotionEligibility(alreadyAdmin, Role.ADMIN, ClearanceLevel.RESTRICTED);
      expect(result.canPromote).toBe(false);
      expect(result.reason).toContain('already configured with role');
    });

    it('should reject accidental demotion of super_admin to admin', () => {
      const superAdminUser = {
        ...mockUser,
        role: Role.SUPER_ADMIN,
        securityClearance: ClearanceLevel.RESTRICTED,
      } as IUserDocument;
      const result = validatePromotionEligibility(superAdminUser, Role.ADMIN, ClearanceLevel.RESTRICTED);
      expect(result.canPromote).toBe(false);
      expect(result.reason).toContain('already holds the higher privilege');
    });
  });

  describe('Promotion Workflow Execution & Audit Logging', () => {
    const mockTargetUser = {
      _id: new mongoose.Types.ObjectId('69ef5049b99df1e967a5b399'),
      email: 'dev.frontend1997@gmail.com',
      name: 'Frontend Developer',
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      isActive: true,
      tokenVersion: 2,
    } as unknown as IUserDocument;

    it('should require deliberate confirmation if not in dry-run mode', async () => {
      await expect(
        executePromotionWorkflow({
          email: 'dev.frontend1997@gmail.com',
          role: Role.ADMIN,
          clearance: ClearanceLevel.RESTRICTED,
          confirm: false,
          dryRun: false,
        })
      ).rejects.toThrow('deliberate confirmation required');
    });

    it('should execute dry-run simulation without modifying database or sessions', async () => {
      jest.spyOn(UserModel, 'findOne').mockResolvedValue(mockTargetUser);
      const updateOneSpy = jest.spyOn(UserModel, 'updateOne');
      const updateManySpy = jest.spyOn(SessionModel, 'updateMany');
      const auditLogSpy = jest.spyOn(AuditService, 'log');

      const result = await executePromotionWorkflow({
        email: 'dev.frontend1997@gmail.com',
        role: Role.ADMIN,
        clearance: ClearanceLevel.RESTRICTED,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.previousRole).toBe(Role.USER);
      expect(result.newRole).toBe(Role.ADMIN);
      expect(updateOneSpy).not.toHaveBeenCalled();
      expect(updateManySpy).not.toHaveBeenCalled();
      expect(auditLogSpy).not.toHaveBeenCalled();
    });

    it('should execute full promotion: update user, bump tokenVersion, revoke sessions, and record audit log', async () => {
      jest.spyOn(UserModel, 'findOne').mockResolvedValue(mockTargetUser);
      const updateOneSpy = jest.spyOn(UserModel, 'updateOne').mockResolvedValue({ acknowledged: true } as any);
      const updateManySpy = jest.spyOn(SessionModel, 'updateMany').mockResolvedValue({ modifiedCount: 3 } as any);
      const auditLogSpy = jest.spyOn(AuditService, 'log').mockResolvedValue({ id: 'audit-123' } as any);

      const result = await executePromotionWorkflow(
        {
          email: 'dev.frontend1997@gmail.com',
          role: Role.ADMIN,
          clearance: ClearanceLevel.RESTRICTED,
          confirm: true,
        },
        'mongodb://localhost:27017/enterprise_ai'
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.targetUserId).toBe('69ef5049b99df1e967a5b399');
      expect(result.newRole).toBe(Role.ADMIN);
      expect(result.newClearance).toBe(ClearanceLevel.RESTRICTED);
      expect(result.revokedSessionsCount).toBe(3);
      expect(result.auditLogged).toBe(true);

      // Verify user update mutation
      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: mockTargetUser._id },
        {
          $set: {
            role: Role.ADMIN,
            securityClearance: ClearanceLevel.RESTRICTED,
          },
          $inc: {
            tokenVersion: 1,
          },
        }
      );

      // Verify session revocation
      expect(updateManySpy).toHaveBeenCalledWith(
        { userId: mockTargetUser._id, isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true }),
        })
      );

      // Verify audit logging
      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          action: AuditAction.ADMIN_ROLE_CHANGE,
          resourceType: AuditResourceType.USER,
          resourceId: '69ef5049b99df1e967a5b399',
          status: 'success',
          details: expect.objectContaining({
            actor: 'cli.admin_bootstrap',
            targetEmail: 'dev.frontend1997@gmail.com',
            previousRole: Role.USER,
            newRole: Role.ADMIN,
            tokenVersionIncremented: true,
            sessionsRevoked: 3,
          }),
        })
      );
    });

    it('should throw if target user does not exist in database', async () => {
      jest.spyOn(UserModel, 'findOne').mockResolvedValue(null);

      await expect(
        executePromotionWorkflow({
          email: 'nonexistent@enterprise.com',
          role: Role.ADMIN,
          confirm: true,
        })
      ).rejects.toThrow('Target account not found in database');
    });
  });
});
