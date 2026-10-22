import {
  Role,
  ClearanceLevel,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';
import { UserModel, IUserDocument } from '../models/User.model.js';
import { SessionModel } from '../models/Session.model.js';
import { AuditService } from '../services/audit.service.js';
import { extractDatabaseNameFromUri } from '../config/db.js';
import { env } from '../config/env.js';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface IPromoteCliOptions {
  email: string;
  role?: Role;
  clearance?: ClearanceLevel;
  confirm?: boolean;
  dryRun?: boolean;
}

export interface ISanitizedDbIdentity {
  scheme: string;
  host: string;
  database: string;
  displayString: string;
}

export interface IPromoteValidationResult {
  canPromote: boolean;
  user?: IUserDocument;
  reason?: string;
  previousRole?: Role;
  targetRole?: Role;
  previousClearance?: ClearanceLevel;
  targetClearance?: ClearanceLevel;
}

export interface IPromoteResult {
  success: boolean;
  dryRun: boolean;
  targetUserId: string;
  email: string;
  name: string;
  department: string;
  previousRole: Role;
  newRole: Role;
  previousClearance: ClearanceLevel;
  newClearance: ClearanceLevel;
  revokedSessionsCount: number;
  auditLogged: boolean;
  database: ISanitizedDbIdentity;
}

/**
 * Parses raw command-line arguments into structured IPromoteCliOptions.
 * Throws an Error with a descriptive message if required arguments are missing or malformed.
 */
export function parsePromoteCliArgs(argv: string[]): IPromoteCliOptions {
  let email = '';
  let role: Role = Role.ADMIN;
  let clearance: ClearanceLevel = ClearanceLevel.RESTRICTED;
  let confirm = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--email' || arg === '-e') {
      email = argv[++i] || '';
    } else if (arg.startsWith('--email=')) {
      email = arg.split('=')[1] || '';
    } else if (arg === '--role' || arg === '-r') {
      const val = (argv[++i] || '').trim().toLowerCase();
      if (val === 'admin' || val === Role.ADMIN) {
        role = Role.ADMIN;
      } else if (val === 'super_admin' || val === Role.SUPER_ADMIN) {
        role = Role.SUPER_ADMIN;
      } else {
        throw new Error(
          `Invalid target role '${val}'. Only '${Role.ADMIN}' or '${Role.SUPER_ADMIN}' are permitted for administrative promotion.`
        );
      }
    } else if (arg.startsWith('--role=')) {
      const val = arg.split('=')[1]?.trim().toLowerCase() || '';
      if (val === 'admin' || val === Role.ADMIN) {
        role = Role.ADMIN;
      } else if (val === 'super_admin' || val === Role.SUPER_ADMIN) {
        role = Role.SUPER_ADMIN;
      } else {
        throw new Error(
          `Invalid target role '${val}'. Only '${Role.ADMIN}' or '${Role.SUPER_ADMIN}' are permitted for administrative promotion.`
        );
      }
    } else if (arg === '--clearance' || arg === '-c') {
      const val = (argv[++i] || '').trim().toLowerCase();
      if (Object.values(ClearanceLevel).includes(val as ClearanceLevel)) {
        clearance = val as ClearanceLevel;
      } else {
        throw new Error(
          `Invalid clearance level '${val}'. Valid options: ${Object.values(ClearanceLevel).join(', ')}`
        );
      }
    } else if (arg.startsWith('--clearance=')) {
      const val = arg.split('=')[1]?.trim().toLowerCase() || '';
      if (Object.values(ClearanceLevel).includes(val as ClearanceLevel)) {
        clearance = val as ClearanceLevel;
      } else {
        throw new Error(
          `Invalid clearance level '${val}'. Valid options: ${Object.values(ClearanceLevel).join(', ')}`
        );
      }
    } else if (arg === '--confirm' || arg === '--yes' || arg === '-y') {
      confirm = true;
    } else if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      // Caught by caller
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Missing required argument: --email <user@example.com>');
  }

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new Error(`Invalid email address format: "${normalizedEmail}"`);
  }

  return {
    email: normalizedEmail,
    role,
    clearance,
    confirm,
    dryRun,
  };
}

/**
 * Extracts sanitized host and database identity without exposing passwords,
 * usernames, tokens, or sensitive query parameters.
 */
