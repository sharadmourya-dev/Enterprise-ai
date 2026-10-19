import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  CLEARANCE_RANK,
  IRetrievalCandidate,
  DocumentStatus,
} from '@enterprise-ai/shared-types';
import { QdrantService } from './qdrant.service.js';
import { EmbeddingFactory } from './embeddings/embedding.factory.js';
import { DocumentModel } from '../models/Document.model.js';
import { env } from '../config/env.js';
import { ForbiddenError, BadGatewayError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export interface ISearchOptions {
  topK?: number;
  similarityThreshold?: number;
  collectionName?: string;
}

export interface ISearchResult {
  candidates: IRetrievalCandidate[];
  timings: {
    embeddingMs: number;
    searchMs: number;
  };
}

export class RetrievalService {
  /**
   * Constructs the strict native Qdrant filter object from trusted server-side authorization context.
   * Enforces:
   * 1. Point is active (is_active == true)
   * 2. Clearance hierarchy (minimum_clearance_level <= userClearanceRank)
   * 3. Role restrictions with empty-array wildcard semantics (is_empty OR role match)
   * 4. Department restrictions with empty-array wildcard semantics (is_empty OR department match)
   * 5. User-specific restrictions with empty-array wildcard semantics (is_empty OR user ID match)
   *
   * All dimensions are combined with AND (must: [...]).
   * Fails closed if authorization context is missing or malformed.
   */
  public static buildQdrantFilter(user: IJwtPayload): Record<string, unknown> {
    if (!user || typeof user !== 'object') {
      throw new ForbiddenError('Missing authorization context for retrieval');
    }

    const { sub: userId, role, department, securityClearance } = user;

    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new ForbiddenError('Invalid user ID in authorization context');
    }

    if (!role || !Object.values(Role).includes(role)) {
      throw new ForbiddenError(`Invalid role '${role}' in authorization context`);
    }

    if (!department || typeof department !== 'string' || department.trim().length === 0) {
      throw new ForbiddenError('Invalid department in authorization context');
    }

    if (!securityClearance || !Object.values(ClearanceLevel).includes(securityClearance)) {
      throw new ForbiddenError(
        `Invalid security clearance '${securityClearance}' in authorization context`
      );
    }

    const clearanceRank = CLEARANCE_RANK[securityClearance];
    if (typeof clearanceRank !== 'number') {
      throw new ForbiddenError('Failed to resolve clearance rank for authorization context');
    }

    return {
      must: [
        {
          key: 'is_active',
          match: { value: true },
        },
        {
          key: 'minimum_clearance_level',
          range: { lte: clearanceRank },
        },
        {
          should: [
            { is_empty: { key: 'allowed_roles' } },
            { key: 'allowed_roles', match: { value: role } },
          ],
        },
        {
          should: [
            { is_empty: { key: 'allowed_departments' } },
            { key: 'allowed_departments', match: { value: department } },
          ],
        },
        {
          should: [
            { is_empty: { key: 'allowed_user_ids' } },
            { key: 'allowed_user_ids', match: { value: userId } },
          ],
        },
      ],
    };
  }

  /**
   * Generates query embedding, executes ACL-filtered vector search in Qdrant,
   * and verifies active document revisions and status against MongoDB.
   */
  public static async search(
    query: string,
    user: IJwtPayload,
    options?: ISearchOptions
  ): Promise<ISearchResult> {
    const trimmedQuery = query?.trim() ?? '';
    if (!trimmedQuery) {
      return {
        candidates: [],
        timings: { embeddingMs: 0, searchMs: 0 },
      };
    }

    const topK = Math.min(Math.max(options?.topK ?? env.RAG_TOP_K, 1), 20);
    const similarityThreshold = options?.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD;
    const collectionName = options?.collectionName ?? env.QDRANT_COLLECTION_NAME;

    // 1. Generate query embedding using configured provider
    const startEmbedding = Date.now();
    let queryVector: number[];
    try {
      const embeddingProvider = EmbeddingFactory.getProvider();
      queryVector = await embeddingProvider.embedText(trimmedQuery);

      if (!Array.isArray(queryVector) || queryVector.length !== embeddingProvider.dimensions) {
        throw new BadGatewayError(
          `Embedding provider generated invalid vector dimension (expected ${embeddingProvider.dimensions})`
        );
      }
    } catch (err: unknown) {
      if (err instanceof ForbiddenError || err instanceof BadGatewayError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to embed query for retrieval', { error: errMsg });
      throw new BadGatewayError(`Embedding provider failure during retrieval: ${errMsg}`);
    }
    const embeddingMs = Date.now() - startEmbedding;

    // 2. Build secure Qdrant filter
    const filter = this.buildQdrantFilter(user);

    // 3. Search Qdrant collection with authorization filter
    const startSearch = Date.now();
    let searchResponse: any;
    try {
      const client = QdrantService.getClient();
      // Fetch a bounded candidate pool (up to 2x topK) to allow for post-filter revision checks
      const candidateLimit = Math.min(topK * 2, 40);

      searchResponse = await client.query(collectionName, {
        query: queryVector,
        filter,
        limit: candidateLimit,
        score_threshold: similarityThreshold,
        with_payload: true,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Qdrant vector search failed', { error: errMsg, collection: collectionName });
      throw new BadGatewayError(`Vector database search failure: ${errMsg}`);
    }
    const searchMs = Date.now() - startSearch;

    const points = (searchResponse?.points || []) as Array<{
      id: string | number;
      score: number;
      payload?: Record<string, any>;
    }>;

    if (points.length === 0) {
      return {
        candidates: [],
        timings: { embeddingMs, searchMs },
      };
    }

    const clearanceRank = CLEARANCE_RANK[user.securityClearance];

    // 4. Memory-level candidate validation (defense in depth against payload corruption)
    const validCandidatePoints = points.filter((p) => {
      const payload = p.payload;
      if (!payload) return false;
      if (payload.is_active !== true) return false;
      if (typeof payload.minimum_clearance_level !== 'number') return false;
      if (payload.minimum_clearance_level > clearanceRank) return false;
      if (!Array.isArray(payload.allowed_roles)) return false;
      if (payload.allowed_roles.length > 0 && !payload.allowed_roles.includes(user.role))
        return false;
      if (!Array.isArray(payload.allowed_departments)) return false;
      if (
        payload.allowed_departments.length > 0 &&
        !payload.allowed_departments.includes(user.department)
      )
        return false;
      if (!Array.isArray(payload.allowed_user_ids)) return false;
      if (payload.allowed_user_ids.length > 0 && !payload.allowed_user_ids.includes(user.sub))
        return false;
      if (!payload.document_id || !payload.chunk_id || typeof payload.content !== 'string')
        return false;
      return true;
    });

    if (validCandidatePoints.length === 0) {
      return {
        candidates: [],
        timings: { embeddingMs, searchMs },
      };
    }

    // 5. Active Revision & Document Status Verification (Batched MongoDB lookup)
    const docIds = Array.from(new Set(validCandidatePoints.map((p) => p.payload!.document_id)));
    let activeDocs: any[] = [];
    try {
      activeDocs = await DocumentModel.find({
        _id: { $in: docIds },
        status: DocumentStatus.READY,
      }).lean();
    } catch (dbErr: unknown) {
      const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      logger.error('Failed to verify candidate documents in MongoDB', { error: errMsg });
      throw new BadGatewayError(`Database error during candidate verification: ${errMsg}`);
    }

    const docMap = new Map(activeDocs.map((d) => [d._id.toString(), d]));

    const validatedCandidates: IRetrievalCandidate[] = [];
    for (const point of validCandidatePoints) {
      const payload = point.payload!;
      const doc = docMap.get(payload.document_id);

      // Reject if document does not exist, is soft-deleted, or not in READY status
      if (!doc) {
        continue;
      }

      // Reject stale points: point revision MUST match active currentRevision
      if (doc.currentRevision !== payload.revision) {
        continue;
      }

      // Re-verify document-level ACL from MongoDB state
      if (doc.accessControl) {
        const docClearance = doc.accessControl.minimumClearance;
        if (CLEARANCE_RANK[docClearance as ClearanceLevel] > clearanceRank) {
          continue;
        }
        if (
          doc.accessControl.allowedRoles?.length > 0 &&
          !doc.accessControl.allowedRoles.includes(user.role)
        ) {
          continue;
        }
        if (
          doc.accessControl.allowedDepartments?.length > 0 &&
          !doc.accessControl.allowedDepartments.includes(user.department)
        ) {
          continue;
        }
        if (
          doc.accessControl.allowedUserIds?.length > 0 &&
          !doc.accessControl.allowedUserIds
            .map((id: any) => id.toString())
            .includes(user.sub)
        ) {
          continue;
        }
      }

      validatedCandidates.push({
        vectorId: point.id.toString(),
        score: point.score,
        chunkId: payload.chunk_id,
        documentId: payload.document_id,
        revision: payload.revision,
        title: payload.title || doc.title,
        content: payload.content,
        pageNumber: payload.page_number,
        sectionHeader: payload.section_header,
        minimumClearanceLevel: payload.minimum_clearance_level,
        allowedRoles: payload.allowed_roles,
        allowedDepartments: payload.allowed_departments,
        allowedUserIds: payload.allowed_user_ids,
        isActive: payload.is_active,
      });

      if (validatedCandidates.length >= topK) {
        break;
      }
    }

    return {
      candidates: validatedCandidates,
      timings: { embeddingMs, searchMs },
    };
  }
}
