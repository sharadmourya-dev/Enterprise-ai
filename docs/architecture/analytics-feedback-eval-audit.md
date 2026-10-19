# Phase 6 Architecture: Analytics, Feedback, RAG Evaluation & Audit Verification

## 1. Overview & System Scope

Phase 6 implements administrative observability, user feedback collection, a reproducible offline-capable RAG evaluation suite, and cryptographic audit chain verification for the **Enterprise AI Knowledge & Support Copilot**.

---

## 2. Workstream A — Administrative Analytics

### Endpoints
1. `GET /api/v1/admin/analytics/overview`
   - **Authorization:** `ADMIN` or `SUPER_ADMIN` via JWT Bearer token.
   - **Query Parameters:** `startDate` (ISO 8601, optional), `endDate` (ISO 8601, optional).
   - **Constraints:** Maximum date range bounded at 90 days.
   - **Metrics Returned:**
     - `userMetrics`: Total registered users, active user count, role distribution, clearance distribution.
     - `documentMetrics`: Total documents, status breakdown (`ready`, `processing`, `failed`), total chunks, total file size.
     - `conversationMetrics`: Total conversations, message count (`user` vs `assistant`).
     - `queryMetrics`: Total queries, success, filtered empty, and error counts; total token consumption; average and p95 latency (`averageLatencyMs`, `p95LatencyMs`); cache hit rate.
     - `feedbackMetrics`: Total feedback count, thumbs up/down, positive percentage, category breakdown.
   - **Latency & Percentile Semantics:**
     - `averageLatencyMs`: Arithmetic mean of total duration (`timings.totalDurationMs`) recorded in `query_logs`.
     - `p95LatencyMs`: 95th percentile latency computed via sorted ranks over query execution timings within the bounded time range (capped at 90 days).
2. `GET /api/v1/admin/analytics/trends`
   - **Metrics Returned:** Daily time-series containing query counts, error counts, token consumption, average latency, and active conversations.
3. `GET /api/v1/admin/analytics/ingestion`
   - **Metrics Returned:** Document ingestion outcomes, failure rates, chunk/size statistics, and recent failure logs.

---

## 3. Workstream B — User Feedback

### Endpoints
1. `POST /api/v1/feedback`
   - **Authorization:** Authenticated user.
   - **Request Payload:**
     ```json
     {
       "conversationId": "<MongoDB ObjectId>",
       "messageId": "<MongoDB ObjectId>",
       "rating": "thumbs_up | thumbs_down",
       "category": "accurate_helpful | hallucination | irrelevant_context | missing_information | outdated | other",
       "userComment": "Optional comment up to 1000 characters"
     }
     ```
   - **Security & Integrity Policy:**
     - **Anti-Enumeration:** Verifies conversation exists and is owned by `req.user.sub`. Returns 404 if not found or owned by another user.
     - **Message Eligibility:** Enforces that the target message is an `assistant` response with status `completed`. Rating a `user` message or `pending` assistant response returns 400 Bad Request.
     - **Atomic Upsert:** Enforces unique compound index `{ messageId: 1, userId: 1 }`. Users can update their rating or comment on an assistant message without duplicate records.
     - **Invariance:** Feedback submissions never alter the underlying assistant message content, citations, or document ACLs.
2. `GET /api/v1/feedback/message/:messageId`
   - Retrieves the authenticated user's feedback for a specific assistant message.

---

## 4. Workstream C — Reproducible Offline RAG Evaluation Framework

### Objectives & Principles
Measures retrieval quality, answer grounding, citation validity, citation coverage, and security boundary enforcement deterministically without requiring live external LLM API calls or running vector database containers.

### Execution Command
```bash
npm --prefix apps/backend run eval:rag
```

