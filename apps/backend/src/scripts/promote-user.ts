import readline from 'readline';
import {
  parsePromoteCliArgs,
  sanitizeMongoIdentity,
  validatePromotionEligibility,
  executePromotionWorkflow,
  IPromoteCliOptions,
} from './promote-user.service.js';
import { UserModel } from '../models/User.model.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';

function printHelp(): void {
  console.log(`
================================================================================
 Enterprise AI Copilot — Administrator Bootstrap & Promotion Tool
================================================================================

Usage:
  npm run admin:promote -- --email <user@example.com> [options]

Required:
  --email, -e <email>         Target user email address (required)

Options:
  --role, -r <role>           Role to assign: 'admin' (default) or 'super_admin'
  --clearance, -c <level>     Security clearance level:
                              'public', 'internal', 'confidential', 'restricted' (default: 'restricted')
  --confirm, -y               Acknowledge and confirm promotion without interactive prompt
  --dry-run, -n               Simulate the promotion without making database mutations
  --help, -h                  Display this help reference

Safety Guarantees:
  * Targets a single account by exact email. Bulk promotion is prohibited.
  * Validates account existence, active status, and role compatibility.
  * Prevents no-op mutations if the account already holds the target role.
  * Masks connection strings and prevents credential exposure.
  * Records a tamper-evident cryptographic audit log entry.
  * Invalidates existing user sessions and increments tokenVersion to enforce fresh login.

Examples:
  # Simulate promotion with dry-run
  npm run admin:promote -- --email user@enterprise.com --dry-run

  # Promote account with explicit confirmation flag
  npm run admin:promote -- --email user@enterprise.com --confirm

  # Promote account to super_admin with restricted clearance
  npm run admin:promote -- --email user@enterprise.com --role super_admin --confirm
================================================================================
`);
}

async function promptInteractiveConfirmation(promptText: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'yes' || normalized === 'y' || normalized === 'confirm');
    });
  });
}

export async function runPromoteCli(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    printHelp();
    return 0;
  }

  let options: IPromoteCliOptions;
  try {
    options = parsePromoteCliArgs(argv);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[ARGUMENT ERROR] ${msg}`);
    console.error('Run "npm run admin:promote -- --help" for usage information.\n');
    return 1;
  }

  const dbIdentity = sanitizeMongoIdentity(env.MONGODB_URI);
  console.log('\n================================================================================');
  console.log(' Enterprise AI Copilot — Administrator Bootstrap');
  console.log('================================================================================');
  console.log(`Database Target: ${dbIdentity.displayString}`);
  console.log(`Target Email:    ${options.email}`);
  console.log(`Requested Role:  ${options.role || Role.ADMIN}`);
  console.log(`Clearance:       ${options.clearance || ClearanceLevel.RESTRICTED}`);
  if (options.dryRun) {
    console.log('Execution Mode:  [DRY RUN - Simulation Only]');
  }
  console.log('--------------------------------------------------------------------------------');

  try {
    // Connect to database
    await connectDatabase();

    // Query target user
    const user = await UserModel.findOne({ email: options.email });
    const targetRole = options.role || Role.ADMIN;
    const targetClearance = options.clearance || ClearanceLevel.RESTRICTED;

    const validation = validatePromotionEligibility(user, targetRole, targetClearance);
    if (!validation.canPromote || !validation.user) {
      console.error(`\n[VALIDATION REJECTED] ${validation.reason}\n`);
      return 1;
    }

    const targetUser = validation.user;

    console.log(' Target Account Found:');
    console.log(`   * User ID:            ${targetUser._id}`);
    console.log(`   * Name:               ${targetUser.name}`);
    console.log(`   * Email:              ${targetUser.email}`);
    console.log(`   * Department:         ${targetUser.department}`);
    console.log(`   * Current Role:       ${targetUser.role}  ==>  New Role: ${targetRole}`);
    console.log(`   * Current Clearance:  ${targetUser.securityClearance}  ==>  New Clearance: ${targetClearance}`);
    console.log(`   * Active Status:      ${targetUser.isActive ? 'Active' : 'Inactive'}`);
    console.log('--------------------------------------------------------------------------------');

    if (options.dryRun) {
      console.log('\n[DRY RUN COMPLETE] Validation succeeded. Account is eligible for promotion.');
      console.log('No database records were modified.\n');
      return 0;
    }

    // Require deliberate confirmation
    if (!options.confirm) {
      if (!process.stdin.isTTY) {
        console.error(
          '\n[ERROR] Deliberate confirmation required: pass --confirm in non-interactive environments.\n'
        );
        return 1;
      }

      const confirmed = await promptInteractiveConfirmation(
        `Type 'YES' to confirm promoting "${targetUser.email}" to "${targetRole}": `
      );

      if (!confirmed) {
        console.log('\n[CANCELLED] Promotion cancelled by user. No database records were modified.\n');
        return 0;
      }
    }

    // Execute promotion workflow
    const result = await executePromotionWorkflow({ ...options, confirm: true });

    console.log('\n================================================================================');
    console.log(' [PROMOTION SUCCESSFUL]');
    console.log('================================================================================');
    console.log(` User:               ${result.name} (${result.email})`);
    console.log(` User ID:            ${result.targetUserId}`);
    console.log(` Previous Role:      ${result.previousRole}  ==>  New Role: ${result.newRole}`);
    console.log(` Previous Clearance: ${result.previousClearance}  ==>  New Clearance: ${result.newClearance}`);
    console.log(` Revoked Sessions:   ${result.revokedSessionsCount} active sessions terminated`);
    console.log(` Token Version:      Incremented (invalidates existing JWT refresh chains)`);
    console.log(` Audit Chained:      ${result.auditLogged ? 'Recorded in tamper-evident audit log' : 'Failed to write audit'}`);
    console.log('--------------------------------------------------------------------------------');
    console.log(' NEXT STEPS FOR ADMINISTRATOR:');
    console.log(' 1. The user must sign in again at http://localhost:3000/login.');
    console.log(' 2. The new JWT will reflect the elevated administrator role.');
    console.log(' 3. Privileged administration views (/admin/analytics, /admin/audit) and');
    console.log('    unrestricted document ACL management will become active in the UI.');
    console.log('================================================================================\n');

    return 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[FATAL ERROR] Promotion execution failed: ${msg}\n`);
    return 1;
  } finally {
    try {
      await disconnectDatabase();
    } catch {
      // Ignore disconnect errors on shutdown
    }
  }
}

// Direct CLI invocation
if (process.argv[1] && process.argv[1].endsWith('promote-user.ts')) {
  runPromoteCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error('Unhandled bootstrap exception:', err);
      process.exit(1);
    });
}
