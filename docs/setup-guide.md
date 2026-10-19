# Local Setup & Manual Environment Configuration Guide

This guide provides step-by-step instructions for preparing your local developer environment, generating cryptographic secrets, and safely creating actual `.env` files without exposing credentials.

---

## 1. Environment File Placement

Actual environment files are **strictly excluded from Git** via `.gitignore`. You will create the actual environment files locally using the template provided in `.env.example`.

### File Locations:
1. **Root / Backend Environment File**:
   - Location: `c:\Users\Programming.com\Desktop\Sharad\enterprise-ai\.env`
   - Purpose: Primary configuration for the Express.js server, Mongoose (MongoDB), BullMQ / Redis, Qdrant vector database, JWT authentication, and AI provider integration.
2. **Frontend Environment File** (Required in Phase 7):
   - Location: `c:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\frontend\.env.local`
   - Purpose: Next.js public client variables (e.g. `NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1`).

---

## 2. Generating Local Cryptographic Secrets

The backend requires three distinct, cryptographically strong 256-bit secrets for JWT signing and tamper-evident audit logging. **Do not paste or share these values in chats or commit them to source control.**

Run the following commands in **Windows PowerShell** to generate secure, cryptographically random base64 secrets:

### Generate Access Token Secret (`JWT_ACCESS_SECRET`):
```powershell
$bytes = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
```

### Generate Refresh Token Secret (`JWT_REFRESH_SECRET`):
```powershell
$bytes = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
```

### Generate Audit Log HMAC Secret (`AUDIT_LOG_HMAC_SECRET`):
```powershell
$bytes = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
```

---

## 3. Step-by-Step PowerShell Setup for `.env`

To create and populate `.env` safely on Windows without revealing secrets to any console history:

```powershell
# 1. Navigate to the project root
cd c:\Users\Programming.com\Desktop\Sharad\enterprise-ai

# 2. Copy the template to .env
Copy-Item .env.example .env

# 3. Open .env in your preferred editor (Notepad, VS Code, etc.)
notepad .env
```

In the opened editor, paste the generated secrets and your local settings.

---

## 4. Environment Variables Breakdown

