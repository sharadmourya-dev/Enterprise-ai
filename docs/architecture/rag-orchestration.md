# Secure Retrieval, RAG Orchestration & Grounded Answer Generation Specification

> **Phase**: Phase 4 Architecture & Operational Specification
> **Status**: Completed & Verified
> **Workspace**: `C:\Users\Programming.com\Desktop\Sharad\enterprise-ai`

---

## 1. Architectural Overview & Pipeline Request Flow

Phase 4 implements an end-to-end secure, traceable Retrieval-Augmented Generation (RAG) pipeline:

```
[Authenticated Client Query]
       │
       ▼
[Express Controller & Middleware]
       │ - JWT Authentication (req.user claims: userId, role, department, securityClearance)
       │ - Strict Zod schema validation (query length: 1..1000, bounded topK: 1..20, similarityThreshold: 0..1)
       │ - Client cannot pass arbitrary filters, collections, or dimensions
       ▼
[Retrieval Service]
       │ 1. Generates query vector via EmbeddingFactory.getProvider() (validates 768 / 1536 dims)
       │ 2. Constructs server-side native Qdrant filter combining all ACL dimensions with logical AND
       │ 3. Searches Qdrant collection with score_threshold and candidate pool ceiling
       │ 4. Memory-level candidate verification (clearance, roles, departments, userIds)
       │ 5. Batched MongoDB Document validation: status == READY and currentRevision == candidate.revision
       ▼
[Context Assembler]
       │ 1. Deduplicates identical or overlapping chunk contents
       │ 2. Assigns sequential, stable evidence identifiers: [S1], [S2], [S3]...
       │ 3. Enforces bounded limits: max chunks (default 5), character ceiling (default 8000), heuristic token limits
       │ 4. Never truncates mid-passage, ensuring well-formed evidence items
       ▼
[Prompt Builder & Injection Defense]
       │ 1. Delimits untrusted documentation in <<<EVIDENCE>>> tags
       │ 2. Mandates grounded answering strictly using supplied facts
       │ 3. Instructs LLM to treat document text as passive untrusted data, forbidding execution of embedded commands
       ▼
[LLM Provider Abstraction]
       │ 1. Dispatches to active provider (MockLlmProvider in test mode, GeminiLlmProvider, or OpenAILlmProvider)
       │ 2. Enforces bounded timeouts and isolated error handling
       ▼
[Citation Validator]
       │ 1. Extracts all [Sn] citation tags from generated answer text
       │ 2. Resolves valid evidence IDs against validated evidence metadata (title, docId, rev, page, section)
       │ 3. Detects and strips hallucinated / unknown citation IDs (e.g. [S99])
       │ 4. Identifies insufficient evidence when factual claims lack citations or explicit disclaimer is returned
       ▼
[Telemetry & Audit Logging]
       │ 1. Records QueryLogModel: timings, token usage, retrieved chunk ObjectIds, status
       │ 2. Records AuditLogModel: tamper-evident SHA-256 HMAC chained entry with action 'rag.query'
       │ 3. Safe logging: raw prompts and confidential document contents are never logged
       ▼
[HTTP 200 Structured Response Envelope]
```

---

## 2. Authorization Filter Schema & Empty-Array Wildcard Semantics

### 2.1 Multi-Dimensional Access Control
Every knowledge chunk indexed in Qdrant contains security indexing fields in its payload:
- `minimum_clearance_level`: Numeric rank ($0 = \text{PUBLIC}, 1 = \text{INTERNAL}, 2 = \text{CONFIDENTIAL}, 3 = \text{RESTRICTED}$).
- `allowed_roles`: Array of string roles. Empty array (`[]`) signifies a wildcard (accessible to all authenticated roles).
- `allowed_departments`: Array of string departments. Empty array (`[]`) signifies a wildcard (accessible across all company departments).
- `allowed_user_ids`: Array of user IDs. Empty array (`[]`) signifies no user-specific exclusion.
- `is_active`: Boolean (`true` for active, searchable points; `false` for soft-deleted or quarantined points).

### 2.2 Native Qdrant Filter Construction
The retrieval service builds native Qdrant filter expressions where all independent authorization dimensions are combined using **logical AND** (`must: [...]`). Within each restriction array, **logical OR** (`should: [...]`) checks for the empty-array wildcard or a match with the authenticated user claim:

```json
{
  "must": [
    {
      "key": "is_active",
      "match": { "value": true }
    },
    {
      "key": "minimum_clearance_level",
      "range": { "lte": 1 }
    },
    {
      "should": [
        { "is_empty": { "key": "allowed_roles" } },
        { "key": "allowed_roles", "match": { "value": "user" } }
      ]
    },
    {
      "should": [
        { "is_empty": { "key": "allowed_departments" } },
        { "key": "allowed_departments", "match": { "value": "Engineering" } }
      ]
    },
    {
      "should": [
        { "is_empty": { "key": "allowed_user_ids" } },
        { "key": "allowed_user_ids", "match": { "value": "67135...01" } }
      ]
    }
  ]
}
```

### 2.3 Fail-Closed Enforcement
- If user claims or security clearance are missing or invalid, retrieval throws `ForbiddenError` and terminates.
- If Qdrant returns a point with corrupted or missing ACL fields, memory-level validation discards it.
- Unauthorized vectors are filtered out before distance computation in Qdrant's HNSW index, guaranteeing zero cross-department or cross-clearance data leakage.

---

## 3. Active-Revision Validation Strategy

1. **Batched Document Lookup**:
   When Qdrant returns candidates, the candidate `document_id`s are collected and looked up in MongoDB in a single batched query:
   ```typescript
   const activeDocs = await DocumentModel.find({
     _id: { $in: docIds },
     status: DocumentStatus.READY,
   }).lean();
   ```
2. **Revision Correctness**:
   For each candidate point:
   - If the parent document does not exist in MongoDB or its status is not `READY` (e.g. `PENDING`, `PROCESSING`, `FAILED`, `DELETING`), the candidate is immediately discarded.
   - If `candidate.payload.revision !== activeDoc.currentRevision`, the candidate belongs to an obsolete or staged revision and is discarded.
   - Document-level access control from MongoDB is re-verified against user claims as defense-in-depth.

---

## 4. Context Assembly, LLM Abstraction & Citation Traceability

### 4.1 Context Assembly
1. **Stable Numbered Identifiers**:
   Evidence passages are assigned stable tags `[S1]`, `[S2]`, etc., mapped to internal `IEvidenceSource` records.
2. **Deduplication**:
   Exact or normalized duplicate content (common with chunk overlap) is suppressed to prevent weighting bias.
3. **Bounded Context**:
   - `maxChunks`: Default 5 (configurable).
   - `maxCharacters`: Default 8,000 characters.
   - Heuristic token estimation: ~4 characters per token (`Math.ceil(chars / 4)`).
   - Truncation never splits mid-passage, ensuring well-formed evidence structures.

### 4.2 LLM Provider Abstraction & Model Defaults
The system abstracts generation behind `ILlmProvider`, selected at startup by `LlmFactory`:
- **Default Models**:
  - **Gemini**: `gemini-3.8-flash` (Official Google AI Studio recommended stable Flash model: `https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash`). Note: `gemini-1.5-pro` was shut down in Sept 2025. Per Google Gemini 3.8 migration guidance (`https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8`), deprecated sampling parameters (`temperature`, `top_p`, `top_k`) are omitted for Gemini 3 and later; for older configurable models (e.g. `gemini-2.5-flash`), `temperature` is preserved.
  - **OpenAI**: `gpt-4o-mini` (Official OpenAI Platform text-generation model: `https://platform.openai.com/docs/models/gpt-4o-mini`). Compatible with `client.chat.completions.create()`.
- **Runtime Configurability**:
  Model IDs are strictly configured via environment variables (`GEMINI_MODEL`, `OPENAI_MODEL`). The configured model is directly passed to the provider SDK (`@google/genai` or `openai`).
  - **Gemini**: Dynamically constructs `generateContent` configuration: omits sampling parameters (`temperature`, `top_p`, `top_k`) for Gemini 3+, while maintaining `systemInstruction` and `maxOutputTokens`.
  - **OpenAI**: Passes `temperature` and `max_tokens` for standard text models (`gpt-4o-mini`), while automatically omitting `temperature` and mapping to `max_completion_tokens` for o-series reasoning models (`o1`, `o3-mini`).
- **Provider Selection & Credential Safety**:
  Missing credentials produce sanitized errors without logging or leaking secrets. If an invalid or unconfigured provider is selected, the factory fails safely and predictably.
- **Mocked Testing vs. Live Verification**:
  All unit and integration test suites run strictly against `MockLlmProvider` and `MockEmbeddingProvider`, requiring zero live API keys or external network calls. Configured defaults represent official vendor production models, but live API invocations require valid developer-supplied API keys in `.env`.

