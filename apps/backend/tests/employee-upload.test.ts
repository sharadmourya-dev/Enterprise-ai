import { Request, Response, NextFunction } from 'express';
import {
  Role,
  ClearanceLevel,
  Permission,
  hasPermission,
  ROLE_PERMISSIONS,
  IJwtPayload,
} from '@enterprise-ai/shared-types';
import { requirePermission } from '../src/middlewares/rbac.middleware.js';
import { DocumentService } from '../src/services/document.service.js';
import { DocumentModel } from '../src/models/Document.model.js';
import { UserModel } from '../src/models/User.model.js';
import { FileValidator } from '../src/services/parsers/file-validator.js';
import { StorageService } from '../src/services/storage.service.js';
import { enqueueDocumentIngestion } from '../src/queue/ingestion.queue.js';
import { AuditService } from '../src/services/audit.service.js';
import { ForbiddenError, UnauthorizedError } from '../src/utils/errors.js';

describe('Employee Document Upload Authorization & Security Policy', () => {
  describe('1. hasPermission Policy Matrix', () => {
    it('grants all permissions to Role.ADMIN and Role.SUPER_ADMIN unconditionally', () => {
      const adminUser: IJwtPayload = {
        sub: 'admin-1',
        email: 'admin@enterprise.com',
        role: Role.ADMIN,
        department: 'IT',
        securityClearance: ClearanceLevel.RESTRICTED,
        sessionId: 'sess-admin',
      };

      const superAdminUser: IJwtPayload = {
        sub: 'super-1',
        email: 'super@enterprise.com',
        role: Role.SUPER_ADMIN,
        department: 'IT',
        securityClearance: ClearanceLevel.RESTRICTED,
        sessionId: 'sess-super',
      };

      for (const perm of Object.values(Permission)) {
        expect(hasPermission(adminUser, perm)).toBe(true);
        expect(hasPermission(superAdminUser, perm)).toBe(true);
      }
    });

    it('grants DOCUMENTS_UPLOAD and DOCUMENTS_RETRY to Role.KNOWLEDGE_MANAGER by role policy', () => {
      const kmUser: IJwtPayload = {
        sub: 'km-1',
        email: 'km@enterprise.com',
        role: Role.KNOWLEDGE_MANAGER,
        department: 'Operations',
        securityClearance: ClearanceLevel.CONFIDENTIAL,
        sessionId: 'sess-km',
      };

      expect(hasPermission(kmUser, Permission.DOCUMENTS_UPLOAD)).toBe(true);
      expect(hasPermission(kmUser, Permission.DOCUMENTS_RETRY)).toBe(true);
      expect(hasPermission(kmUser, Permission.ADMIN_ANALYTICS)).toBe(false);
      expect(hasPermission(kmUser, Permission.ADMIN_AUDIT)).toBe(false);
    });

    it('denies DOCUMENTS_UPLOAD to standard employee without explicit upload permission', () => {
      const standardEmployee: IJwtPayload = {
        sub: 'emp-1',
        email: 'employee@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess-emp-1',
        permissions: [],
      };

      expect(hasPermission(standardEmployee, Permission.DOCUMENTS_UPLOAD)).toBe(false);
      expect(hasPermission(standardEmployee, Permission.DOCUMENTS_DELETE)).toBe(false);
      expect(hasPermission(standardEmployee, Permission.DOCUMENTS_RETRY)).toBe(false);
      expect(hasPermission(standardEmployee, Permission.ADMIN_ANALYTICS)).toBe(false);
    });

    it('grants DOCUMENTS_UPLOAD to employee explicitly assigned documents:upload claim', () => {
      const authorizedEmployee: IJwtPayload = {
        sub: 'emp-2',
        email: 'authorized@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess-emp-2',
        permissions: [Permission.DOCUMENTS_UPLOAD],
      };

      expect(hasPermission(authorizedEmployee, Permission.DOCUMENTS_UPLOAD)).toBe(true);
      // Explicit upload permission does NOT grant administrative permissions
      expect(hasPermission(authorizedEmployee, Permission.DOCUMENTS_DELETE)).toBe(false);
      expect(hasPermission(authorizedEmployee, Permission.DOCUMENTS_RETRY)).toBe(false);
      expect(hasPermission(authorizedEmployee, Permission.ADMIN_ANALYTICS)).toBe(false);
      expect(hasPermission(authorizedEmployee, Permission.ADMIN_AUDIT)).toBe(false);
    });

    it('returns false safely when user is null or undefined', () => {
      expect(hasPermission(null, Permission.DOCUMENTS_UPLOAD)).toBe(false);
      expect(hasPermission(undefined, Permission.DOCUMENTS_UPLOAD)).toBe(false);
    });
  });

  describe('2. requirePermission Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: jest.Mock;

    beforeEach(() => {
      mockReq = { headers: {} };
      mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      mockNext = jest.fn();
    });

    it('throws UnauthorizedError when req.user is absent', () => {
      const middleware = requirePermission(Permission.DOCUMENTS_UPLOAD);
      expect(() => middleware(mockReq as Request, mockRes as Response, mockNext)).toThrow(
        UnauthorizedError
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError with INSUFFICIENT_ROLE_PERMISSIONS when employee lacks permission', () => {
      mockReq.user = {
        sub: 'user-1',
        email: 'user1@enterprise.com',
        role: Role.USER,
        department: 'Finance',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess-1',
        permissions: [],
      };

      const middleware = requirePermission(Permission.DOCUMENTS_UPLOAD);
      expect(() => middleware(mockReq as Request, mockRes as Response, mockNext)).toThrow(
        ForbiddenError
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() when employee possesses DOCUMENTS_UPLOAD permission', () => {
      mockReq.user = {
        sub: 'user-2',
        email: 'user2@enterprise.com',
        role: Role.USER,
        department: 'Finance',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess-2',
        permissions: [Permission.DOCUMENTS_UPLOAD],
      };

      const middleware = requirePermission(Permission.DOCUMENTS_UPLOAD);
      middleware(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('calls next() unconditionally for Role.ADMIN', () => {
      mockReq.user = {
        sub: 'admin-1',
        email: 'admin@enterprise.com',
        role: Role.ADMIN,
        department: 'IT',
        securityClearance: ClearanceLevel.RESTRICTED,
        sessionId: 'sess-admin',
      };

      const middleware = requirePermission(Permission.DOCUMENTS_UPLOAD);
      middleware(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. DocumentService.uploadDocument Access Control & Safe Defaults', () => {
    const fileBuffer = Buffer.from('Enterprise security policies and engineering documentation.');
    const originalFilename = 'guidelines.txt';
    const declaredMimeType = 'text/plain';

    const authorizedEmployeeUser: IJwtPayload = {
      sub: '671350a12f3e8b0012345671',
      email: 'employee@enterprise.com',
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: 'sess_emp',
      permissions: [Permission.DOCUMENTS_UPLOAD],
    };

    const unauthorizedEmployeeUser: IJwtPayload = {
      sub: '671350a12f3e8b0012345672',
      email: 'unauthorized@enterprise.com',
      role: Role.USER,
      department: 'Marketing',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: 'sess_unauth',
      permissions: [],
    };

    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(FileValidator, 'validate').mockReturnValue({
        sanitizedFilename: 'guidelines.txt',
        mimeType: 'text/plain' as any,
        fileSizeBytes: fileBuffer.length,
        fileHash: 'sha256_mock_hash_123',
      });
      jest.spyOn(StorageService, 'saveFile').mockResolvedValue({
        storagePath: './data/uploads/guidelines-123.txt',
      });
      jest.spyOn(StorageService, 'deleteFile').mockResolvedValue();
      jest.spyOn(AuditService, 'log').mockResolvedValue();
      jest.spyOn(UserModel, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue({
          role: Role.USER,
          permissions: [Permission.DOCUMENTS_UPLOAD],
        }),
      } as any);
    });

    it('rejects upload when employee lacks DOCUMENTS_UPLOAD permission', async () => {
      await expect(
        DocumentService.uploadDocument(
          fileBuffer,
          originalFilename,
          declaredMimeType,
          unauthorizedEmployeeUser
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects upload when live database record has revoked permission despite valid JWT', async () => {
      jest.spyOn(UserModel, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue({
          role: Role.USER,
          permissions: [], // Permissions revoked in database
        }),
      } as any);

      await expect(
        DocumentService.uploadDocument(
          fileBuffer,
          originalFilename,
          declaredMimeType,
          authorizedEmployeeUser
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('derives uploader identity strictly from verified server JWT context', async () => {
      jest.spyOn(DocumentModel, 'findOne').mockResolvedValue(null);
      const createSpy = jest.spyOn(DocumentModel, 'create').mockResolvedValue({
        _id: '671350a12f3e8b0012345699',
        title: 'Guidelines',
        originalFilename: 'guidelines.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        storagePath: './data/uploads/guidelines-123.txt',
        fileHash: 'sha256_mock_hash_123',
        status: 'queued',
        createdAt: new Date(),
        uploadedBy: authorizedEmployeeUser.sub,
      } as any);
      jest.spyOn(DocumentModel, 'updateOne').mockResolvedValue({} as any);

      await DocumentService.uploadDocument(
        fileBuffer,
        originalFilename,
        declaredMimeType,
        authorizedEmployeeUser
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadedBy: authorizedEmployeeUser.sub,
        })
      );
    });

    it('defaults employee uploads to their own department (never wildcard all departments)', async () => {
      jest.spyOn(DocumentModel, 'findOne').mockResolvedValue(null);
      const createSpy = jest.spyOn(DocumentModel, 'create').mockResolvedValue({
        _id: '671350a12f3e8b0012345699',
        title: 'Guidelines',
        originalFilename: 'guidelines.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        storagePath: './data/uploads/guidelines-123.txt',
        fileHash: 'sha256_mock_hash_123',
        status: 'queued',
        createdAt: new Date(),
        uploadedBy: authorizedEmployeeUser.sub,
      } as any);
      jest.spyOn(DocumentModel, 'updateOne').mockResolvedValue({} as any);

      await DocumentService.uploadDocument(
        fileBuffer,
        originalFilename,
        declaredMimeType,
        authorizedEmployeeUser,
        {
          allowedDepartments: [], // Client leaves empty
        }
      );

      // Must be safely bound to user.department ('Engineering'), NOT []
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          accessControl: expect.objectContaining({
            allowedDepartments: ['Engineering'],
          }),
        })
      );
    });

    it('rejects employee attempting to assign document to foreign department', async () => {
      jest.spyOn(DocumentModel, 'findOne').mockResolvedValue(null);

      await expect(
        DocumentService.uploadDocument(
          fileBuffer,
          originalFilename,
          declaredMimeType,
          authorizedEmployeeUser,
          {
            allowedDepartments: ['Finance'], // Alice is in Engineering
          }
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects employee attempting to assign clearance exceeding own rank', async () => {
      jest.spyOn(DocumentModel, 'findOne').mockResolvedValue(null);

      await expect(
        DocumentService.uploadDocument(
          fileBuffer,
          originalFilename,
          declaredMimeType,
          authorizedEmployeeUser,
          {
            minimumClearance: ClearanceLevel.RESTRICTED, // Alice has INTERNAL
          }
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects employee attempting to configure user-specific access restrictions', async () => {
      jest.spyOn(DocumentModel, 'findOne').mockResolvedValue(null);

      await expect(
        DocumentService.uploadDocument(
          fileBuffer,
          originalFilename,
          declaredMimeType,
          authorizedEmployeeUser,
          {
            allowedUserIds: ['671350a12f3e8b0012345699'],
          }
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('4. Deletion and Mutation Protection for Non-Admins', () => {
    it('rejects non-admin attempting to delete document owned by someone else', async () => {
      const foreignDoc = {
        _id: '671350a12f3e8b0012345688',
        title: 'CEO Strategic Plan',
        uploadedBy: '671350a12f3e8b0012345600', // Other user
        accessControl: {
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedDepartments: ['Engineering'],
          allowedRoles: [],
          allowedUserIds: [],
        },
      };

      jest.spyOn(DocumentService, 'getDocumentById').mockResolvedValue(foreignDoc as any);

      const callerUser: IJwtPayload = {
        sub: '671350a12f3e8b0012345671', // Different ID
        email: 'alice@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_alice',
        permissions: [Permission.DOCUMENTS_UPLOAD],
      };

      await expect(
        DocumentService.deleteDocument(foreignDoc._id, callerUser)
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects non-admin attempting to retry processing of another users failed document', async () => {
      const foreignFailedDoc = {
        _id: '671350a12f3e8b0012345688',
        title: 'HR Handbook',
        status: 'failed',
        uploadedBy: '671350a12f3e8b0012345600', // Other user
        accessControl: {
          minimumClearance: ClearanceLevel.INTERNAL,
          allowedDepartments: ['Engineering'],
          allowedRoles: [],
          allowedUserIds: [],
        },
      };

      jest.spyOn(DocumentService, 'getDocumentById').mockResolvedValue(foreignFailedDoc as any);

      const callerUser: IJwtPayload = {
        sub: '671350a12f3e8b0012345671',
        email: 'alice@enterprise.com',
        role: Role.USER,
        department: 'Engineering',
        securityClearance: ClearanceLevel.INTERNAL,
        sessionId: 'sess_alice',
        permissions: [Permission.DOCUMENTS_UPLOAD],
      };

      await expect(
        DocumentService.retryDocument(foreignFailedDoc._id, callerUser)
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
