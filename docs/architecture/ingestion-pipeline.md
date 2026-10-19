# Secure Document Ingestion, Processing Pipeline & Vector Indexing Specification

> **Phase**: Phase 3 Architecture & Operational Specification
> **Status**: Completed & Verified

---

## 1. Architectural Overview & Ingestion Flow

The document ingestion pipeline implements an asynchronous, decoupled, multi-stage processing architecture:

```
[Client Upload]
       │ (multipart/form-data)
       ▼
[Express Controller & Middleware]
       │ - Authenticate JWT claims & clearance
       │ - Zod validation
       │ - FileValidator (magic bytes & size limits)
       │ - Duplicate content-hash check
       ▼
[Protected Disk Storage] ──> Saves server-randomized UUID filename (outside web root)
       │
       ▼
[MongoDB Persistence] ──> Creates DocumentModel in QUEUED state
       │
       ▼
[BullMQ Ingestion Queue] ──> Enqueues job on Redis (bounded attempts: 3, exponential backoff)
       │
       ▼
   (HTTP 202 Accepted returned to client)
       │
       ▼
======================= ASYNCHRONOUS WORKER =======================
       │
       ▼
[Ingestion Worker Process]
       │ 1. Atomic state update -> PROCESSING
       │ 2. StorageService -> Reads raw file buffer
       │ 3. ParserFactory -> Extracts clean text (PDF, DOCX, TXT)
       │ 4. ChunkerService -> Deterministic paragraph/sentence chunking + UUIDv5 vector IDs
       │ 5. Atomic state update -> INDEXING
       │ 6. EmbeddingFactory -> Generates L2-normalized float vectors via configured provider
       │ 7. QdrantService -> Pre-cleans previous vectors & upserts points with complete ACL payload
       │ 8. DocumentChunkModel -> Persists chunks in MongoDB
       │ 9. Atomic state update -> READY (chunkCount, tokenCount updated)
```

---

## 2. File Validation & Path Traversal Security

### 2.1 Storage Isolation & Path Traversal Guards
- **Server-Controlled Naming**: User-supplied filenames are never used as filesystem paths. Storage files are saved as `{uuidv4}{safeExt}` (e.g., `4a51e605-e328-40ea-9080-6d4b29bb3534.pdf`).
- **Non-Public Storage Directory**: Stored in `./data/uploads` (configurable via `UPLOAD_STORAGE_PATH`), completely outside web-served public assets.
- **Strict Normalization Checks**: `StorageService` verifies `path.normalize(targetPath).startsWith(storageDir)` before any read, write, or unlink operation, strictly preventing `../` traversal attacks.

### 2.2 Binary Signature (Magic Bytes) Verification
To prevent extension-spoofing attacks (e.g. uploading an executable disguised as `.pdf`):
- **PDF**: Header must begin with `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`).
- **DOCX**: Header must begin with `PK\x03\x04` (`0x50, 0x4B, 0x03, 0x04`), the standard ZIP container signature for OpenXML Word documents.
- **TXT**: Verified for valid UTF-8 encoding and checked for binary null bytes (`0x00`).

### 2.3 Upload Size Bounds
- `MAX_FILE_SIZE_BYTES`: Defaults to 50 MB (`52428800` bytes).
- Uploads exceeding this threshold or empty (0 bytes) are rejected immediately at the HTTP boundary before disk or memory buffering.

---

## 3. Document Parsing & Text Normalization

### 3.1 Parsers Supported in Phase 3
- **PDF Parser (`PdfParserAdapter`)**:
  - Uses `pdf-parse` to extract text from valid PDF streams.
  - Normalizes line endings (`\r\n` -> `\n`) and strips non-printable ASCII control characters.
  - Detects scanned image-only PDFs lacking extractable text and fails with an explicit error: *"Document contains no extractable text. Scanned or image-only PDFs requiring OCR are not supported."*
  - Rejects password-protected or corrupted PDFs cleanly.
- **DOCX Parser (`DocxParserAdapter`)**:
  - Uses `mammoth` to extract clean raw text.
  - Ignores executable macros, scripts, or embedded objects to avoid security risks.
- **TXT Parser (`TxtParserAdapter`)**:
  - Decodes plain text using `TextDecoder('utf-8')`.
  - Normalizes line breaks and removes non-printable control characters while preserving formatting whitespace (`\t`, `\n`).

---

## 4. Deterministic Text Chunking & Vector IDs

### 4.1 Boundary-Aware Chunking Strategy
- **Configurable Dimensions**: `CHUNK_SIZE` (default 500 tokens ≈ 2000 characters) and `CHUNK_OVERLAP` (default 50 tokens ≈ 200 characters).
- **Infinite Loop Safeguards**: Overlap is clamped to $< \text{chunkSize}$ (maximum 20% fallback) to prevent zero-step progression.
- **Natural Boundary Preference**: Splitting checks paragraph breaks (`\n\n`) first, followed by sentence terminators (`. `, `? `, `! `), and then whitespace word boundaries. Chunks never truncate mid-word.
- **Token Semantics & Limitations**: Chunk limits and reported `tokenCount` values use a standard heuristic approximation of ~4 characters per token (`Math.ceil(chars / 4)`). This allows deterministic, dependency-free text splitting. However, this is an approximation and does NOT guarantee strict model-specific BPE token ceilings for dense code, special Unicode characters, or multilingual scripts. Exact tokenization must be enforced by downstream LLM prompts or tokenizers if strict context bounds are required.