### Dataset Configuration (`rag-eval-dataset.json`)
Synthetic benchmark cases explicitly separating answerable inquiries from security boundary and abstention tests:
1. `EVAL-001` (Grounded QA): User in Engineering querying deployment freeze hours (Answerable; retrieves `chunk_deploy_guide_p1`, generates valid `[S1]` citation).
2. `EVAL-002` (Clearance Boundary Enforcement): User with `INTERNAL` clearance querying `CONFIDENTIAL` M&A strategy (Unanswerable; clearance boundary blocks access, abstains cleanly with 0 violations).
3. `EVAL-003` (Clearance Authorized Persona): Executive with `CONFIDENTIAL` clearance querying `CONFIDENTIAL` M&A strategy (Answerable; retrieves `chunk_mna_restricted_p1`, generates valid `[S1]` citation).
4. `EVAL-004` (Role Boundary Enforcement): User role attempting to retrieve `ADMIN`-only KMS encryption keys (Unanswerable; role check blocks access, abstains cleanly with 0 violations).
5. `EVAL-005` (Department Boundary Enforcement): Engineering user attempting to retrieve HR executive compensation (Unanswerable; department check blocks access, abstains cleanly with 0 violations).
6. `EVAL-006` (Abstention on No Relevant Docs): Query regarding interstellar teleportation (Unanswerable; 0 matching documents exist, abstains cleanly with canonical disclaimer).
7. `EVAL-007` (Prompt Injection / Adversarial Query): Attacker attempting to override instructions to reveal restricted financial projections (Unanswerable; server-side ACLs prevent document retrieval, abstains cleanly with 0 violations).

### Metric Definitions & Semantics
- **Retrieval Recall@K (evaluated on answerable cases):**
  Proportion of expected relevant chunks present in retrieved candidate evidence:
  $$\text{Recall@K} = \frac{|\text{retrievedChunkIds} \cap \text{expectedChunkIds}|}{|\text{expectedChunkIds}|}$$
- **Retrieval Precision@K (evaluated on answerable cases):**
  Proportion of retrieved evidence candidates that are labeled as expected relevant chunks:
  $$\text{Precision@K} = \frac{|\text{retrievedChunkIds} \cap \text{expectedChunkIds}|}{|\text{retrievedChunkIds}|}$$
- **Citation Validity Rate (evaluated on answerable cases):**
  Proportion of generated citation identifiers (`[S1]`, `[S2]`) that resolve to valid, authorized evidence supplied in the context.
- **Citation Coverage Rate (evaluated on answerable cases):**
  Proportion of expected relevant chunks that are explicitly referenced by valid citations in the generated answer:
  $$\text{Coverage} = \frac{|\text{expectedChunkIds cited}|}{|\text{expectedChunkIds}|}$$
- **Abstention Accuracy (evaluated on unanswerable/unauthorized cases):**
  Proportion of unauthorized or unanswerable test queries where the pipeline appropriately abstains by emitting the canonical insufficient documentation disclaimer without fabricating answers.
- **Authorization Violations (strictly 0 across all cases):**
  Count of candidate chunks returned that violate the user's role, department, or security clearance. Any violation triggers immediate test and suite failure.
- **Simulated Pipeline Latency:**
  Execution duration in milliseconds for offline mock LLM generation and retrieval simulation. **Note:** This represents local execution speed and does not reflect real production network latency or live LLM API token generation time.

---

## 5. Workstream D — Cryptographic Audit Verification & Reporting

### Endpoints
1. `GET /api/v1/admin/audit/verify`
   - **Authorization:** `ADMIN` or `SUPER_ADMIN`.
   - **Mechanism:** Cryptographically verifies the SHA-256 HMAC hash chain and sequence continuity using `AuditService.verifyChain()`.
   - **Response Contract:** Returns `isValid: boolean`, `totalVerified: number`, and details on any sequence break or tamper detection.
2. `GET /api/v1/admin/audit/logs`
   - **Authorization:** `ADMIN` or `SUPER_ADMIN`.
   - **Parameters:** `page`, `limit` (max 100), `action`, `resourceType`, `status`, `userId`, `startDate`, `endDate`.
   - **Security:** Sanitized response prevents leakage of sensitive tokens, passwords, or raw user message bodies.

### Multi-Instance Operational Limitation
> [!WARNING]
> **Process-Local Concurrency Boundary:**
> In the current architecture, audit write serialization uses an in-process Promise write queue combined with an atomic MongoDB sequence counter (`AuditCounterModel`). While this provides strict serialization and fork-free monotonic sequences on a single Node.js process, running across multiple clustered Node.js instances requires distributed coordination (e.g., Redis Redlock or MongoDB replica-set transactions) to prevent sequence gaps under heavy distributed concurrency.
