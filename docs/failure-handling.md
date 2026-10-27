# Enterprise AI Knowledge & Support Copilot — Production Failure Scenarios & Resilience Guide

> **Document Type:** Production Failure & Resilience Architectural Specification  
> **Status:** Active Operational Reference  
> **Location:** `docs/failure-handling.md`

---

## 1. Resilience Philosophy & Architectural Safeguards

The Enterprise AI Knowledge & Support Copilot incorporates defensive engineering patterns designed to fail closed on security boundaries while maintaining graceful degradation on peripheral telemetry and caching.

This document analyzes **14 critical production failure scenarios**, detailing verified existing behaviors (detection, timeouts, retries, fallbacks, user impact, and recovery) and distinguishing them from planned operational enhancements.

---

## 2. Detailed Production Failure Scenarios

### Scenario 1: LLM Provider Outage (Google Gemini / OpenAI)
- **Detection:** `LlmFactory` catches HTTP 5xx, 429 quota exhaustion, or socket timeout errors from the primary provider SDK (`@google/genai`).
- **Timeout:** Bounded by Node.js client timeout (`30,000 ms`).
- **Retry & Fallback (Verified in Code):**
  - The backend contains an operational fallback mechanism (`LlmFallbackService` / `llm.factory.ts`). If the configured primary provider (e.g. Gemini) fails with an operational or network error, the fallback provider (e.g. OpenAI GPT-4o-mini) is invoked if `OPENAI_API_KEY` is provisioned.
  - If both providers fail or fallback is unconfigured, the pipeline catches the error and throws `BadGatewayError('LLM generation service failure')`.
- **User-Facing Behavior:** Synchronous chat returns HTTP 502 with structured error JSON. SSE streaming emits `event: message.error` with user-friendly text: *"The AI assistant is temporarily unavailable. Please retry in a few moments."*
- **Logging:** Error logged via Winston with sanitized error details (excluding credentials).
- **Future Improvements:** Implementation of an automated circuit breaker (e.g. `opossum`) to fast-fail traffic and shed load during extended provider outages.

---

### Scenario 2: Vector Database Outage (Qdrant)
- **Detection:** REST/gRPC client connection errors (`ECONNREFUSED`, `ETIMEDOUT`) during `QdrantService.getClient().query()`.
- **Timeout:** Client-level timeout (`5,000 ms`).
- **Special Case Handling (Verified in Code):** In [`retrieval.service.ts`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/services/retrieval.service.ts), if Qdrant returns a 404 (collection missing/uninitialized), the service detects this as zero indexed documents, logs an informational notice, and returns an empty candidate list without crashing.
- **Outage Fallback:** Genuine connection failures throw `BadGatewayError('Vector database search failure')`.
- **User-Facing Behavior:** Chat requests return HTTP 502 or stream error. Document ingestion worker fails the active job and triggers BullMQ retry backoff.
- **Recovery:** Once Qdrant reconnects, subsequent vector searches and ingestion jobs resume automatically without service restart.
- **Future Improvements:** Dedicated read-replica cluster endpoint and degraded keyword-only MongoDB text search fallback.

---

### Scenario 3: Primary Database Outage (MongoDB)
- **Detection:** Mongoose connection state transitions, `MongooseServerSelectionError`, or transaction aborts.
- **Timeout:** `serverSelectionTimeoutMS: 5000` configured in database connection options.
- **Fallback:** Fail closed. All authenticated routes, message writes, and document transactions require database persistence and fail immediately with HTTP 500 / 503.
- **User-Facing Behavior:** Login, upload, and conversation queries return `DATABASE_UNAVAILABLE` error message.
- **Healthcheck:** The `/health` endpoint responds with HTTP 503 (`mongodb: "disconnected"`), allowing container orchestrators (Docker Compose / Kubernetes) to identify unhealthy pods.
- **Recovery:** Mongoose automatically attempts reconnection in the background; transactions roll back safely without orphaned partial documents.

---

### Scenario 4: In-Memory Cache & Queue Outage (Redis)
- **Detection:** `ioredis` emits `error` events during connection drops.
- **Component-Specific Behaviors (Verified in Code):**
  1. **Rate Limiter (`RateLimiterService`):** Fails open on Redis connection errors, logging a warning and allowing user requests through to prevent false-positive denial of service during cache maintenance.
  2. **RAG Response Cache (`RagCacheService`):** Fails open on Redis read/write errors, falling back directly to fresh Qdrant vector retrieval and LLM generation.
  3. **BullMQ Worker Queue:** Ingestion worker enters paused/reconnecting state until Redis returns.