| Variable | Category | Source | Target Service | When Required | Description & Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Runtime | System | Express / Node | Phase 1+ | Runtime environment (`development`, `test`, `production`). |
| `PORT` | Runtime | Local Config | Express Server | Phase 1+ | HTTP listener port for Express REST API (Default: `5000`). |
| `FRONTEND_URL` | Security | Local Config | Express CORS | Phase 1+ | Allowed origin for Cross-Origin Resource Sharing (Default: `http://localhost:3000`). |
| `API_BASE_URL` | Network | Local Config | Express Server | Phase 1+ | Base prefix for versioned endpoints (`http://localhost:5000/api/v1`). |
| `TRUST_PROXY` | Network | Local Config | Express Server | Phase 5+ | Trusted proxy setting for client IP resolution (`loopback`, `false`, `1`, CIDR list). |
| `MONGODB_URI` | Database | Local Infra | Mongoose ODM | Phase 2+ | Connection URI to MongoDB replica set `rs0` (`mongodb://localhost:27017/enterprise_ai?replicaSet=rs0`). |
| `MONGODB_TEST_URI`| Database | Local Infra | Mongoose (Tests) | Phase 2+ | Isolated database connection string used for automated test suites. |
| `REDIS_HOST` | Cache/Queue | Local Infra | BullMQ / ioredis | Phase 3+ | Host address of Redis instance (Default: `localhost`). |
| `REDIS_PORT` | Cache/Queue | Local Infra | BullMQ / ioredis | Phase 3+ | Port of Redis instance (Default: `6379`). |
| `REDIS_PASSWORD` | Security | Local Infra | Redis Client | Phase 3+ | Optional password for secured Redis instances (leave blank for local dev). |
| `QDRANT_URL` | Vector DB | Local Infra | Vector Search | Phase 3+ | HTTP REST endpoint for Qdrant (Default: `http://localhost:6333`). |
| `QDRANT_API_KEY` | Vector DB | Local Infra | Qdrant Client | Phase 3+ | Optional API key for cloud or secured Qdrant instances (leave blank for local dev). |
| `QDRANT_COLLECTION_NAME` | Vector DB | Local Config | Vector Search | Phase 3+ | Vector collection name (Default: `enterprise_knowledge_chunks`). |
| `JWT_ACCESS_SECRET` | Security | **Locally Generated** | Auth Service | Phase 2+ | 256-bit secret used to sign short-lived Access Tokens (15m). |
| `JWT_REFRESH_SECRET`| Security | **Locally Generated** | Auth Service | Phase 2+ | 256-bit secret used to sign rotating Refresh Tokens (7d). |
| `JWT_ACCESS_EXPIRATION` | Auth | Local Config | Auth Service | Phase 2+ | Access token lifespan (Default: `15m`). |
| `JWT_REFRESH_EXPIRATION`| Auth | Local Config | Auth Service | Phase 2+ | Refresh token lifespan (Default: `7d`). |
| `AUDIT_LOG_HMAC_SECRET` | Security | **Locally Generated** | Audit Service | Phase 6+ | 256-bit secret used for cryptographic HMAC chaining in AuditLogs. |
| `LLM_PROVIDER` | AI Model | Local Config | LLM Factory | Phase 4+ | Active LLM provider: `'gemini'` or `'openai'`. |
| `GEMINI_API_KEY` | External AI | **Google AI Studio** | LangChain / Gemini | Phase 3+ / 4+ | API Key from Google AI Studio. **Never commit or share in chat.** |
| `OPENAI_API_KEY` | External AI | **OpenAI Platform** | LangChain / OpenAI | Phase 3+ / 4+ | API Key from OpenAI Platform. **Never commit or share in chat.** |
| `GEMINI_MODEL` | AI Model | Configuration | LLM Factory | Phase 4+ | Active Gemini model identifier (Default: `gemini-3.8-flash`; official stable model: `https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash`; `gemini-1.5-pro` shut down Sept 2025). |
| `GEMINI_EMBEDDING_MODEL`| AI Model | Configuration | Embeddings | Phase 3+ | Active Gemini embedding model (Default: `gemini-embedding-2`; 768 dims). |
| `OPENAI_MODEL` | AI Model | Configuration | LLM Factory | Phase 4+ | Active OpenAI model identifier (Default: `gpt-4o-mini`; official text-generation model: `https://platform.openai.com/docs/models/gpt-4o-mini`). |
| `OPENAI_EMBEDDING_MODEL`| AI Model | Configuration | Embeddings | Phase 3+ | Active OpenAI embedding model (Default: `text-embedding-3-small`; 1536 dims). |
| `CHUNK_SIZE` | Ingestion | Tuning Param | Chunker | Phase 3+ | Ingestion text chunk size in tokens (Default: `500`). |
| `CHUNK_OVERLAP` | Ingestion | Tuning Param | Chunker | Phase 3+ | Ingestion overlap size in tokens (Default: `50`). |
| `RAG_TOP_K` | Retrieval | Tuning Param | RAG Pipeline | Phase 4+ | Number of relevant chunks retrieved per query (Default: `5`). |
| `RAG_SIMILARITY_THRESHOLD`| Retrieval| Tuning Param | RAG Pipeline | Phase 4+ | Minimum cosine similarity score threshold (Default: `0.65`). |
| `MAX_FILE_SIZE_BYTES` | Upload | Tuning Param | Document Upload | Phase 3+ | Maximum allowed file upload size (Default: `52428800` = 50MB). |
| `RATE_LIMIT_WINDOW_MS`| Security | Tuning Param | RateLimiter | Phase 5+ | Rate limiting sliding window in ms (Default: `900000` = 15m). |
| `RATE_LIMIT_MAX_REQUESTS`| Security| Tuning Param | RateLimiter | Phase 5+ | Max requests allowed within sliding window (Default: `100`). |

