/**
 * RAG Query and Retrieval Types
 */

export interface ICitation {
  evidenceId: string; // e.g. "S1", "S2"
  documentId: string;
  source: string; // Document title or original filename
  chunkId: string;
  revision: number;
  page?: number;
  section?: string;
}

export interface IEvidenceSource {
  evidenceId: string; // e.g. "S1"
  documentId: string;
  chunkId: string;
  revision: number;
  title: string;
  content: string;
  pageNumber?: number;
  sectionHeader?: string;
  score: number;
}

export interface IRagQueryRequest {
  query: string;
  topK?: number;
  similarityThreshold?: number;
}

export interface IRagQueryResponse {
  answer: string;
  citations: ICitation[];
  insufficientEvidence: boolean;
  retrievalMetadata: {
    totalCandidates: number;
    authorizedChunks: number;
    timingsMs: {
      embedding: number;
      retrieval: number;
      generation?: number;
      total: number;
    };
  };
}

export interface IRetrievalCandidate {
  vectorId: string;
  score: number;
  chunkId: string;
  documentId: string;
  revision: number;
  title: string;
  content: string;
  pageNumber?: number;
  sectionHeader?: string;
  minimumClearanceLevel: number;
  allowedRoles: string[];
  allowedDepartments: string[];
  allowedUserIds: string[];
  isActive: boolean;
}

export interface ISearchResultItem {
  chunkId: string;
  documentId: string;
  revision: number;
  title: string;
  content: string;
  pageNumber?: number;
  sectionHeader?: string;
  score: number;
  rank: number;
}

export interface ISearchResponse {
  query: string;
  results: ISearchResultItem[];
  total: number;
  timings: {
    embeddingMs: number;
    searchMs: number;
  };
}
