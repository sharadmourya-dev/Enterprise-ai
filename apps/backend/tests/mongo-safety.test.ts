import {
  APPROVED_LOCAL_TEST_HOSTS,
  isApprovedLocalMongoHost,
  isExplicitTestDatabaseName,
  extractHostsFromMongoUri,
  extractDatabaseNameFromUri,
  assertSafeTestDatabaseUri,
  assertSafeTestDatabaseConnection,
} from '../src/config/db.js';

describe('MongoDB Test Safety Guards (Isolated Unit Tests)', () => {
  const VALID_LOCAL_TEST_URI =
    'mongodb://127.0.0.1:27017/enterprise_ai_test?replicaSet=rs0&directConnection=true';
  const VALID_APP_URI =
    'mongodb://127.0.0.1:27017/enterprise_ai?replicaSet=rs0&directConnection=true';

  describe('Local Host Allowlist (APPROVED_LOCAL_TEST_HOSTS)', () => {
    it('accepts approved loopback hosts: localhost, 127.0.0.1, ::1', () => {
      expect(isApprovedLocalMongoHost('localhost')).toBe(true);
      expect(isApprovedLocalMongoHost('127.0.0.1')).toBe(true);
      expect(isApprovedLocalMongoHost('::1')).toBe(true);
      expect(APPROVED_LOCAL_TEST_HOSTS.has('127.0.0.1')).toBe(true);
    });

    it('rejects remote IP addresses', () => {
      expect(isApprovedLocalMongoHost('192.168.1.50')).toBe(false);
      expect(isApprovedLocalMongoHost('10.0.0.1')).toBe(false);
      expect(isApprovedLocalMongoHost('172.16.0.1')).toBe(false);
    });

    it('rejects 0.0.0.0 and arbitrary service hostnames without prior authorization', () => {
      expect(isApprovedLocalMongoHost('0.0.0.0')).toBe(false);
      expect(isApprovedLocalMongoHost('mongodb')).toBe(false);
    });

    it('rejects remote hostnames not recognized by cloud denylist', () => {
      expect(isApprovedLocalMongoHost('internal-db.corp.local')).toBe(false);
      expect(isApprovedLocalMongoHost('staging-mongo.company.com')).toBe(false);
    });
  });

  describe('Structural URI Parsing (extractHostsFromMongoUri & extractDatabaseNameFromUri)', () => {
    it('extracts host from standard single-host URI', () => {
      expect(extractHostsFromMongoUri('mongodb://127.0.0.1:27017/test_db')).toEqual(['127.0.0.1']);
      expect(extractDatabaseNameFromUri('mongodb://127.0.0.1:27017/test_db')).toBe('test_db');
    });

    it('extracts multiple hosts from replica-set URI with query params', () => {
      const uri = 'mongodb://127.0.0.1:27017,localhost:27018/enterprise_ai_test?replicaSet=rs0';
      expect(extractHostsFromMongoUri(uri)).toEqual(['127.0.0.1', 'localhost']);
      expect(extractDatabaseNameFromUri(uri)).toBe('enterprise_ai_test');
    });

    it('extracts IPv6 host formatted with brackets', () => {
      expect(extractHostsFromMongoUri('mongodb://[::1]:27017/my_app_test')).toEqual(['::1']);
      expect(extractDatabaseNameFromUri('mongodb://[::1]:27017/my_app_test')).toBe('my_app_test');
    });

    it('extracts host when credentials are present without printing them', () => {
      const uri = 'mongodb://app_user:secret_pass@127.0.0.1:27017/enterprise_ai_test';
      expect(extractHostsFromMongoUri(uri)).toEqual(['127.0.0.1']);
      expect(extractDatabaseNameFromUri(uri)).toBe('enterprise_ai_test');
    });

    it('rejects cloud/SRV scheme (mongodb+srv://)', () => {
      expect(() => extractHostsFromMongoUri('mongodb+srv://cluster.mongodb.net/test_db')).toThrow(
        /Cloud\/SRV schemes \(mongodb\+srv:\/\/.*\) are strictly prohibited/
      );
    });

    it('rejects malformed URI or missing host', () => {
      expect(() => extractHostsFromMongoUri('mongodb:///test_db')).toThrow(
        /Missing host specification/
      );
      expect(() => extractHostsFromMongoUri('not-a-mongo-uri')).toThrow(
        /Unsupported MongoDB URI scheme/
      );
      expect(() => extractHostsFromMongoUri('mongodb://[::1/test_db')).toThrow(
        /Malformed IPv6 host/
      );
    });
  });

  describe('Explicit Test Database Naming Rule (isExplicitTestDatabaseName)', () => {
    it('accepts explicitly recognized test database names', () => {
      expect(isExplicitTestDatabaseName('enterprise_ai_test')).toBe(true);
      expect(isExplicitTestDatabaseName('test_enterprise_ai')).toBe(true);
      expect(isExplicitTestDatabaseName('test-db')).toBe(true);
      expect(isExplicitTestDatabaseName('test')).toBe(true);
      expect(isExplicitTestDatabaseName('app.test')).toBe(true);
    });

    it('rejects production databases that merely contain "test" as a substring', () => {
      expect(isExplicitTestDatabaseName('contest_db')).toBe(false);
      expect(isExplicitTestDatabaseName('latest_users')).toBe(false);
      expect(isExplicitTestDatabaseName('attestation')).toBe(false);
      expect(isExplicitTestDatabaseName('testdb')).toBe(false);
      expect(isExplicitTestDatabaseName('enterprise_ai')).toBe(false);
    });
  });

  describe('assertSafeTestDatabaseUri', () => {
    it('passes for approved local loopback test URI', () => {
      expect(() => assertSafeTestDatabaseUri(VALID_LOCAL_TEST_URI, VALID_APP_URI)).not.toThrow();
    });

    it('rejects missing or empty MONGODB_TEST_URI', () => {
      expect(() => assertSafeTestDatabaseUri('')).toThrow(
        /MONGODB_TEST_URI is required and cannot be empty/
      );
      expect(() => assertSafeTestDatabaseUri('   ')).toThrow(
        /MONGODB_TEST_URI is required and cannot be empty/
      );
    });

    it('rejects MongoDB Atlas and cloud URIs', () => {
      expect(() =>
        assertSafeTestDatabaseUri('mongodb+srv://my-cluster.mongodb.net/test_db', VALID_APP_URI)
      ).toThrow(/Cloud MongoDB targets are strictly prohibited/);

      expect(() =>
        assertSafeTestDatabaseUri('mongodb://db.aws.cloud.provider.com:27017/test_db', VALID_APP_URI)
      ).toThrow(/Cloud MongoDB targets are strictly prohibited/);
    });

    it('rejects remote IP addresses even if not recognized by cloud denylist', () => {
      expect(() =>
        assertSafeTestDatabaseUri('mongodb://192.168.1.100:27017/enterprise_ai_test', VALID_APP_URI)
      ).toThrow(/Target host "192.168.1.100" is not an approved local test host/);
    });

    it('rejects remote hostnames not recognized by cloud denylist', () => {
      expect(() =>
        assertSafeTestDatabaseUri('mongodb://internal-db.corp.net:27017/enterprise_ai_test', VALID_APP_URI)
      ).toThrow(/Target host "internal-db.corp.net" is not an approved local test host/);
    });

    it('rejects test URI when identical to application URI', () => {
      expect(() => assertSafeTestDatabaseUri(VALID_APP_URI, VALID_APP_URI)).toThrow(
        /MONGODB_TEST_URI must not be identical to application MONGODB_URI/
      );
    });

    it('rejects different URI strings targeting the same application database name', () => {
      const uri1 = 'mongodb://127.0.0.1:27017/enterprise_ai?replicaSet=rs0';
      const uri2 = 'mongodb://localhost:27017/enterprise_ai?directConnection=true';
      expect(() => assertSafeTestDatabaseUri(uri2, uri1)).toThrow(
        /Test database name "enterprise_ai" must not be identical to application database name/
      );
    });

    it('rejects database name that fails explicit test naming convention', () => {
      const uri = 'mongodb://127.0.0.1:27017/contest_db';
      expect(() => assertSafeTestDatabaseUri(uri, VALID_APP_URI)).toThrow(
        /must follow an explicit test naming convention/
      );
    });
  });

  describe('assertSafeTestDatabaseConnection (Mocked Connections)', () => {
    it('accepts an active connection to approved host with exact expected test database name', () => {
      const mockConn = {
        readyState: 1,
        host: '127.0.0.1',
        name: 'enterprise_ai_test',
      } as any;

      expect(() =>
        assertSafeTestDatabaseConnection(mockConn, VALID_LOCAL_TEST_URI)
      ).not.toThrow();
    });

    it('rejects an inactive Mongoose connection (readyState !== 1)', () => {
      const mockConn = {
        readyState: 0,
        host: '127.0.0.1',
        name: 'enterprise_ai_test',
      } as any;

      expect(() =>
        assertSafeTestDatabaseConnection(mockConn, VALID_LOCAL_TEST_URI)
      ).toThrow(/Connection is not active \(readyState=0\)/);
    });

    it('rejects connected database name that differs from configured test database', () => {
      const mockConn = {
        readyState: 1,
        host: '127.0.0.1',
        name: 'other_test_db',
      } as any;

      expect(() =>
        assertSafeTestDatabaseConnection(mockConn, VALID_LOCAL_TEST_URI)
      ).toThrow(/does not exactly match configured test database name/);
    });

    it('rejects connected database name that merely contains "test" but is not the exact test database', () => {
      const mockConn = {
        readyState: 1,
        host: '127.0.0.1',
        name: 'contest_db',
      } as any;

      expect(() =>
        assertSafeTestDatabaseConnection(mockConn, VALID_LOCAL_TEST_URI)
      ).toThrow(/Connected database name "contest_db" does not exactly match/);
    });

    it('rejects connection host that is not on approved local allowlist', () => {
      const mockConn = {
        readyState: 1,
        host: '192.168.1.100',
        name: 'enterprise_ai_test',
      } as any;

      expect(() =>
        assertSafeTestDatabaseConnection(mockConn, VALID_LOCAL_TEST_URI)
      ).toThrow(/Active connection host "192.168.1.100" is not an approved local test host/);
    });

    it('rejects connection host matching cloud denylist', () => {
      const mockConn = {
        readyState: 1,
        host: 'cluster0.mongodb.net',
        name: 'enterprise_ai_test',
      } as any;

      expect(() =>
        assertSafeTestDatabaseConnection(mockConn, VALID_LOCAL_TEST_URI)
      ).toThrow(/is not an approved local test host/);
    });
  });
});