---

## 5. Service Startup Order & Manual Process Management

To maintain full local developer control, services should be launched manually in separate dedicated terminal windows. **Development servers are never launched automatically in the background by automated agents.**

### Startup Order
1. **Infrastructure Containers** (MongoDB, Redis, Qdrant) — Must be healthy first.
2. **Backend API Server** (Express.js on port 5000) — Connects to Mongo, Redis, and Qdrant.
3. **Frontend Application** (Next.js on port 3000) — Connects to backend API.

---

### Step 1: Start Infrastructure Containers (Terminal 1)

In your root repository directory:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npm run infra:up
```

#### Verification:
```powershell
cmd /c npm run infra:status
```
Expected output: `enterprise_ai_mongodb`, `enterprise_ai_redis`, `enterprise_ai_qdrant` all reporting `(healthy)`.

#### Stopping Infrastructure:
```powershell
cmd /c npm run infra:down
```

---

### Step 2: Start Backend REST API Server (Terminal 2)

```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\backend
cmd /c npm run dev
```

#### Expected URLs & Verification:
- **Liveness Probe**: `http://localhost:5000/health/liveness` (returns `{ "status": "UP" }`)
- **Readiness Probe**: `http://localhost:5000/health/readiness` (returns `{ "status": "READY", "database": "connected" }`)
- **Interactive Swagger Docs**: `http://localhost:5000/api/docs`

#### How to Stop:
Press `Ctrl + C` in Terminal 2.

---

### Step 2b: Start Asynchronous Ingestion Worker (Terminal 3)

The background document parsing, chunking, embedding, and vector indexing pipeline runs asynchronously on BullMQ and Redis.

```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\backend
cmd /c npm run worker
```

#### Expected Output & Verification:
```
Starting Enterprise AI Document Ingestion Worker...
MongoDB connected successfully to rs0
Ingestion Worker is active and listening for BullMQ document jobs.
```

#### How to Stop:
Press `Ctrl + C` in Terminal 3 (gracefully completes in-flight jobs and disconnects).

---

### Step 3: Start Frontend Next.js Application (Terminal 4)

```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\frontend
cmd /c npm run dev
```

#### Expected URLs & Verification:
- **Application URL**: `http://localhost:3000`

#### How to Stop:
Press `Ctrl + C` in Terminal 3.

---

## 6. Common Startup Troubleshooting

1. **MongoDB Replica Set Connection Error (`MongoServerSelectionError`)**:
   - Cause: MongoDB container still initializing or replica set hostname resolution issue.
   - Fix: Verify replica set status with:
     ```powershell
     docker exec enterprise_ai_mongodb mongosh --eval "rs.status().ok"
     ```
     Ensure `MONGODB_URI` includes `?replicaSet=rs0&directConnection=true`.
2. **Redis Connection Refused (`ECONNREFUSED 127.0.0.1:6379`)**:
   - Cause: Redis container stopped or port collision.
   - Fix: Check `docker compose -f infrastructure/docker-compose.infra.yml ps`. Restart with `cmd /c npm run infra:up`.
3. **Port Collisions (Port 5000 or 3000 in use)**:
   - Check which process is holding the port:
     ```powershell
     netstat -ano | findstr "5000 3000"
     ```
   - Change `PORT` in `.env` if 5000 is occupied by another local service.

---

## 7. Phase 4 — Secure RAG Query API & Verification

### 7.1 Running Phase 4 Automated Tests

Run the complete test suite (includes 16 test suites, 139 tests):
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npm test --workspace=@enterprise-ai/backend
```

Run only Phase 4 Retrieval and RAG Orchestration test suites:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\backend
cmd /c npx jest tests/retrieval.test.ts tests/rag.test.ts
```