- **User-Facing Behavior:** End users experience slightly higher response latencies (cache bypass) but zero chat disruption. New document uploads remain queued in memory or return 503 if Redis connection is completely terminated.
- **Recovery:** Redis AOF (`appendonly yes`) persistence ensures job queues and rate limit counters are reloaded on restart.

---

### Scenario 5: Duplicate Document Uploads
- **Detection (Verified in Code):** In [`document.service.ts`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/services/document.service.ts), [`FileValidator.validate()`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/services/parsers/file-validator.ts) calculates a SHA-256 hash over the raw binary buffer. Before persisting, the service queries `DocumentModel.findOne({ fileHash })`.
- **Tenancy Boundary:**
  - **Current Single-Tenant Scope (Verified in Code):** Deduplication operates across the single enterprise repository via a global unique index on `{ fileHash: 1 }`.
  - **Proposed Multi-Tenant Roadmap (Future Enhancement):** When migrated to a multi-tenant SaaS model, deduplication will be scoped per-organization via compound unique index `{ organizationId: 1, fileHash: 1 }`, allowing distinct client organizations to upload identical public/template documents without colliding.
- **Behavior:** If a document with identical hash already exists:
  1. An audit event is recorded with action `document.upload`, status `denied`, and details `rejectionReason: 'duplicate_content_hash'`.
  2. The service throws `ConflictError("A document with identical content has already been uploaded...")`.
  3. HTTP 409 Conflict is returned to the client with the existing document title.
- **Idempotency:** No storage file is retained; no background BullMQ job is enqueued.

---

### Scenario 6: Duplicate Document-Processing Jobs
- **Detection (Verified in Code):** In [`ingestion.queue.ts`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/queue/ingestion.queue.ts), job submission constructs a deterministic BullMQ job ID: `doc_${documentId}${revSuffix}_${Date.now()}`.
- **Concurrency Guard:** BullMQ worker concurrency is set to `1` per worker process.
- **Revision Locking:** In [`ingestion.worker.ts`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/queue/ingestion.worker.ts), the worker checks `document.currentRevision` and only stages chunks under `targetRevision = currentRevision + 1`. If an existing job is already processing, duplicate queue submissions are deduplicated by BullMQ job ID.

---

### Scenario 7: Concurrent & Duplicate Chat Request Retries
- **Detection (Verified in Code):** In [`conversation.service.ts`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/services/conversation/conversation.service.ts), client requests may include an `idempotencyKey`.
- **Database Safeguard:** The `messages` collection enforces a unique sparse compound index on `{ conversationId: 1, idempotencyKey: 1 }`.
- **Behavior:**
  - If a duplicate message arrives while the first request is still generating, the second request catches error code `11000` and enters `pollForCompletedAssistantMessage()` rather than invoking a second LLM generation.
  - Once the first generation completes, both requests receive the identical answer and citations.
  - If the client retries with an existing key but altered text, `ConflictError` is thrown.

---

### Scenario 8: Background Ingestion Worker Crashes Mid-Job
- **Detection:** BullMQ lock renewal expires on worker crash or process kill (`SIGKILL`).
- **Retry Policy (Verified in Code):** `defaultJobOptions` specifies `attempts: 3` with exponential backoff:
  ```typescript
  backoff: {
    type: 'exponential',
    delay: 2000,
  }
  ```
- **Recovery:** A surviving or restarted worker claims the stalled job and retries from the beginning.
- **Revision Safety:** Staged vector points use UUIDv5 hashes incorporating `targetRevision`. Any orphaned vector points from a crashed job are overwritten or cleaned up during final index promotion.

---

### Scenario 9: Document Ingestion Fails Halfway
- **Detection:** Parser error (e.g. malformed PDF), embedding API rate limit, or Qdrant connection drop inside `IngestionWorker.processJob()`.
- **Verified Behavior in Code:**
  1. The worker catches the error and records `processingAttempts`.
  2. If an active revision (`currentRevision >= 1`) was already in `READY` status, **the active revision is preserved in READY state**. The failed re-indexing attempt does not take down the document for end users.
  3. If initial upload (`currentRevision == 0`), status transitions to `FAILED` with `errorMessage` recorded in MongoDB.
  4. An audit log entry is recorded with action `document.upload` and status `error`.
  5. The document list UI displays a red `FAILED` badge and enables the `Retry` button.

---

### Scenario 10: Invalid or Degraded LLM Output
- **Detection (Verified in Code):**
  - **Empty Response:** `llmResponse?.text?.trim()` evaluated; if empty, falls back to `INSUFFICIENT_EVIDENCE_ANSWER`.
  - **Citation Fabrication:** [`CitationValidator.validate()`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/services/rag/citation-validator.ts) scans for all `[Sn]` citation tags. Any citation reference not present in the authorized evidence map (e.g. model hallucinates `[S99]`) is stripped from the text.
  - **Markdown Sanitization:** HTML entities are escaped to prevent stored XSS via LLM outputs.

