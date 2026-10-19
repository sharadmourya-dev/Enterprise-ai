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
