import mongoose from 'mongoose';
import {
  Role,
  Permission,
  ROLE_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  IAdminUserListItem,
  IAdminUserListResponse,
  IPermissionMeta,
  IJwtPayload,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';
import { UserModel, IUserDocument } from '../models/User.model.js';
import { AuditService } from './audit.service.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';

export interface IListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role;
  department?: string;
}

export class AdminUserService {
  /**
   * Computes the full effective permissions for a user (combining role defaults and explicit grants)
   */
  public static computeEffectivePermissions(role: Role, explicitPermissions: string[] = []): string[] {
    if (role === Role.ADMIN || role === Role.SUPER_ADMIN) {
      return Object.values(Permission);
    }
    const roleDefaults = ROLE_PERMISSIONS[role] || [];
    const combined = new Set<string>([...roleDefaults, ...explicitPermissions]);
    return Array.from(combined);
  }

  /**
   * Formats a User document into a safe admin list item
   */
  public static formatUserListItem(user: IUserDocument): IAdminUserListItem {
    const rawPermissions = user.permissions || [];
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      securityClearance: user.securityClearance,
      permissions: rawPermissions,
      effectivePermissions: this.computeEffectivePermissions(user.role, rawPermissions),
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  /**
   * Lists users with pagination, search, and filtering
   */
  public static async listUsers(params: IListUsersParams): Promise<IAdminUserListResponse> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (params.search && params.search.trim()) {
      const sanitized = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: sanitized, $options: 'i' } },
        { email: { $regex: sanitized, $options: 'i' } },
      ];
    }

    if (params.role) {
      query.role = params.role;
    }

    if (params.department && params.department.trim()) {
      query.department = params.department.trim();
    }

    const [total, users] = await Promise.all([
      UserModel.countDocuments(query),
      UserModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    const formattedUsers = users.map((u) => this.formatUserListItem(u));
    const availablePermissions: IPermissionMeta[] = Object.values(PERMISSION_DEFINITIONS);

    return {
      users: formattedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      availablePermissions,
    };
  }

  /**
   * Retrieves a single user by ID
   */
  public static async getUserById(userId: string): Promise<IAdminUserListItem> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this.formatUserListItem(user);
  }

  /**
   * Updates explicitly assigned permissions for a target user with strict RBAC boundary checks
   */
  public static async updatePermissions(
    targetUserId: string,
    newPermissions: Permission[],
    caller: IJwtPayload,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<IAdminUserListItem> {
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    // 1. Guard against self-modification
    if (caller.sub === targetUserId) {
      throw new ForbiddenError('Administrators cannot modify their own permissions or privileges');
    }

    // 2. Fetch target user
    const targetUser = await UserModel.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundError('Target user not found');
    }

    // 3. Super Admin & Admin hierarchy protection
    if (targetUser.role === Role.SUPER_ADMIN && caller.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenError('Only Super Administrators can modify Super Administrator accounts');
    }

    if (targetUser.role === Role.ADMIN && caller.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenError('Only Super Administrators can modify Administrator accounts');
    }

    // 4. Validate permitted permissions
    const validPermissions = new Set(Object.values(Permission));
    for (const perm of newPermissions) {
      if (!validPermissions.has(perm)) {
        throw new BadRequestError(`Unsupported or invalid permission identifier: '${perm}'`);
      }
    }

    // 5. Restrict sensitive permissions to Super Admin
    if (caller.role !== Role.SUPER_ADMIN) {
      if (newPermissions.includes(Permission.ADMIN_AUDIT)) {
        throw new ForbiddenError('Only Super Administrators can grant audit log administration permissions');
      }
    }

    // 6. Deduplicate permissions
    const sanitizedPermissions = Array.from(new Set(newPermissions));
    const previousPermissions = targetUser.permissions || [];

    const granted = sanitizedPermissions.filter((p) => !previousPermissions.includes(p));
    const revoked = previousPermissions.filter((p) => !sanitizedPermissions.includes(p as Permission));

    // 7. Update target user
    targetUser.permissions = sanitizedPermissions;
    await targetUser.save();

    // 8. Record audit log entry
    await AuditService.log({
      userId: caller.sub,
      action: AuditAction.ADMIN_PERMISSION_CHANGE,
      resourceType: AuditResourceType.USER,
      resourceId: targetUser._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: {
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        previousPermissions,
        newPermissions: sanitizedPermissions,
        granted,
        revoked,
      },
    });

    return this.formatUserListItem(targetUser);
  }
}
