import { QdrantClient } from '@qdrant/js-client-rest';
import { IQdrantChunkPayload } from '@enterprise-ai/shared-types';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export interface IQdrantPoint {
  vectorId: string;
  vector: number[];
  payload: IQdrantChunkPayload;
}

/**
 * Collections protected from modification or deletion during tests.
 */
export const PROTECTED_QDRANT_COLLECTIONS: ReadonlySet<string> = new Set([
  'enterprise_knowledge_chunks',
  'test_ingestion_chunks',
]);

/**
 * Detects whether a URL points to a remote/cloud Qdrant service.
 */
export function isCloudQdrantUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('qdrant.tech') ||
    lower.includes('cloud.qdrant') ||
    lower.includes('.aws.') ||
    lower.includes('.azure.') ||
    lower.includes('.gcp.') ||
    lower.includes('cloud')
  );
}

/**
 * Checks whether a URL targets a local or loopback endpoint.
 */
export function isLocalQdrantUrl(url: string): boolean {
  try {
    const parsed = new URL(url.startsWith('http://') || url.startsWith('https://') ? url : `http://${url}`);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === 'qdrant'
    );
  } catch {
    const lower = url.toLowerCase();
    return lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('::1');
  }
}

/**
 * Verifies that a Qdrant test endpoint is safe, local, and not a cloud service.
 */
export function assertSafeTestQdrantUrl(url: string): void {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error('FATAL TEST SAFETY ERROR: QDRANT_TEST_URL is required in test environment and cannot be empty.');
  }

  if (isCloudQdrantUrl(url)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Cloud Qdrant endpoints are strictly prohibited for tests: "${url}". Tests must use an isolated local Qdrant instance.`
    );
  }

  if (!isLocalQdrantUrl(url)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Qdrant test URL must target a local/loopback endpoint (e.g., http://localhost:6333): "${url}".`
    );
  }
}

/**
 * Guards against mutating protected collections during test runs.
 */
export function assertSafeTestCollectionMutation(collectionName: string, action: string): void {
  const isTest = env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test';
  if (isTest && PROTECTED_QDRANT_COLLECTIONS.has(collectionName)) {
    throw new Error(
      `FATAL TEST SAFETY ERROR: Attempted ${action} on protected collection "${collectionName}" during test execution. Tests must operate only on dedicated test collections.`
    );
  }
}

export class QdrantService {
  private static clientInstance: QdrantClient | null = null;

  public static getClient(): QdrantClient {
    const isTest = env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test';

    if (!this.clientInstance) {
      if (isTest) {
        // Enforce dedicated test endpoint; never fall back to application QDRANT_URL
        const testUrl = process.env.QDRANT_TEST_URL || env.QDRANT_TEST_URL || 'http://localhost:6333';
        assertSafeTestQdrantUrl(testUrl);

        const client = new QdrantClient({
          url: testUrl,
          apiKey: undefined, // Never supply cloud API keys during tests
        });

        // Intercept deleteCollection to guarantee protected collections cannot be deleted
        const originalDeleteCollection = client.deleteCollection.bind(client);
        client.deleteCollection = async (collectionName: string) => {
          if (PROTECTED_QDRANT_COLLECTIONS.has(collectionName)) {
            throw new Error(
              `FATAL TEST SAFETY ERROR: Deletion of protected collection "${collectionName}" is strictly prohibited.`
            );
          }
          if (!collectionName.startsWith('test_')) {
            throw new Error(
              `FATAL TEST SAFETY ERROR: In test mode, only isolated test collections (prefix "test_") may be deleted. Attempted: "${collectionName}".`
            );
          }
          return originalDeleteCollection(collectionName);
        };

        this.clientInstance = client;
      } else {
        this.clientInstance = new QdrantClient({
          url: env.QDRANT_URL,
          apiKey: env.QDRANT_API_KEY ? env.QDRANT_API_KEY : undefined,
        });
      }
    }
    return this.clientInstance;
  }

  public static resetClient(): void {
    this.clientInstance = null;
  }

