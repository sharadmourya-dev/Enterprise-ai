import { Role, ClearanceLevel } from './auth.js';

export enum DocumentMimeType {
  PDF = 'application/pdf',
  DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  TXT = 'text/plain',
  MD = 'text/markdown',
}

export enum DocumentStatus {
  PENDING = 'pending',
  UPLOADED = 'uploaded',
  QUEUED = 'queued',
  PROCESSING = 'processing',
  INDEXING = 'indexing',
  READY = 'ready',
  INDEXED = 'indexed', // Kept for backwards compatibility
  FAILED = 'failed',
  DELETING = 'deleting',
  ARCHIVED = 'archived',
}

export interface IDocumentUploadResponse {
  documentId: string;
  title: string;
  originalFilename: string;
  mimeType: DocumentMimeType;
  fileSizeBytes: number;
  fileHash: string;
  status: DocumentStatus;
  jobId?: string;
  createdAt: string;
}

export interface IDocumentListQuery {
  page?: number;
  limit?: number;
  status?: DocumentStatus;
  department?: string;
}

export interface IDocumentListResponse {
  documents: IDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Access Control Configuration for Documents & Chunks
 * Empty-ACL Semantics:
 * - allowedRoles: [] -> open to all authenticated roles
 * - allowedDepartments: [] -> open to all departments
 * - allowedUserIds: [] -> no user-specific restriction (applies to all users meeting clearance)
 * - minimumClearance: strictly checked (user_clearance_rank >= minimumClearance_rank)
 */
export interface IAccessControl {
  allowedRoles: Role[];
  allowedDepartments: string[];
  minimumClearance: ClearanceLevel;
  allowedUserIds: string[];
}

export interface IDocument {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: DocumentMimeType;
  fileSizeBytes: number;
  fileHash: string;
  status: DocumentStatus;
  errorMessage?: string | null;
  chunkCount: number;
  tokenCount: number;
  currentRevision: number;
  stagedRevision?: number | null;
  uploadedBy: string;
  accessControl: IAccessControl;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface IChunkMetadata {
  title: string;
  pageNumber?: number;
  charStart?: number;
  charEnd?: number;
  sectionHeader?: string;
}

export interface IDocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  revision: number;
  content: string;
  tokenCount: number;
  vectorId: string;
  metadata: IChunkMetadata;
  accessControl: IAccessControl;
  createdAt: string;
}

/**
 * Exact schema for point payload stored in Qdrant vector database
 */
export interface IQdrantChunkPayload {
  chunk_id: string;
  document_id: string;
  revision: number;
  title: string;
  page_number?: number;
  char_start?: number;
  char_end?: number;
  section_header?: string;
  content: string;
  // Security indexing fields:
  minimum_clearance_level: number; // Numeric rank (0-3)
  allowed_roles: string[];        // Empty array means wildcard (all roles)
  allowed_departments: string[];  // Empty array means wildcard (all departments)
  allowed_user_ids: string[];     // Empty array means wildcard (all users)
  is_active: boolean;             // False if parent document is deleted or quarantined
}
