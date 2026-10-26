/**
 * Authentication and Authorization Types & Enums
 */

export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  COMPLIANCE_OFFICER = 'compliance_officer',
  KNOWLEDGE_MANAGER = 'knowledge_manager',
  SUPPORT_AGENT = 'support_agent',
  USER = 'user',
}

export enum ClearanceLevel {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted',
}

/**
 * Granular permissions for document lifecycle, administration, and auditing
 */
export enum Permission {
  DOCUMENTS_UPLOAD = 'documents:upload',
  DOCUMENTS_DELETE = 'documents:delete',
  DOCUMENTS_RETRY = 'documents:retry',
  DOCUMENTS_MANAGE_ACCESS = 'documents:manage_access',
  ADMIN_ANALYTICS = 'admin:analytics',
  ADMIN_AUDIT = 'admin:audit',
}

/**
 * Default role-to-permission mapping policy
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),
  [Role.ADMIN]: Object.values(Permission),
  [Role.KNOWLEDGE_MANAGER]: [
    Permission.DOCUMENTS_UPLOAD,
    Permission.DOCUMENTS_RETRY,
  ],
  [Role.COMPLIANCE_OFFICER]: [
    Permission.ADMIN_AUDIT,
  ],
  [Role.SUPPORT_AGENT]: [],
  [Role.USER]: [],
};

export interface IPermissionMeta {
  id: Permission;
  label: string;
  description: string;
  category: 'documents' | 'administration';
  isSensitive?: boolean;
}

export const PERMISSION_DEFINITIONS: Record<Permission, IPermissionMeta> = {
  [Permission.DOCUMENTS_UPLOAD]: {
    id: Permission.DOCUMENTS_UPLOAD,
    label: 'Upload Documents',
    description: 'Allows uploading knowledge documents scoped to the user’s department.',
    category: 'documents',
  },
  [Permission.DOCUMENTS_DELETE]: {
    id: Permission.DOCUMENTS_DELETE,
    label: 'Delete Documents',
    description: 'Allows deleting documents owned by the user or within department authority.',
    category: 'documents',
    isSensitive: true,
  },
  [Permission.DOCUMENTS_RETRY]: {
    id: Permission.DOCUMENTS_RETRY,
    label: 'Retry Failed Ingestion',
    description: 'Allows retrying failed document parsing and vector indexing jobs.',
    category: 'documents',
  },
  [Permission.DOCUMENTS_MANAGE_ACCESS]: {
    id: Permission.DOCUMENTS_MANAGE_ACCESS,
    label: 'Manage Document Access',
    description: 'Allows modifying clearance levels and department access classifications.',
    category: 'documents',
    isSensitive: true,
  },
  [Permission.ADMIN_ANALYTICS]: {
    id: Permission.ADMIN_ANALYTICS,
    label: 'View Analytics & Trends',
    description: 'Grants access to query analytics, usage dashboards, and ingestion statistics.',
    category: 'administration',
  },
  [Permission.ADMIN_AUDIT]: {
    id: Permission.ADMIN_AUDIT,
    label: 'View Audit Logs & Integrity',
    description: 'Grants access to cryptographic audit log chains and security verification.',
    category: 'administration',
    isSensitive: true,
  },
};

export interface IAdminUserListItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  securityClearance: ClearanceLevel;
  permissions: string[];
  effectivePermissions: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IAdminUserListResponse {
  users: IAdminUserListItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  availablePermissions: IPermissionMeta[];
}

export interface IUpdateUserPermissionsRequest {
  permissions: Permission[];
}

/**
 * Checks if a user claims object possesses the requested permission
 * based on role defaults and explicit user permissions.
 */
export function hasPermission(
  user: { role: Role; permissions?: string[] } | null | undefined,
  permission: Permission | string
): boolean {
  if (!user) return false;
  // Super admin and admin hold all permissions unconditionally
  if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
    return true;
  }
  // User-specific granted permissions
  if (user.permissions && user.permissions.includes(permission as string)) {
    return true;
  }
  // Role-based default permissions
  const rolePerms = ROLE_PERMISSIONS[user.role];
  if (rolePerms && rolePerms.includes(permission as Permission)) {
    return true;
  }
  return false;
}

/**
 * Numeric clearance ranking used for hierarchical comparison:
 * public (0) < internal (1) < confidential (2) < restricted (3)
 */
export const CLEARANCE_RANK: Record<ClearanceLevel, number> = {
  [ClearanceLevel.PUBLIC]: 0,
  [ClearanceLevel.INTERNAL]: 1,
  [ClearanceLevel.CONFIDENTIAL]: 2,
  [ClearanceLevel.RESTRICTED]: 3,
};

export interface IUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  securityClearance: ClearanceLevel;
  permissions?: string[];
  isActive: boolean;
  failedLoginAttempts: number;
  lockoutUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ISafeUser = Omit<IUser, 'failedLoginAttempts' | 'lockoutUntil'>;

export interface IJwtPayload {
  sub: string; // User ID
  email: string;
  role: Role;
  department: string;
  securityClearance: ClearanceLevel;
  permissions?: string[];
  sessionId: string; // Unique session identifier for targeted revocation
  iat?: number;
  exp?: number;
}

export interface IRefreshTokenPayload {
  sub: string; // User ID
  sessionId: string;
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export interface ITokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // Seconds until access token expiration
}

/**
 * Public registration contract:
 * NOTE: As per security requirements, public registration strictly disallows
 * self-assigning privileged roles or elevated security clearance.
 * Users registering publicly default to Role.USER and ClearanceLevel.INTERNAL (or PUBLIC).
 */
export interface IRegisterRequest {
  email: string;
  password: string;
  name: string;
  department: string;
}

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IRefreshTokenRequest {
  refreshToken: string;
}

export interface ISession {
  id: string;
  sessionId: string;
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  isRevoked: boolean;
  revokedReason?: string;
  tokenVersion: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