  /**
   * Initializes collection idempotently and validates dimensions.
   * Never deletes or overwrites existing collections.
   */
  public static async ensureCollection(
    collectionName = env.QDRANT_COLLECTION_NAME,
    expectedDimensions = 768
  ): Promise<void> {
    assertSafeTestCollectionMutation(collectionName, 'ensureCollection');
    const client = this.getClient();

    try {
      const existsRes = await client.collectionExists(collectionName);

      if (!existsRes.exists) {
        logger.info(`Creating Qdrant collection '${collectionName}' with dimensions: ${expectedDimensions}`);
        await client.createCollection(collectionName, {
          vectors: {
            size: expectedDimensions,
            distance: 'Cosine',
          },
        });

        // Create payload indexes for fast filtered retrieval and ACL security
        await this.createPayloadIndexes(collectionName);
      } else {
        // Validate existing collection configuration
        const collectionInfo = await client.getCollection(collectionName);
        const config = collectionInfo.config?.params?.vectors;

        // Vector config can be a single VectorParams object or a map
        let existingSize: number | undefined;
        if (config && typeof config === 'object') {
          if ('size' in config && typeof config.size === 'number') {
            existingSize = config.size;
          }
        }

        if (existingSize && existingSize !== expectedDimensions) {
          throw new BadRequestError(
            `Incompatible Qdrant collection '${collectionName}': existing vector dimension ${existingSize} does not match active embedding dimension ${expectedDimensions}. Please configure a matching model or collection name.`
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to ensure Qdrant collection', { collectionName, error: errMsg });
      throw new Error(`Qdrant connection/collection error: ${errMsg}`);
    }
  }

  /**
   * Creates payload indexes for authorization and query fields
   */
  public static async createPayloadIndexes(collectionName = env.QDRANT_COLLECTION_NAME): Promise<void> {
    assertSafeTestCollectionMutation(collectionName, 'createPayloadIndexes');
    const client = this.getClient();

    const indexes = [
      { field: 'minimum_clearance_level', type: 'integer' as const },
      { field: 'allowed_roles', type: 'keyword' as const },
      { field: 'allowed_departments', type: 'keyword' as const },
      { field: 'allowed_user_ids', type: 'keyword' as const },
      { field: 'document_id', type: 'keyword' as const },
      { field: 'revision', type: 'integer' as const },
      { field: 'is_active', type: 'bool' as const },
    ];

    for (const idx of indexes) {
      try {
        await client.createPayloadIndex(collectionName, {
          field_name: idx.field,
          field_schema: idx.type,
          wait: true,
        });
      } catch (err: unknown) {
        // If index already exists, proceed safely
        logger.debug(`Payload index for '${idx.field}' already initialized or logged`, { error: err });
      }
    }
  }

  /**
   * Upserts a batch of chunk points into Qdrant with full ACL payload verification
   */
  public static async upsertPoints(
    points: IQdrantPoint[],
    collectionName = env.QDRANT_COLLECTION_NAME
  ): Promise<void> {
    if (points.length === 0) return;
    assertSafeTestCollectionMutation(collectionName, 'upsertPoints');

    const client = this.getClient();

    // Verify ACL completeness on every point before sending to Qdrant
    for (const point of points) {
      const p = point.payload;
      if (
        p.minimum_clearance_level === undefined ||
        p.revision === undefined ||
        !Array.isArray(p.allowed_roles) ||
        !Array.isArray(p.allowed_departments) ||
        !Array.isArray(p.allowed_user_ids) ||
        typeof p.is_active !== 'boolean'
      ) {
        throw new BadRequestError(
          `Malformed ACL metadata for chunk point ${point.vectorId}: all clearance, revision, and wildcard fields must be present and correctly typed.`
        );
      }
    }

    const qdrantPoints = points.map((p) => ({
      id: p.vectorId,
      vector: p.vector,
      payload: p.payload as unknown as Record<string, unknown>,
    }));

    // Bounded batch size of 100 for network reliability
    const batchSize = 100;
    for (let i = 0; i < qdrantPoints.length; i += batchSize) {
      const slice = qdrantPoints.slice(i, i + batchSize);
      await client.upsert(collectionName, {
        wait: true,
        points: slice,
      });
    }
  }

  /**
   * Deletes all points belonging to a specific document ID
   */
  public static async deleteDocumentVectors(
    documentId: string,
    collectionName = env.QDRANT_COLLECTION_NAME
  ): Promise<void> {
    assertSafeTestCollectionMutation(collectionName, 'deleteDocumentVectors');
    const client = this.getClient();

    try {
      await client.delete(collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'document_id',
              match: { value: documentId },
            },
          ],
        },
      });
    } catch (err) {
      logger.warn('Failed to delete document vectors from Qdrant', { documentId, error: err });
      throw err;
    }
  }

  /**
   * Deletes all points belonging to a specific revision of a document
   */
  public static async deleteDocumentVectorsByRevision(
    documentId: string,
    revision: number,
    collectionName = env.QDRANT_COLLECTION_NAME
  ): Promise<void> {
    assertSafeTestCollectionMutation(collectionName, 'deleteDocumentVectorsByRevision');
    const client = this.getClient();

    try {
      await client.delete(collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'document_id',
              match: { value: documentId },
            },
            {
              key: 'revision',
              match: { value: revision },
            },
          ],
        },
      });
    } catch (err) {
      logger.warn('Failed to delete document revision vectors from Qdrant', { documentId, revision, error: err });
      throw err;
    }
  }

  /**
   * Deletes all points for revisions older than active currentRevision
   */
  public static async deleteOldRevisions(
    documentId: string,
    currentRevision: number,
    collectionName = env.QDRANT_COLLECTION_NAME
  ): Promise<void> {
    assertSafeTestCollectionMutation(collectionName, 'deleteOldRevisions');
    const client = this.getClient();

    try {
      await client.delete(collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'document_id',
              match: { value: documentId },
            },
            {
              key: 'revision',
              range: { lt: currentRevision },
            },
          ],
        },
      });
    } catch (err) {
      logger.warn('Failed to delete older revision vectors from Qdrant', { documentId, currentRevision, error: err });
      throw err;
    }
  }
}
