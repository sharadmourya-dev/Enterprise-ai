import mongoose from 'mongoose';
import { env } from './env.js';

let isConnected = false;

/**
 * Approved local hostnames for test database execution.
 * Only loopback targets are permitted initially.
 * Service hostnames like 'mongodb' must be evaluated separately if needed.
 */
export const APPROVED_LOCAL_TEST_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
]);

/**
 * Checks whether a given hostname string is an approved local test host.
 */
export function isApprovedLocalMongoHost(host: string): boolean {
  if (!host || typeof host !== 'string') return false;
  return APPROVED_LOCAL_TEST_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Checks whether the host string or URI corresponds to a remote/cloud MongoDB instance
 * (e.g. MongoDB Atlas, AWS, Azure, GCP).
 */
export function isCloudMongoTarget(target: string): boolean {
  if (!target || typeof target !== 'string') return false;
  const lower = target.toLowerCase();
  return (
    lower.includes('mongodb+srv') ||
    lower.includes('mongodb.net') ||
    lower.includes('.aws.') ||
    lower.includes('.azure.') ||
    lower.includes('.gcp.') ||
    lower.includes('cloud')
  );
}

/**
 * Structurally extracts hostnames from a MongoDB URI without exposing credentials.
 * Rejects unsupported schemes (e.g., mongodb+srv://), malformed hosts, or missing authority.
 */
export function extractHostsFromMongoUri(uri: string): string[] {
  if (!uri || typeof uri !== 'string') {
    throw new Error('FATAL TEST SAFETY ERROR: Invalid or empty MongoDB URI.');
  }

  const trimmed = uri.trim();
  if (trimmed.startsWith('mongodb+srv://')) {
    throw new Error(
      'FATAL TEST SAFETY ERROR: Cloud/SRV schemes (mongodb+srv://) are strictly prohibited for test execution.'
    );
  }
  if (!trimmed.startsWith('mongodb://')) {
    throw new Error(
      'FATAL TEST SAFETY ERROR: Unsupported MongoDB URI scheme. Must start with "mongodb://".'
    );
  }

  const withoutScheme = trimmed.slice('mongodb://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  const qmarkIdx = withoutScheme.indexOf('?');
  const pathStart =
    slashIdx !== -1 ? slashIdx : qmarkIdx !== -1 ? qmarkIdx : withoutScheme.length;

  const authAndHosts = withoutScheme.substring(0, pathStart);
  if (!authAndHosts) {
    throw new Error('FATAL TEST SAFETY ERROR: Missing host specification in MongoDB URI.');
  }

  const atIdx = authAndHosts.lastIndexOf('@');
  const hostsString = atIdx !== -1 ? authAndHosts.substring(atIdx + 1) : authAndHosts;

  if (!hostsString) {
    throw new Error('FATAL TEST SAFETY ERROR: Missing host specification in MongoDB URI.');
  }

  const hostEntries = hostsString.split(',').map((h) => h.trim());
  if (hostEntries.length === 0 || hostEntries.some((h) => !h)) {
    throw new Error('FATAL TEST SAFETY ERROR: Malformed host list in MongoDB URI.');
  }

  const hostnames: string[] = [];
  for (const entry of hostEntries) {
    let hostname: string;
    if (entry.startsWith('[')) {
      const closingBracket = entry.indexOf(']');
      if (closingBracket === -1) {
        throw new Error('FATAL TEST SAFETY ERROR: Malformed IPv6 host in MongoDB URI.');
      }
      hostname = entry.substring(1, closingBracket);
    } else {
      const parts = entry.split(':');
      if (parts.length > 2) {
        throw new Error('FATAL TEST SAFETY ERROR: Malformed host:port entry in MongoDB URI.');
      }
      hostname = parts[0];
    }

    if (!hostname) {
      throw new Error('FATAL TEST SAFETY ERROR: Empty hostname in MongoDB URI entry.');
    }
    hostnames.push(hostname.toLowerCase());
  }

  return hostnames;
}

/**
 * Extracts the database name component from a MongoDB connection URI structurally.
 */
export function extractDatabaseNameFromUri(uri: string): string {
  if (!uri || typeof uri !== 'string') return '';
  const trimmed = uri.trim();
  const schemeMatch = trimmed.match(/^mongodb(\+srv)?:\/\//i);
  if (!schemeMatch) return '';

  const withoutScheme = trimmed.slice(schemeMatch[0].length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx === -1) return '';

  const afterSlash = withoutScheme.slice(slashIdx + 1);
  const qmarkIdx = afterSlash.indexOf('?');
  const pathOnly = qmarkIdx !== -1 ? afterSlash.slice(0, qmarkIdx) : afterSlash;

  const dbName = pathOnly.split('/')[0] || '';
  return decodeURIComponent(dbName).trim();
}

/**
 * Checks whether a database name follows an explicit test naming convention:
 * must end with '_test', '-test', or '.test', start with 'test_', 'test-', or 'test.',
 * or equal 'test'.
 * Prevents false positives where production databases happen to contain the substring 'test'
 * (e.g. 'contest_db', 'latest_users', 'attestation').
 */
export function isExplicitTestDatabaseName(dbName: string): boolean {
  if (!dbName || typeof dbName !== 'string') return false;
  const trimmed = dbName.trim().toLowerCase();
  return /^(test[_.-]|.+[_.-]test$|^test$)/.test(trimmed);
}

/**
 * Verifies that a MongoDB URI intended for testing is completely isolated,
 * local/disposable, and cannot destroy real application or cloud data.
 */
export function assertSafeTestDatabaseUri(uri: string, customAppUri?: string): void {
  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    throw new Error('FATAL TEST SAFETY ERROR: MONGODB_TEST_URI is required and cannot be empty.');
  }

  // 1. Cloud denylist check
  if (isCloudMongoTarget(uri)) {
    throw new Error(
      'FATAL TEST SAFETY ERROR: Cloud MongoDB targets are strictly prohibited for test execution. Tests must target an isolated local test database.'
    );
  }

  // 2. Structural host extraction & local allowlist check
  const hosts = extractHostsFromMongoUri(uri);
  if (hosts.length === 0) {
    throw new Error('FATAL TEST SAFETY ERROR: No valid hosts found in test database URI.');
  }

  for (const host of hosts) {
    if (!isApprovedLocalMongoHost(host)) {
      throw new Error(
        `FATAL TEST SAFETY ERROR: Target host "${host}" is not an approved local test host. Test execution is strictly restricted to: ${Array.from(APPROVED_LOCAL_TEST_HOSTS).join(', ')}.`
      );
    }
  }

  // 3. Extract test database name
  const dbName = extractDatabaseNameFromUri(uri);
  if (!dbName) {
    throw new Error('FATAL TEST SAFETY ERROR: Missing database name in MONGODB_TEST_URI.');
  }

  // 4. Ensure test URI does not match application URI
  const appUri = customAppUri !== undefined ? customAppUri : env.MONGODB_URI;
  if (appUri && uri.trim() === appUri.trim()) {
    throw new Error(
      'FATAL TEST SAFETY ERROR: MONGODB_TEST_URI must not be identical to application MONGODB_URI.'
    );
  }

  const appDbName = extractDatabaseNameFromUri(appUri);
  if (appDbName && dbName === appDbName) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Test database name "${dbName}" must not be identical to application database name.`
    );
  }

  // 5. Ensure test database name follows explicit test naming convention
  if (!isExplicitTestDatabaseName(dbName)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Test database name "${dbName}" must follow an explicit test naming convention (e.g. ending with "_test" or starting with "test_") to prevent accidental data destruction.`
    );
  }
}