### 4.3 Citation Validation & Grounding Enforcement
`CitationValidator` and `RagService` enforce strict citation integrity:
1. **Extraction & Evidence Mapping**:
   - The generated response is parsed for all citations matching `\[S\d+\]`.
   - Each cited ID is checked against the supplied evidence context.
   - Source metadata (title, docId, chunkId, revision, page, section) is resolved exclusively from the validated evidence map, preventing metadata leaks from unauthorized documents.
2. **Fabricated Citation Stripping**:
   - Hallucinated or out-of-context citation tags (e.g. `[S99]`, unassigned tags) are excised from the response text.
   - Punctuation spacing is automatically cleaned up when tags are removed (e.g. `"claim [S99]."` becomes `"claim."`).
3. **Grounding & Insufficient Evidence**:
   - A substantive response containing NO valid citations (`hasValidCitations: false`) is rejected as ungrounded and fails closed to `insufficientEvidence: true`.
   - A response containing ONLY fabricated citations is rejected and fails closed to `insufficientEvidence: true`.
   - Responses with mixed valid and invalid citations have invalid tags stripped while valid citations and their source metadata are preserved.
   - Empty retrieval results immediately return the canonical `INSUFFICIENT_EVIDENCE_ANSWER` without invoking the LLM provider.

### 4.4 Deterministic Citation Validation vs. Semantic Entailment
> [!IMPORTANT]
> **Architectural Limitation**: Deterministic citation validation verifies **structural and provenance traceability**, confirming that citation tags syntactically reference evidence passages authorized for the requesting user.
>
> Deterministic citation validation **DOES NOT PROVE SEMANTIC ENTAILMENT**. A generative model could generate a factually incorrect assertion and append a syntactically valid `[S1]` tag that discusses a completely different topic. True semantic entailment verification requires an independent Natural Language Inference (NLI) classifier or cross-encoder verification step, which is distinct from citation extraction.

---

## 5. Prompt-Injection Defense & Insufficient Evidence

1. **Untrusted Data Delimitation**:
   Retrieved text is wrapped inside `<<<EVIDENCE [Sn]>>>` and `<<<END EVIDENCE [Sn]>>>` delimiters.
2. **System Instruction Mandate**:
   The system instruction commands the model to treat retrieved text solely as passive reference data and explicitly forbids executing embedded instructions (e.g., "ignore prior instructions", "reveal secrets", "override authorization").
3. **Explicit Insufficient Evidence**:
   If no authorized documents match, candidate similarity falls below threshold, or the model determines the text does not contain the required facts, the system returns:
   ```json
   {
     "answer": "I do not have sufficient information in the provided documentation to answer this question.",
     "citations": [],
     "insufficientEvidence": true
   }
   ```
   No substantive answer or phantom citations are ever fabricated on insufficient evidence.

---

## 6. HTTP API Specification

### Endpoint: `POST /api/v1/rag/query`
- **Authentication**: Bearer JWT (`req.user: IJwtPayload`).
- **Request Body**:
  ```json
  {
    "query": "What are the company's deployment standards?",
    "topK": 5,
    "similarityThreshold": 0.65
  }
  ```
- **Response Body**:
  ```json
  {
    "success": true,
    "data": {
      "answer": "Deployment standards require zero-downtime rolling updates and mandatory canary analysis [S1].",
      "citations": [
        {
          "evidenceId": "S1",
          "documentId": "671350a12f3e8b0012345601",
          "source": "Engineering Standards 2026.pdf",
          "chunkId": "aaaa1111-1111-1111-1111-111111111111",
          "revision": 1,
          "page": 5
        }
      ],
      "insufficientEvidence": false,
      "retrievalMetadata": {
        "totalCandidates": 1,
        "authorizedChunks": 1,
        "timingsMs": {
          "embedding": 12,
          "retrieval": 45,
          "generation": 180,
          "total": 242
        }
      }
    },
    "meta": {
      "timestamp": "2026-10-19T12:00:00.000Z",
      "requestId": "f8a9b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c"
    }
  }
  ```

---

## 7. Known Limitations & Production Notes

1. **Deterministic Citation vs Semantic Entailment**: As detailed in Section 4.4, deterministic citation validation verifies citation tag existence and authorized evidence association, but does not execute formal natural language inference (NLI). Downstream systems requiring strict entailment should integrate an NLI model.
2. **Token Heuristic Approximation**: Token counts use the character heuristic (~4 characters per token). For exact BPE token limits, downstream providers or tokenizers should be evaluated in Phase 5.
3. **Distributed Audit Chain**: The single-process in-memory write lock in `AuditService` serializes events within a single Node.js heap. Multi-container or clustered horizontal deployments must use a transactional MongoDB chain-head or single-worker queue before scaling horizontally.