### 4.2 Deterministic UUIDv5 Vector IDs
Vector IDs are generated deterministically using RFC 4122 UUIDv5:
$$\text{VectorID} = \text{UUIDv5}(\text{documentId} + \text{"\_chunk\_"} + \text{chunkIndex}, \text{NAMESPACE\_DNS})$$
- **Guarantee**: Re-indexing the same document revision produces identical vector point IDs, eliminating duplicate vector creation and ensuring idempotent indexing.

---

## 5. Embedding Provider Abstraction

The ingestion pipeline interacts with embedding models strictly through the `IEmbeddingProvider` interface:

```typescript
export interface IEmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimensions: number;
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

### Supported Implementations:
1. **`MockEmbeddingProvider`**:
   - Generates deterministic, L2-normalized float vectors based on SHA-256 seed hashing.
   - Used for zero-cost, fully offline unit and integration testing without external API keys.
2. **`GeminiEmbeddingProvider`**:
   - Integrates with Google GenAI SDK (`@google/genai`).
   - Default model: `gemini-embedding-2` (768 dimensions).
3. **`OpenAIEmbeddingProvider`**:
   - Integrates with OpenAI SDK (`openai`).
   - Default model: `text-embedding-3-small` (1536 dimensions).

### Dimension Mismatch Safeguard:
`QdrantService.ensureCollection()` inspects existing collections. If an existing collection has a different vector size than the active model dimension, it throws an actionable error rather than silently deleting or corrupting existing vector data.

---

## 6. Qdrant Vector Schema & Authorization Metadata

Every point indexed in Qdrant strictly conforms to the Phase 4 authorization retrieval filter schema:

```json
{
  "id": "f81156eb-6758-539d-b949-7b7a3c2d7b46",
  "vector": [0.021, -0.045, ...],
  "payload": {
    "chunk_id": "f81156eb-6758-539d-b949-7b7a3c2d7b46",
    "document_id": "671350a12f3e8b0012345678",
    "title": "IT_Security_Standard_2026.pdf",
    "content": "Normalized text chunk content...",
    "char_start": 0,
    "char_end": 1845,
    "minimum_clearance_level": 1,
    "allowed_roles": ["engineer", "admin"],
    "allowed_departments": ["Engineering", "IT"],
    "allowed_user_ids": [],
    "is_active": true
  }
}
```

### Empty-ACL Semantics:
- `minimum_clearance_level`: Numeric integer ($0 = \text{public}$, $1 = \text{internal}$, $2 = \text{confidential}$, $3 = \text{restricted}$).
- `allowed_roles`: Empty array (`[]`) represents a wildcard (accessible to all authenticated roles satisfying clearance).
- `allowed_departments`: Empty array (`[]`) represents a wildcard (accessible across all company departments).
- `allowed_user_ids`: Empty array (`[]`) represents no user-specific exclusion.
- `is_active`: Set to `true` upon successful indexing; set to `false` if soft-deleted or quarantined.

---

## 7. Failure Recovery, Idempotency & Deletion Cleanup

### 7.1 Idempotency on Re-index
When a document is re-indexed or a retry job is processed:
1. `QdrantService.deleteDocumentVectors(docId)` purges any prior vectors for this document.
2. `DocumentChunkModel.deleteMany({ documentId: docId })` purges existing chunk records.
3. Fresh chunks and vectors are inserted with reproducible UUIDv5 identifiers.
4. Guaranteed: Zero duplicate or orphaned chunks.

### 7.2 Compensating Action on Worker Failure
If parsing, chunking, embedding, or upsert fails:
1. The error is logged with sanitized details.
2. On final attempt exhaustion (attempts $\ge 3$):
   - Document status is updated to `FAILED`.
   - `errorMessage` is set with sanitized diagnostics.
   - Partial vectors and chunks are purged from Qdrant and MongoDB so unindexed/stale content cannot leak into later search queries.

### 7.3 Coordinated Document Deletion
When `DELETE /api/v1/documents/:id` is called:
1. Status is toggled to `DELETING`.
2. All vectors for the document are purged from Qdrant via deletion filter `{ key: "document_id", match: { value: id } }`.
3. All chunks are removed from MongoDB `DocumentChunkModel`.
4. Storage file is unlinked from disk via `StorageService.deleteFile()`.
5. Document record is deleted from MongoDB `DocumentModel`.
6. Audit log entry is generated (`AuditAction.DOC_DELETE`).

---

## 8. Known Operational Limitations

1. **OCR for Scanned PDFs**: Optical Character Recognition (OCR) is not implemented in Phase 3. Scanned PDFs containing only image pixels without embedded font streams are rejected with a descriptive error.
2. **Distributed Audit Chain**: As documented in `docs/architecture/corrections.md`, the in-memory write lock in `AuditService` serializes events only within a single Node.js heap. Clustered or multi-container deployments must implement a transactional MongoDB chain-head or single-worker queue before scaling horizontally.