/**
 * Verifies that an active Mongoose connection is connected to a safe,
 * local, disposable database before executing any destructive operations (such as dropDatabase).
 */
export function assertSafeTestDatabaseConnection(
  conn: mongoose.Connection,
  expectedTestUri?: string
): void {
  if (!conn || conn.readyState !== 1) {
    const state = conn ? conn.readyState : 'undefined';
    throw new Error(
      `FATAL TEST SAFETY ERROR: Connection is not active (readyState=${state}). Cannot verify test database safety.`
    );
  }

  // 1. Verify configured test URI first
  const targetUri = expectedTestUri !== undefined ? expectedTestUri : env.MONGODB_TEST_URI;
  assertSafeTestDatabaseUri(targetUri);

  const expectedDbName = extractDatabaseNameFromUri(targetUri);
  if (!expectedDbName) {
    throw new Error(
      'FATAL TEST SAFETY ERROR: Could not determine expected test database name from MONGODB_TEST_URI.'
    );
  }

  // 2. Active connection host must be an approved local host
  const connHost = (conn.host || '').trim().toLowerCase();
  if (!connHost || !isApprovedLocalMongoHost(connHost)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Active connection host "${connHost}" is not an approved local test host.`
    );
  }

  if (isCloudMongoTarget(connHost)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Destructive database operation rejected against cloud host "${connHost}".`
    );
  }

  // 3. Active database name must exactly match configured test database name
  const activeDbName = (conn.name || '').trim();
  if (!activeDbName) {
    throw new Error('FATAL TEST SAFETY ERROR: Active connection has no database name specified.');
  }

  if (activeDbName !== expectedDbName) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Connected database name "${activeDbName}" does not exactly match configured test database name "${expectedDbName}". Destructive teardown rejected.`
    );
  }

  // 4. Active database name must follow explicit test naming convention
  if (!isExplicitTestDatabaseName(activeDbName)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Destructive database operation rejected on database "${activeDbName}". Database name must follow an explicit test naming convention.`
    );
  }
}

export async function connectDatabase(uri?: string): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const isTest = env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test';
  let targetUri: string;

  if (isTest) {
    targetUri = uri || env.MONGODB_TEST_URI;
    if (!targetUri) {
      throw new Error(
        'FATAL TEST SAFETY ERROR: In test mode, MONGODB_TEST_URI must be provided and cannot fall back to application database.'
      );
    }
    assertSafeTestDatabaseUri(targetUri);
  } else {
    targetUri = uri || env.MONGODB_URI;
  }

  try {
    const conn = await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true,
    });

    if (isTest) {
      assertSafeTestDatabaseConnection(conn.connection);
    }

    isConnected = true;
    return conn;
  } catch (error) {
    isConnected = false;
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (isConnected || mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
