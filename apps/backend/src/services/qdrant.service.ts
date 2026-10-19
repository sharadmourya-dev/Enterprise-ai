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

export class QdrantService {
  private static clientInstance: QdrantClient | null = null;

  public static getClient(): QdrantClient {
    if (!this.clientInstance) {
      this.clientInstance = new QdrantClient({
        url: env.QDRANT_URL,
        apiKey: env.QDRANT_API_KEY ? env.QDRANT_API_KEY : undefined,
      });
    }
    return this.clientInstance;
  }

  /**
   * Initializes collection idempotently and validates dimensions.
   * Never deletes or overwrites existing collections.
   */
  public static async ensureCollection(
    collectionName = env.QDRANT_COLLECTION_NAME,
    expectedDimensions = 768
  ): Promise<void> {
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