### 7.2 Manual RAG Query Endpoint Verification

When the backend is running (`npm run dev`), test the authenticated RAG query endpoint using PowerShell:

```powershell
# 1. Obtain an access token
$loginBody = @{ email = "developer@enterprise.com"; password = "Password123!" } | ConvertTo-Json
$authRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
$token = $authRes.data.accessToken

# 2. Query the Grounded RAG Copilot endpoint
$queryBody = @{ query = "What are the company deployment standards?" } | ConvertTo-Json
$headers = @{ Authorization = "Bearer $token" }
$ragRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/rag/query" -Method Post -ContentType "application/json" -Headers $headers -Body $queryBody

# 3. Inspect structured response
$ragRes.data | Format-List answer, insufficientEvidence, citations, retrievalMetadata
```

---

## 8. Phase 5 — Conversational Chat, SSE Streaming, Redis Caching & Rate Limiting

### 8.1 Running Phase 5 Automated Tests

Run the complete test suite (all 22 test suites, 201 tests):
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npm test --workspace=@enterprise-ai/backend
```

Run only Phase 5 specific test suites:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\backend
cmd /c npx jest tests/conversation-lifecycle.test.ts tests/multi-turn-rag.test.ts tests/sse-streaming.test.ts tests/rag-cache.test.ts tests/rate-limiter.test.ts
```

Run TypeScript typecheck:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npx --workspace=@enterprise-ai/backend tsc --noEmit
```

Run production build:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npm --prefix apps/backend run build
```

---

### 8.2 Manual Execution Only — Not Run by Antigravity

> [!NOTE]
> The following commands require running services (MongoDB on port 27017, Redis on port 6379, Qdrant on port 6333, and backend on port 5000). Ensure infrastructure is active (`cmd /c npm run infra:up`) and the backend server is running in a separate terminal (`cmd /c npm --prefix apps/backend run dev`).

#### 1. Authenticate and Obtain JWT Access Token
```powershell
$loginBody = @{ email = "developer@enterprise.com"; password = "Password123!" } | ConvertTo-Json
$authRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
$token = $authRes.data.accessToken
$headers = @{ Authorization = "Bearer $token" }
```

#### 2. Create a Conversation
```powershell
$convBody = @{ title = "Cloud Migration Strategy" } | ConvertTo-Json
$convRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/conversations" -Method Post -ContentType "application/json" -Headers $headers -Body $convBody
$convId = $convRes.data.id
Write-Host "Created Conversation ID: $convId"
```

#### 3. Send Multi-Turn Grounded Message (Turn 1)
```powershell
$msg1Body = @{ content = "What are the required compliance standards for cloud deployment?" } | ConvertTo-Json
$msg1Res = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/conversations/$convId/messages" -Method Post -ContentType "application/json" -Headers $headers -Body $msg1Body
$msg1Res.data.assistantMessage | Format-List content, citations, latencyMs
```

#### 4. Send Multi-Turn Follow-up Message (Turn 2)
```powershell
$msg2Body = @{ content = "Are there any exceptions to those standards?" } | ConvertTo-Json
$msg2Res = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/conversations/$convId/messages" -Method Post -ContentType "application/json" -Headers $headers -Body $msg2Body
$msg2Res.data.assistantMessage | Format-List content, citations, latencyMs
```

#### 5. Open Server-Sent Events (SSE) Stream
```powershell
# Using curl to observe real-time SSE event framing:
curl -N -X POST "http://localhost:5000/api/v1/conversations/$convId/messages/stream" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"content": "Summarize the key requirements discussed."}'
```

#### 6. Retrieve Paginated Message History
```powershell
$historyRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/conversations/$convId/messages?page=1&limit=10" -Method Get -Headers $headers
$historyRes.data | Format-Table id, sender, content
```

