import mongoose from 'mongoose';
import {
  Role,
  ClearanceLevel,
  Permission,
  AuditAction,
  AuditResourceType,
  IJwtPayload,
  PERMISSION_DEFINITIONS,
} from '@enterprise-ai/shared-types';
import { AdminUserService } from '../src/services/admin-user.service.js';
import { UserModel } from '../src/models/User.model.js';
import { SessionModel } from '../src/models/Session.model.js';
import { AuditService } from '../src/services/audit.service.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../src/utils/errors.js';

describe('Admin User Management & Permission Administration', () => {
  const superAdminCaller: IJwtPayload = {
    sub: '671350a12f3e8b0012345001',
    email: 'superadmin@enterprise.com',
    role: Role.SUPER_ADMIN,
    department: 'IT',
    securityClearance: ClearanceLevel.RESTRICTED,
    sessionId: 'sess-super',
  };

  const adminCaller: IJwtPayload = {
    sub: '671350a12f3e8b0012345002',
    email: 'admin@enterprise.com',
    role: Role.ADMIN,
    department: 'IT',
    securityClearance: ClearanceLevel.RESTRICTED,
    sessionId: 'sess-admin',
  };

  const employeeTargetId = '671350a12f3e8b0012345003';
  const mockEmployeeUser = {
    _id: new mongoose.Types.ObjectId(employeeTargetId),
    email: 'employee@enterprise.com',
    name: 'Alice Cooper',
    role: Role.USER,
    department: 'Engineering',
    securityClearance: ClearanceLevel.INTERNAL,
    permissions: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    save: jest.fn().mockResolvedValue(true),
  };

  const kmTargetId = '671350a12f3e8b0012345004';
  const mockKMUser = {
    _id: new mongoose.Types.ObjectId(kmTargetId),
    email: 'km@enterprise.com',
    name: 'Bob Knowledge',
    role: Role.KNOWLEDGE_MANAGER,
    department: 'Operations',
    securityClearance: ClearanceLevel.CONFIDENTIAL,
    permissions: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    save: jest.fn().mockResolvedValue(true),
  };

  const superAdminTargetId = '671350a12f3e8b0012345005';
  const mockSuperAdminUser = {
    _id: new mongoose.Types.ObjectId(superAdminTargetId),
    email: 'other.super@enterprise.com',
    name: 'Chief Admin',
    role: Role.SUPER_ADMIN,
    department: 'IT',
    securityClearance: ClearanceLevel.RESTRICTED,
    permissions: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditService, 'log').mockResolvedValue(null as any);
  });

  describe('1. Effective Permission Calculation', () => {
    it('computes all permissions for Admin and Super Admin', () => {
      const adminPerms = AdminUserService.computeEffectivePermissions(Role.ADMIN, []);
      const superPerms = AdminUserService.computeEffectivePermissions(Role.SUPER_ADMIN, []);
      expect(adminPerms).toEqual(Object.values(Permission));
      expect(superPerms).toEqual(Object.values(Permission));
    });

    it('inherits role defaults for Knowledge Manager and merges explicit permissions', () => {
      const perms = AdminUserService.computeEffectivePermissions(Role.KNOWLEDGE_MANAGER, [
        Permission.ADMIN_ANALYTICS,
      ]);
      expect(perms).toContain(Permission.DOCUMENTS_UPLOAD);
      expect(perms).toContain(Permission.DOCUMENTS_RETRY);
      expect(perms).toContain(Permission.ADMIN_ANALYTICS);
      expect(perms).not.toContain(Permission.ADMIN_AUDIT);
    });

    it('computes only explicit permissions for standard Employee', () => {
      const emptyPerms = AdminUserService.computeEffectivePermissions(Role.USER, []);
      expect(emptyPerms).toEqual([]);

      const grantedPerms = AdminUserService.computeEffectivePermissions(Role.USER, [
        Permission.DOCUMENTS_UPLOAD,
      ]);
      expect(grantedPerms).toEqual([Permission.DOCUMENTS_UPLOAD]);
    });
  });

  describe('2. AdminUserService.listUsers', () => {
    it('lists users with pagination, formatted properties, and available permissions', async () => {
      jest.spyOn(UserModel, 'countDocuments').mockResolvedValue(1 as any);
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockEmployeeUser]),
      };
      jest.spyOn(UserModel, 'find').mockReturnValue(mockQuery as any);

      const result = await AdminUserService.listUsers({ page: 1, limit: 10 });

      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].id).toBe(employeeTargetId);
      expect(result.users[0].email).toBe('employee@enterprise.com');
      expect(result.availablePermissions).toHaveLength(Object.values(PERMISSION_DEFINITIONS).length);
    });

    it('sanitizes regex characters in search query', async () => {
      const countSpy = jest.spyOn(UserModel, 'countDocuments').mockResolvedValue(0 as any);
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      const findSpy = jest.spyOn(UserModel, 'find').mockReturnValue(mockQuery as any);

      await AdminUserService.listUsers({ search: 'user+test*@enterprise.com' });

      expect(countSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            { name: { $regex: 'user\\+test\\*@enterprise\\.com', $options: 'i' } },
          ]),
        })
      );
      expect(findSpy).toHaveBeenCalled();
    });
  });

  describe('3. AdminUserService.getUserById', () => {
    it('rejects invalid ObjectId format with BadRequestError', async () => {
      await expect(AdminUserService.getUserById('invalid-id')).rejects.toThrow(BadRequestError);
    });

    it('throws NotFoundError when user does not exist', async () => {
      jest.spyOn(UserModel, 'findById').mockResolvedValue(null);
      await expect(AdminUserService.getUserById(employeeTargetId)).rejects.toThrow(NotFoundError);
    });

    it('returns formatted user details when user exists', async () => {
      jest.spyOn(UserModel, 'findById').mockResolvedValue(mockEmployeeUser as any);
      const user = await AdminUserService.getUserById(employeeTargetId);
      expect(user.id).toBe(employeeTargetId);
      expect(user.name).toBe('Alice Cooper');
    });
  });

  describe('4. AdminUserService.updatePermissions Security Boundaries', () => {
    it('rejects self-modification attempts with ForbiddenError', async () => {
      await expect(
        AdminUserService.updatePermissions(
          adminCaller.sub, // Admin tries to modify themselves
          [Permission.DOCUMENTS_UPLOAD],
          adminCaller
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects ordinary Admin attempting to modify Super Admin permissions', async () => {
      jest.spyOn(UserModel, 'findById').mockResolvedValue(mockSuperAdminUser as any);

      await expect(
        AdminUserService.updatePermissions(
          superAdminTargetId,
          [Permission.DOCUMENTS_UPLOAD],
          adminCaller // ordinary Admin
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects ordinary Admin attempting to modify another Admin permissions', async () => {
      const otherAdmin = {
        _id: new mongoose.Types.ObjectId('671350a12f3e8b0012345099'),
        role: Role.ADMIN,
        permissions: [],
      };
      jest.spyOn(UserModel, 'findById').mockResolvedValue(otherAdmin as any);

      await expect(
        AdminUserService.updatePermissions(
          otherAdmin._id.toString(),
          [Permission.DOCUMENTS_UPLOAD],
          adminCaller // ordinary Admin
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects ordinary Admin attempting to grant ADMIN_AUDIT permission', async () => {
      jest.spyOn(UserModel, 'findById').mockResolvedValue(mockEmployeeUser as any);

      await expect(
        AdminUserService.updatePermissions(
          employeeTargetId,
          [Permission.ADMIN_AUDIT], // Sensitive audit permission
          adminCaller // ordinary Admin
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows Super Admin to grant ADMIN_AUDIT permission to user', async () => {
      jest.spyOn(UserModel, 'findById').mockResolvedValue({
        ...mockEmployeeUser,
        permissions: [],
        save: jest.fn().mockResolvedValue(true),
      } as any);

      const updated = await AdminUserService.updatePermissions(
        employeeTargetId,
        [Permission.ADMIN_AUDIT],
        superAdminCaller
      );

      expect(updated.permissions).toContain(Permission.ADMIN_AUDIT);
    });

    it('rejects invalid or unsupported permission string identifiers with BadRequestError', async () => {
      jest.spyOn(UserModel, 'findById').mockResolvedValue(mockEmployeeUser as any);

      await expect(
        AdminUserService.updatePermissions(
          employeeTargetId,
          ['invalid:permission' as any],
          adminCaller
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('successfully updates employee permissions and records audit log', async () => {
      const employeeDoc = {
        ...mockEmployeeUser,
        permissions: [],
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(UserModel, 'findById').mockResolvedValue(employeeDoc as any);
      const auditSpy = jest.spyOn(AuditService, 'log').mockResolvedValue(null as any);

      const result = await AdminUserService.updatePermissions(
        employeeTargetId,
        [Permission.DOCUMENTS_UPLOAD],
        adminCaller,
        { ip: '127.0.0.1', userAgent: 'JestTest' }
      );

      expect(employeeDoc.save).toHaveBeenCalled();
      expect(result.permissions).toEqual([Permission.DOCUMENTS_UPLOAD]);
      expect(result.effectivePermissions).toEqual([Permission.DOCUMENTS_UPLOAD]);

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: adminCaller.sub,
          action: AuditAction.ADMIN_PERMISSION_CHANGE,
          resourceType: AuditResourceType.USER,
          resourceId: employeeTargetId,
          status: 'success',
          details: expect.objectContaining({
            granted: [Permission.DOCUMENTS_UPLOAD],
            revoked: [],
          }),
        })
      );
    });

    it('successfully revokes employee permission and logs diff', async () => {
      const employeeWithUpload = {
        ...mockEmployeeUser,
        permissions: [Permission.DOCUMENTS_UPLOAD],
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(UserModel, 'findById').mockResolvedValue(employeeWithUpload as any);
      const auditSpy = jest.spyOn(AuditService, 'log').mockResolvedValue(null as any);

      const result = await AdminUserService.updatePermissions(
        employeeTargetId,
        [], // Revoking all explicit permissions
        adminCaller
      );

      expect(result.permissions).toEqual([]);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            granted: [],
            revoked: [Permission.DOCUMENTS_UPLOAD],
          }),
        })
      );
    });
  });

  describe('updateStatus (Activate / Deactivate Lifecycle)', () => {
    it('rejects self-deactivation attempt with ForbiddenError', async () => {
      await expect(
        AdminUserService.updateStatus(adminCaller.sub, false, adminCaller)
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects deactivating the last active administrator with ForbiddenError', async () => {
      const adminDoc = {
        _id: new mongoose.Types.ObjectId(adminCaller.sub),
        role: Role.ADMIN,
        isActive: true,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(UserModel, 'findById').mockResolvedValue(adminDoc as any);
      jest.spyOn(UserModel, 'countDocuments').mockResolvedValue(1);

      await expect(
        AdminUserService.updateStatus(adminDoc._id.toString(), false, superAdminCaller)
      ).rejects.toThrow(ForbiddenError);
    });

    it('successfully deactivates regular user, increments tokenVersion, revokes sessions, and logs audit', async () => {
      const employeeDoc = {
        ...mockEmployeeUser,
        tokenVersion: 1,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(UserModel, 'findById').mockResolvedValue(employeeDoc as any);
      const sessionSpy = jest.spyOn(SessionModel, 'updateMany').mockResolvedValue({} as any);
      const auditSpy = jest.spyOn(AuditService, 'log').mockResolvedValue(null as any);

      const result = await AdminUserService.updateStatus(
        employeeTargetId,
        false,
        adminCaller,
        { ip: '127.0.0.1' }
      );

      expect(employeeDoc.isActive).toBe(false);
      expect(employeeDoc.tokenVersion).toBe(2);
      expect(employeeDoc.save).toHaveBeenCalled();
      expect(sessionSpy).toHaveBeenCalledWith(
        { userId: employeeDoc._id, isRevoked: false },
        { isRevoked: true, revokedReason: 'ACCOUNT_DEACTIVATED' }
      );
      expect(result.isActive).toBe(false);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ADMIN_STATUS_CHANGE,
          resourceId: employeeTargetId,
          status: 'success',
          details: expect.objectContaining({
            newStatus: false,
          }),
        })
      );
    });

    it('successfully reactivates deactivated user and logs audit', async () => {
      const deactivatedUser = {
        ...mockEmployeeUser,
        isActive: false,
        tokenVersion: 2,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(UserModel, 'findById').mockResolvedValue(deactivatedUser as any);
      const auditSpy = jest.spyOn(AuditService, 'log').mockResolvedValue(null as any);

      const result = await AdminUserService.updateStatus(
        employeeTargetId,
        true,
        adminCaller
      );

      expect(deactivatedUser.isActive).toBe(true);
      expect(deactivatedUser.save).toHaveBeenCalled();
      expect(result.isActive).toBe(true);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ADMIN_STATUS_CHANGE,
          resourceId: employeeTargetId,
          status: 'success',
          details: expect.objectContaining({
            newStatus: true,
          }),
        })
      );
    });
  });
});