export function sanitizeMongoIdentity(uri: string): ISanitizedDbIdentity {
  if (!uri || typeof uri !== 'string') {
    return {
      scheme: 'unknown',
      host: 'unknown',
      database: 'unknown',
      displayString: 'unknown',
    };
  }

  const trimmed = uri.trim();
  const schemeMatch = trimmed.match(/^mongodb(\+srv)?:\/\//i);
  const scheme = schemeMatch ? schemeMatch[0].replace('://', '') : 'mongodb';

  let withoutScheme = schemeMatch ? trimmed.slice(schemeMatch[0].length) : trimmed;
  const slashIdx = withoutScheme.indexOf('/');
  const qmarkIdx = withoutScheme.indexOf('?');
  const pathStart =
    slashIdx !== -1 ? slashIdx : qmarkIdx !== -1 ? qmarkIdx : withoutScheme.length;

  const authAndHosts = withoutScheme.substring(0, pathStart);
  const atIdx = authAndHosts.lastIndexOf('@');
  const hostsOnly = atIdx !== -1 ? authAndHosts.substring(atIdx + 1) : authAndHosts;

  const database = extractDatabaseNameFromUri(trimmed) || 'default';
  const displayString = `${database} on ${hostsOnly || 'localhost'}`;

  return {
    scheme,
    host: hostsOnly || 'localhost',
    database,
    displayString,
  };
}

/**
 * Validates whether a target user document is eligible for promotion.
 * Fails safely if user is missing, inactive, already at the requested role/clearance,
 * or if promotion would create an incompatible state.
 */
export function validatePromotionEligibility(
  user: IUserDocument | null,
  targetRole: Role,
  targetClearance: ClearanceLevel
): IPromoteValidationResult {
  if (!user) {
    return {
      canPromote: false,
      reason: 'Target account not found in database.',
    };
  }

  if (!user.isActive) {
    return {
      canPromote: false,
      user,
      reason: `Account "${user.email}" is currently inactive/deactivated. Deactivated accounts cannot be promoted to administrative roles.`,
    };
  }

  // Check for repeated execution / no-op
  if (user.role === targetRole && user.securityClearance === targetClearance) {
    return {
      canPromote: false,
      user,
      reason: `Account "${user.email}" is already configured with role '${user.role}' and clearance '${user.securityClearance}'. No changes are needed.`,
    };
  }

  // Prevent accidental demotion of SUPER_ADMIN when targeting ADMIN
  if (user.role === Role.SUPER_ADMIN && targetRole === Role.ADMIN) {
    return {
      canPromote: false,
      user,
      reason: `Account "${user.email}" already holds the higher privilege '${Role.SUPER_ADMIN}'. Will not demote to '${Role.ADMIN}'.`,
    };
  }

  return {
    canPromote: true,
    user,
    previousRole: user.role,
    targetRole,
    previousClearance: user.securityClearance,
    targetClearance,
  };
}

/**
 * Core promotion workflow. Executes validation, atomic user mutation, session revocation,
 * and cryptographic audit logging. Supports dry-run simulation.
 */
export async function executePromotionWorkflow(
  options: IPromoteCliOptions,
  customDbUri?: string
): Promise<IPromoteResult> {
  const dbUri = customDbUri || env.MONGODB_URI;
  const dbIdentity = sanitizeMongoIdentity(dbUri);

  if (!options.confirm && !options.dryRun) {
    throw new Error(
      'Execution aborted: deliberate confirmation required. Pass --confirm (or use interactive confirmation prompt).'
    );
  }

  const normalizedEmail = options.email.trim().toLowerCase();
  const targetRole = options.role || Role.ADMIN;
  const targetClearance = options.clearance || ClearanceLevel.RESTRICTED;

  // 1. Locate single exact target user
  const user = await UserModel.findOne({ email: normalizedEmail });

  // 2. Perform safety validation
  const validation = validatePromotionEligibility(user, targetRole, targetClearance);
  if (!validation.canPromote || !validation.user) {
    throw new Error(validation.reason || 'Account validation failed.');
  }

  const targetUser = validation.user;
  const previousRole = targetUser.role;
  const previousClearance = targetUser.securityClearance;

  // 3. Dry run path: return projected changes without modifying data
  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      targetUserId: targetUser._id.toString(),
      email: targetUser.email,
      name: targetUser.name,
      department: targetUser.department,
      previousRole,
      newRole: targetRole,
      previousClearance,
      newClearance: targetClearance,
      revokedSessionsCount: 0,
      auditLogged: false,
      database: dbIdentity,
    };
  }

  // 4. Mutate user record atomically: update role, clearance, and bump tokenVersion
  await UserModel.updateOne(
    { _id: targetUser._id },
    {
      $set: {
        role: targetRole,
        securityClearance: targetClearance,
      },
      $inc: {
        tokenVersion: 1,
      },
    }
  );

  // 5. Revoke all active sessions for target user to enforce re-authentication
  let revokedCount = 0;
  try {
    const revokeResult = await SessionModel.updateMany(
      { userId: targetUser._id, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedReason: `Administrative role elevation to ${targetRole} via CLI bootstrap`,
        },
      }
    );
    revokedCount = revokeResult.modifiedCount || 0;
  } catch (sessionErr) {
    // Session revocation failure should not block role promotion but is noted
    revokedCount = 0;
  }

  // 6. Cryptographically chained audit record
  let auditLogged = false;
  try {
    const auditRecord = await AuditService.log({
      userId: null, // Initiated via CLI command, not an authenticated web session
      action: AuditAction.ADMIN_ROLE_CHANGE,
      resourceType: AuditResourceType.USER,
      resourceId: targetUser._id.toString(),
      ipAddress: '127.0.0.1 (cli)',
      userAgent: 'CLI / promote-user bootstrap',
      status: 'success',
      details: {
        actor: 'cli.admin_bootstrap',
        targetUserId: targetUser._id.toString(),
        targetEmail: targetUser.email,
        previousRole,
        newRole: targetRole,
        previousClearance,
        newClearance: targetClearance,
        tokenVersionIncremented: true,
        sessionsRevoked: revokedCount,
        databaseTarget: dbIdentity.displayString,
        reason: 'One-time CLI administrative bootstrap promotion',
      },
    });

    auditLogged = Boolean(auditRecord);
  } catch (auditErr) {
    auditLogged = false;
  }

  return {
    success: true,
    dryRun: false,
    targetUserId: targetUser._id.toString(),
    email: targetUser.email,
    name: targetUser.name,
    department: targetUser.department,
    previousRole,
    newRole: targetRole,
    previousClearance,
    newClearance: targetClearance,
    revokedSessionsCount: revokedCount,
    auditLogged,
    database: dbIdentity,
  };
}