#### 7. Verify Ownership Isolation (Cross-User Access)
```powershell
# Login as a different user
$bobLogin = @{ email = "hr.specialist@enterprise.com"; password = "Password123!" } | ConvertTo-Json
$bobAuth = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $bobLogin
$bobHeaders = @{ Authorization = "Bearer $($bobAuth.data.accessToken)" }

# Attempt to access User A's conversation (Must return 404 Not Found)
try {
  Invoke-RestMethod -Uri "http://localhost:5000/api/v1/conversations/$convId" -Method Get -Headers $bobHeaders
} catch {
  Write-Host "Correctly rejected cross-user read with StatusCode:" $_.Exception.Response.StatusCode
}
```

#### 8. Observe Sliding-Window Rate Limiting
```powershell
# Rapidly fire requests to exceed RATE_LIMIT_CHAT_MAX_REQUESTS (20/min)
1..25 | ForEach-Object {
  try {
    $res = Invoke-WebRequest -Uri "http://localhost:5000/api/v1/conversations/$convId/messages" -Method Post -Headers $headers -ContentType "application/json" -Body '{"content":"ping"}'
    Write-Host "Request $_ Status: $($res.StatusCode) Remaining: $($res.Headers['X-RateLimit-Remaining'])"
  } catch {
    Write-Host "Request $_ Rate Limited: $($_.Exception.Response.StatusCode) Retry-After: $($_.Exception.Response.Headers['Retry-After'])"
  }
```

---

## 9. Phase 6 — Analytics, Feedback, RAG Evaluation & Audit Verification

### 9.1 Running Phase 6 Automated Tests

Run the complete test suite (all 26 test suites, 253+ tests):
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npm test --workspace=@enterprise-ai/backend
```

Run only Phase 6 specific test suites:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\backend
cmd /c npx jest tests/admin-analytics.test.ts tests/feedback.test.ts tests/rag-eval.test.ts tests/admin-audit.test.ts
```

Run the Reproducible Offline RAG Evaluation Suite:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai\apps\backend
cmd /c npm run eval:rag
```

Run TypeScript typecheck:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npx --workspace=@enterprise-ai/backend tsc --noEmit
```

Run production build:
```powershell
# Working Directory: C:\Users\Programming.com\Desktop\Sharad\enterprise-ai
cmd /c npm --prefix apps/backend run build
```

---

### 9.2 Manual Endpoint Verification (When Server is Active)

#### 1. Admin Analytics Overview & Latency Percentiles
```powershell
$adminLogin = @{ email = "admin@enterprise.com"; password = "Password123!" } | ConvertTo-Json
$authRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $adminLogin
$adminToken = $authRes.data.accessToken
$headers = @{ Authorization = "Bearer $adminToken" }

# Retrieve overview metrics (bounded by date)
$overviewRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/admin/analytics/overview" -Method Get -Headers $headers
$overviewRes.data.queryMetrics | Format-List totalQueries, successQueries, averageLatencyMs, p95LatencyMs, cacheHitRatePercentage
```

#### 2. Submit User Message Feedback
```powershell
$userHeaders = @{ Authorization = "Bearer $token" } # regular user token
$feedbackBody = @{
  conversationId = "$convId"
  messageId = "$assistantMsgId"
  rating = "thumbs_up"
  category = "accurate_helpful"
  userComment = "Grounded response with verified citations."
} | ConvertTo-Json

$feedbackRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/feedback" -Method Post -ContentType "application/json" -Headers $userHeaders -Body $feedbackBody
$feedbackRes.data | Format-List id, rating, category, reviewedByAdmin
```

#### 3. Cryptographic Audit Chain Verification
```powershell
$auditVerifyRes = Invoke-RestMethod -Uri "http://localhost:5000/api/v1/admin/audit/verify" -Method Get -Headers $headers
$auditVerifyRes.data | Format-List isValid, totalVerified, firstCorruptedSequence
```
