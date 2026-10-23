# Enterprise AI Knowledge & Support Copilot

An enterprise-grade, multi-tenant AI copilot powered by Retrieval-Augmented Generation (RAG), strict document-level Access Control Lists (ACLs), role-based security clearances, asynchronous document ingestion, and real-time Server-Sent Events (SSE) streaming.

---

## Architecture Overview

- **Monorepo Architecture**: Managed via npm workspaces (`packages/*`, `apps/*`).
- **Frontend**: Next.js 14+ (App Router), React 18, TypeScript, Tailwind CSS (`apps/frontend`).
- **Backend**: Node.js, Express.js, TypeScript, REST APIs (`apps/backend`).
- **Primary Database**: MongoDB 7.0 (Single-node Replica Set `rs0` for multi-document ACID transactions).
- **Vector Database**: Qdrant (dense embeddings with pre-retrieval payload ACL filtering).
- **Caching & Job Queue**: Redis 7.2 (ioredis caching and BullMQ asynchronous ingestion workers).
- **AI Orchestration**: LangChain.js with provider abstraction (Google Gemini & OpenAI).
- **Authentication**: JWT access/refresh token rotation, bcrypt hashing, and hierarchical RBAC.
- **Shared Types**: Centralized TypeScript DTOs, interfaces, and enums (`@enterprise-ai/shared-types`).

---

## Project Structure

```
enterprise-ai/
├── .github/workflows/         # CI/CD pipelines
├── apps/
│   ├── backend/               # Express REST API, LangChain RAG & BullMQ workers
│   └── frontend/              # Next.js App Router UI
├── packages/
│   └── shared-types/          # Shared TypeScript contracts & DTOs
├── infrastructure/
│   └── docker-compose.infra.yml # MongoDB, Redis, and Qdrant local services
├── docs/
│   ├── architecture/corrections.md # Security corrections & empty-ACL semantics
│   └── setup-guide.md         # Environment variables & secret setup guide
├── .env.example               # Master environment template (no secrets committed)
├── .gitignore                 # Strict Git exclusion list
├── package.json               # Root workspace manifest
└── tsconfig.base.json         # Strict base TypeScript compiler options
```

---

## Local Development Quickstart

### Prerequisites
- Node.js `v20+` (Verified: `v24.21.0`)
- npm `v10+` (Verified: `11.19.0`)
- Docker Desktop with Docker Compose (Verified: Docker Engine `29.8.2`, Compose `v5.5.1`)

### 1. Install Workspace Dependencies
On Windows, run npm commands via `cmd /c npm` or `npm.cmd`:
```powershell
cmd /c npm ci
```

### 2. Build Shared Types
Build shared contracts before typechecking or running dependent workspaces:
```powershell
cmd /c npm run build:packages
```

### 3. Start Local Infrastructure
Start MongoDB (with replica set `rs0`), Redis, and Qdrant in Docker:
```powershell
cmd /c npm run infra:up
```

Verify service status:
```powershell
cmd /c npm run infra:status
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env` and configure your local settings. Follow the detailed instructions in [docs/setup-guide.md](docs/setup-guide.md).

```powershell
Copy-Item .env.example .env
```

### 5. Typecheck & Test
Run workspace typechecks and test suites locally:
```powershell
# Typecheck all workspaces (builds shared types first)
cmd /c npm run typecheck

# Run backend unit tests (pure in-memory tests)
cmd /c npm run test:unit --workspace=@enterprise-ai/backend

# Run frontend tests
cmd /c npm run test --workspace=@enterprise-ai/frontend

# Run production builds
cmd /c npm run build
```

---

## License
Proprietary & Confidential — Enterprise AI Copilot Project.