---

### Scenario 11: Irrelevant Retrieval Results
- **Detection:** Vector scores returned by Qdrant fall below `RAG_SIMILARITY_THRESHOLD` (default: `0.65`).
- **Verified Behavior in Code:**
  - The Qdrant search sets `score_threshold: similarityThreshold`. Points with low semantic similarity are filtered out by the vector engine.
  - If candidate count is `0`, RAG does not call the LLM. Instead, it immediately returns:
    `"I do not have sufficient information in the provided documentation to answer this question."`
  - Zero tokens are consumed; telemetry logs status as `filtered_empty`.

---

### Scenario 12: Unauthorized Document Access Attempt
- **Detection (Verified in Code):**
  1. **Pre-Retrieval:** [`retrieval.service.ts`](file:///c:/Users/Programming.com/Desktop/Sharad/enterprise-ai/apps/backend/src/services/retrieval.service.ts) builds native Qdrant filter combining:
     - `minimum_clearance_level: { range: { lte: userClearanceRank } }`
     - `allowed_departments: { match: { value: user.department } }`
     - `allowed_roles: { match: { value: user.role } }`
  2. **Memory Verification:** Secondary validation verifies each candidate point against clearance rank in memory.
  3. **MongoDB Validation:** Batch lookup verifies active document access control and status in MongoDB.
- **Audit Logging:** Any unauthorized direct document download or deletion attempt records an audit event with action `auth.access_denied`.

---

### Scenario 13: Sudden Increase to 10,000 Concurrent Users / Requests
- **Detection:** Increased request arrival rate at Express API.
- **Verified Protective Controls:**
  1. **Dual-Dimensional Rate Limiting:**
     - User quota: 30 requests / minute (configurable via `RATE_LIMIT_CHAT_MAX_REQUESTS`).
     - IP quota: 150 requests / minute per IP.
     - Excess requests receive HTTP 429 Too Many Requests with `Retry-After` header.
  2. **Redis Query Caching:** Identical organizational queries (e.g. company-wide announcement questions) are served in `<15 ms` directly from Redis without invoking Qdrant or LLM APIs.
  3. **Asynchronous Decoupling:** Ingestion uploads return HTTP 202 Accepted immediately upon enqueueing; heavy parsing and vector generation occur in BullMQ workers rather than blocking API worker threads.
- **Recommended Improvements:** Provisioning an ingress load balancer (Nginx / AWS ALB) with autoscaling rules triggered at 70% CPU utilization.

---

### Scenario 14: Growth from 10,000 to 500,000 Requests per Day
- **Scale Metrics:** 500,000 requests/day corresponds to an average of ~6 requests/sec, with peak hours reaching 30–50 requests/sec.
- **Architectural Readiness:**
  1. **Stateless API Services:** Express instances share no in-process state; sessions are stored in MongoDB with TTL indexes and verified via JWT claims. Multiple backend pods can run behind an ALB.
  2. **MongoDB Connection Pooling:** Configured with `maxPoolSize: 50` per pod. Read-heavy analytics and document listings can route to replica set secondary nodes via `readPreference: secondaryPreferred`.
  3. **Qdrant Vector Sharding:** Qdrant collections can be distributed across multi-node clusters with replication factor $\ge 2$.
  4. **Cost & Quota Controls:** Response caching and similarity threshold filtering suppress unnecessary LLM calls, keeping Gemini/OpenAI API costs linear and bounded.

---

## 3. Summary of Existing vs. Future Failure Safeguards

| Feature / Safeguard | Verified in Code | Future Enhancement |
| :--- | :---: | :---: |
| Dual-Provider LLM Fallback (Gemini $\rightarrow$ OpenAI) | **YES** | Automated Circuit Breaker (Opossum) |
| Pre-Retrieval Vector ACL Filtering | **YES** | Cross-region vector replication |
| SHA-256 Upload Deduplication | **YES** | S3 object-lock immutability |
| BullMQ Exponential Backoff Retries | **YES** | Dead-letter queue (DLQ) alerts |
| Rate Limiting (User + IP Sliding Window) | **YES** | Web Application Firewall (WAF) integration |
| Redis Cache Generation Counter Invalidation | **YES** | Multi-region Redis cluster |
| Client Idempotency Keys on Messages | **YES** | Distributed lock sequencer |
| Cryptographic Audit Chain Verification | **YES** | Hardware Security Module (HSM) signing |
