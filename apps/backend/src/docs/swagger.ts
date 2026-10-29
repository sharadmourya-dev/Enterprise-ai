import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

export const openapiSpecification: Record<string, unknown> = {
  openapi: '3.0.3',
  info: {
    title: 'Enterprise AI Knowledge & Support Copilot REST API',
    version: '1.0.0',
    description:
      'Production-grade REST API and Server-Sent Events (SSE) streaming specification for the Enterprise AI Knowledge & Support Copilot. Supports role-based security clearances, document-level Access Control Lists (ACLs), cryptographic audit logs, and grounded AI responses.',
    contact: {
      name: 'Enterprise Architecture & Security Team',
      email: 'architect@enterprise.local',
    },
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide your JWT access token formatted as: Bearer <token>',
      },
    },
    schemas: {
      StandardError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'BAD_REQUEST' },
              message: { type: 'string', example: 'Invalid request parameters' },
              details: { type: 'array', items: { type: 'object' }, nullable: true },
            },
            required: ['code', 'message'],
          },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 120 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          totalPages: { type: 'integer', example: 12 },
        },
        required: ['total', 'page', 'limit', 'totalPages'],
      },
      UserClaims: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '671350a12f3e8b0012345001' },
          email: { type: 'string', format: 'email', example: 'employee@enterprise.com' },
          name: { type: 'string', example: 'Jane Doe' },
          role: {
            type: 'string',
            enum: ['user', 'support_agent', 'compliance_officer', 'knowledge_manager', 'admin', 'super_admin'],
            example: 'user',
          },
          department: { type: 'string', example: 'Engineering' },
          securityClearance: {
            type: 'string',
            enum: ['public', 'internal', 'confidential', 'restricted'],
            example: 'internal',
          },
          permissions: {
            type: 'array',
            items: { type: 'string' },
            example: ['documents:upload'],
          },
          isActive: { type: 'boolean', example: true },
        },
      },
      DocumentAccessControl: {
        type: 'object',
        properties: {
          allowedRoles: {
            type: 'array',
            items: { type: 'string' },
            example: ['user', 'admin'],
          },
          allowedDepartments: {
            type: 'array',
            items: { type: 'string' },
            example: ['Engineering'],
          },
          minimumClearance: {
            type: 'string',
            enum: ['public', 'internal', 'confidential', 'restricted'],
            example: 'internal',
          },
          allowedUserIds: {
            type: 'array',
            items: { type: 'string' },
            example: [],
          },
        },
      },
      DocumentEntity: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'doc-671350a12f3e8b0012345699' },
          title: { type: 'string', example: 'Engineering Deployment Guide' },
          originalFilename: { type: 'string', example: 'deploy_guide.docx' },
          mimeType: {
            type: 'string',
            enum: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
            example: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          fileSizeBytes: { type: 'integer', example: 18450 },
          fileHash: { type: 'string', example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90' },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'ready', 'failed'],
            example: 'ready',
          },
          chunkCount: { type: 'integer', example: 12 },
          tokenCount: { type: 'integer', example: 2840 },
          currentRevision: { type: 'integer', example: 1 },
          uploadedBy: { type: 'string', example: '671350a12f3e8b0012345001' },
          accessControl: { $ref: '#/components/schemas/DocumentAccessControl' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Citation: {
        type: 'object',
        properties: {
          citationId: { type: 'string', example: 'S1' },
          chunkId: { type: 'string', example: 'chunk_001_deploy' },
          documentId: { type: 'string', example: 'doc_671350a12f3e8b0012345699' },
          documentTitle: { type: 'string', example: 'Engineering Deployment Guide' },
          pageNumber: { type: 'integer', nullable: true, example: 4 },
          sectionHeader: { type: 'string', nullable: true, example: 'Deployment Freeze Windows' },
          contentSnippet: { type: 'string', example: 'Standard engineering deployment freeze occurs on Fridays after 2 PM...' },
        },
      },
      SearchResultItem: {
        type: 'object',
        required: ['chunkId', 'documentId', 'revision', 'title', 'content', 'score', 'rank'],
        properties: {
          chunkId: { type: 'string', example: 'chunk_001_deploy' },
          documentId: { type: 'string', example: 'doc_671350a12f3e8b0012345699' },
          revision: { type: 'integer', example: 1 },
          title: { type: 'string', example: 'Engineering Deployment Guide' },
          content: { type: 'string', example: 'Standard engineering deployment freeze occurs on Fridays after 2 PM...' },
          pageNumber: { type: 'integer', nullable: true, example: 4 },
          sectionHeader: { type: 'string', nullable: true, example: 'Deployment Freeze Windows' },
          score: { type: 'number', example: 0.88 },
          rank: { type: 'integer', example: 1 },
        },
      },
      SearchResponseData: {
        type: 'object',
        required: ['query', 'results', 'total', 'timings'],
        properties: {
          query: { type: 'string', example: 'deployment freeze windows' },
          results: {
            type: 'array',
            items: { $ref: '#/components/schemas/SearchResultItem' },
          },
          total: { type: 'integer', example: 1 },
          timings: {
            type: 'object',
            properties: {
              embeddingMs: { type: 'number', example: 45 },
              searchMs: { type: 'number', example: 22 },
            },
            required: ['embeddingMs', 'searchMs'],
          },
        },
      },
    },
  },
  tags: [
    { name: 'Health', description: 'System health, database connectivity, and readiness probes' },
    { name: 'Authentication', description: 'User registration, login, token refresh, and profile claims' },
    { name: 'Documents', description: 'Document upload, metadata retrieval, status tracking, retry, and deletion' },
    { name: 'RAG Retrieval', description: 'ACL-governed question answering with cited knowledge sources' },
    { name: 'Conversations & Chat', description: 'Multi-turn conversational threads, message persistence, and SSE streaming' },
    { name: 'Feedback', description: 'Answer quality feedback and telemetry ratings' },
    { name: 'Admin - Users', description: 'User management directory and granular permission assignment' },
    { name: 'Admin - Documents', description: 'Administrative document management and deletion operations' },
    { name: 'Admin - Analytics', description: 'Organizational usage analytics, top queries, and cited sources' },
    { name: 'Admin - Audit', description: 'Cryptographic tamper-evident audit logs and HMAC verification' },
  ],
  paths: {
    '/health/liveness': {
      get: {
        tags: ['Health'],
        summary: 'Application liveness probe',
        description: 'Verifies that the API server process is alive and responsive. Also accessible at /api/v1/health/liveness.',
        responses: {
          200: {
            description: 'Application is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'UP' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health/readiness': {
      get: {
        tags: ['Health'],
        summary: 'Application and database readiness probe',
        description: 'Verifies MongoDB connection state for routing traffic. Also accessible at /api/v1/health/readiness.',
        responses: {
          200: {
            description: 'Application and database are ready',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'READY' },
                    database: { type: 'string', example: 'connected' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          503: {
            description: 'Database disconnected or server not ready',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'NOT_READY' },
                    database: { type: 'string', example: 'disconnected' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a new employee user account',
        description: 'Creates a standard employee user with default role USER and clearance level INTERNAL.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name', 'department'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'alice@enterprise.com' },
                  password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
                  name: { type: 'string', example: 'Alice Engineer' },
                  department: { type: 'string', example: 'Engineering' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User registered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/UserClaims' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation failed or email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardError' } } } },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate user and issue JWT token pair',
        description: 'Validates credentials with bcrypt and returns an access token, refresh token, and user claims.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'alice@enterprise.com' },
                  password: { type: 'string', example: 'SecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authentication successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1Ni...' },
                    refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1Ni...' },
                    user: { $ref: '#/components/schemas/UserClaims' },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid email or password', content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardError' } } } },
          429: { description: 'Account locked due to consecutive failed attempts', content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardError' } } } },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Rotate refresh token and issue new access token',
        description: 'Accepts refresh token via request body or HttpOnly cookie, validates session state, and performs atomic token rotation.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Tokens rotated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    accessToken: { type: 'string' },
                    refreshToken: { type: 'string' },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid or revoked refresh token' },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        summary: 'Get current authenticated user profile and active permissions',
        responses: {
          200: {
            description: 'Profile returned successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/UserClaims' },
                  },
                },
              },
            },
          },
          401: { description: 'Authentication required' },
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        summary: 'Revoke active session and refresh token',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Logged out successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Logged out successfully' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/documents/upload': {
      post: {
        tags: ['Documents'],
        security: [{ bearerAuth: [] }],
        summary: 'Upload and enqueue document for background ingestion',
        description: 'Requires DOCUMENTS_UPLOAD permission or ADMIN role. Non-admin uploads are automatically department-bound and clearance-constrained. Duplicate file content is rejected with 409 Conflict.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'PDF, DOCX, or TXT file (up to 50 MB)' },
                  title: { type: 'string', description: 'Optional custom document title' },
                  minimumClearance: {
                    type: 'string',
                    enum: ['public', 'internal', 'confidential', 'restricted'],
                    description: 'Required clearance level (cannot exceed uploader clearance rank)',
                  },
                  allowedDepartments: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Allowed departments (non-admins default to uploader department)',
                  },
                  allowedRoles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Allowed roles',
                  },
                  allowedUserIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional user IDs permitted to access document',
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Document uploaded and queued for processing',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Document uploaded and queued for processing' },
                    data: {
                      type: 'object',
                      properties: {
                        document: { $ref: '#/components/schemas/DocumentEntity' },
                        jobId: { type: 'string', example: 'doc_671350a12f3e8b0012345699_1730000000' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid file format or validation error' },
          403: { description: 'Insufficient permission or clearance escalation attempt' },
          409: { description: 'Duplicate document hash already exists in repository' },
        },
      },
    },
    '/api/v1/documents': {
      get: {
        tags: ['Documents'],
        security: [{ bearerAuth: [] }],
        summary: 'List visible documents with pagination and filters',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'processing', 'ready', 'failed'] } },
          { name: 'department', in: 'query', schema: { type: 'string' }, description: 'Filter documents by department' },
        ],
        responses: {
          200: {
            description: 'Paginated document repository list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        documents: { type: 'array', items: { $ref: '#/components/schemas/DocumentEntity' } },
                        total: { type: 'integer', example: 45 },
                        page: { type: 'integer', example: 1 },
                        limit: { type: 'integer', example: 20 },
                        totalPages: { type: 'integer', example: 3 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/documents/{id}': {
      get: {
        tags: ['Documents'],
        security: [{ bearerAuth: [] }],
        summary: 'Get document details and processing status by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Document found',
            content: { 'application/json': { schema: { type: 'object', properties: { document: { $ref: '#/components/schemas/DocumentEntity' } } } } },
          },
          404: { description: 'Document not found' },
        },
      },
      delete: {
        tags: ['Documents'],
        security: [{ bearerAuth: [] }],
        summary: 'Delete a document, its chunks, and vector points',
        description: 'Allowed for document owner, Admin, or Super Admin.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Document deleted successfully',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
          },
          403: { description: 'Not authorized to delete this document' },
          404: { description: 'Document not found' },
        },
      },
    },
    '/api/v1/documents/{id}/retry': {
      post: {
        tags: ['Documents'],
        security: [{ bearerAuth: [] }],
        summary: 'Retry processing for a failed document',
        description: 'Allowed for document owner, Admin, or Super Admin with retry permission.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Document re-enqueued for ingestion',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    jobId: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Document is not in failed state' },
        },
      },
    },
    '/api/v1/rag/query': {
      post: {
        tags: ['RAG Retrieval'],
        security: [{ bearerAuth: [] }],
        summary: 'Synchronous grounded RAG query',
        description: 'Executes pre-retrieval Qdrant ACL vector search, active revision verification, and returns grounded answer with source citations.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', minLength: 1, maxLength: 1000, example: 'What is our corporate travel reimbursement policy?' },
                  topK: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
                  similarityThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.65 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Grounded RAG answer and citations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        answer: { type: 'string', example: 'The daily cap for domestic corporate travel reimbursement is $150 per day [S1].' },
                        citations: { type: 'array', items: { $ref: '#/components/schemas/Citation' } },
                        insufficientEvidence: { type: 'boolean', example: false },
                        retrievalMetadata: {
                          type: 'object',
                          properties: {
                            totalCandidates: { type: 'integer', example: 4 },
                            authorizedChunks: { type: 'integer', example: 4 },
                            timingsMs: {
                              type: 'object',
                              properties: {
                                embedding: { type: 'number', example: 120 },
                                retrieval: { type: 'number', example: 35 },
                                generation: { type: 'number', example: 850 },
                                total: { type: 'number', example: 1005 },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid query string' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/v1/chat': {
      post: {
        tags: ['Conversations & Chat', 'RAG Retrieval'],
        security: [{ bearerAuth: [] }],
        summary: 'Single-turn chat compatibility alias (stateless RAG query)',
        description: 'Backward-compatible single-turn chat alias for /api/v1/rag/query. Executes authenticated ACL vector retrieval, active revision validation, and grounded answer synthesis with source citations. Does NOT create persistent conversations or messages in MongoDB.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', minLength: 1, maxLength: 1000, example: 'What is our corporate travel reimbursement policy?' },
                  topK: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
                  similarityThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.65 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Grounded RAG answer and verified source citations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        answer: { type: 'string', example: 'The daily cap for domestic corporate travel reimbursement is $150 per day [S1].' },
                        citations: { type: 'array', items: { $ref: '#/components/schemas/Citation' } },
                        insufficientEvidence: { type: 'boolean', example: false },
                        retrievalMetadata: {
                          type: 'object',
                          properties: {
                            totalCandidates: { type: 'integer', example: 4 },
                            authorizedChunks: { type: 'integer', example: 4 },
                            timingsMs: {
                              type: 'object',
                              properties: {
                                embedding: { type: 'number', example: 120 },
                                retrieval: { type: 'number', example: 35 },
                                generation: { type: 'number', example: 850 },
                                total: { type: 'number', example: 1005 },
                              },
                            },
                          },
                        },
                      },
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        timestamp: { type: 'string', format: 'date-time' },
                        requestId: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid query string or parameters' },
          401: { description: 'Authentication required' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/v1/search': {
      post: {
        tags: ['RAG Retrieval'],
        security: [{ bearerAuth: [] }],
        summary: 'Search-only retrieval alias returning ranked chunks without LLM synthesis',
        description: 'Backward-compatible search-only alias. Generates query embeddings, executes pre-retrieval Qdrant ACL vector search, validates active revisions and document status against MongoDB, and returns authorized result snippets and ranking metadata directly. Does NOT invoke any LLM provider or answer generation.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', minLength: 1, maxLength: 1000, example: 'deployment freeze windows' },
                  topK: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
                  similarityThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.65 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Ranked authorized search snippets without LLM synthesis',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/SearchResponseData' },
                    meta: {
                      type: 'object',
                      properties: {
                        timestamp: { type: 'string', format: 'date-time' },
                        requestId: { type: 'string', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid search parameters' },
          401: { description: 'Authentication required' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/v1/conversations': {
      post: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'Create a new conversation thread',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', example: 'HR Policy Questions' },
                  selectedModelProvider: { type: 'string', enum: ['gemini', 'openai'], default: 'gemini' },
                  selectedModelName: { type: 'string', default: 'gemini-1.5-pro' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Conversation created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    conversation: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        createdAt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      get: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'List user conversations',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'List of conversations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    conversations: { type: 'array', items: { type: 'object' } },
                    total: { type: 'integer' },
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    totalPages: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/conversations/{conversationId}': {
      get: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'Get conversation details by ID',
        parameters: [{ name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Conversation found' },
          404: { description: 'Conversation not found or unauthorized' },
        },
      },
      delete: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'Soft-delete a conversation',
        parameters: [{ name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Conversation deleted successfully' },
          404: { description: 'Conversation not found' },
        },
      },
    },
    '/api/v1/conversations/{conversationId}/messages': {
      get: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'Get messages for a conversation',
        parameters: [
          { name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: {
            description: 'Messages list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    messages: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'Send synchronous message in conversation thread',
        description: 'Sends a user message, retrieves authorized RAG context, and returns assistant reply with citations.',
        parameters: [{ name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', minLength: 1, maxLength: 2000, example: 'Who is eligible for work-from-home?' },
                  idempotencyKey: { type: 'string', description: 'Client idempotency key to prevent double submission' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Message processed and assistant reply generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userMessage: { type: 'object' },
                    assistantMessage: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/conversations/{conversationId}/messages/stream': {
      post: {
        tags: ['Conversations & Chat'],
        security: [{ bearerAuth: [] }],
        summary: 'Send message with real-time Server-Sent Events (SSE) streaming',
        description: 'Streams response tokens progressively. Returns Content-Type: text/event-stream with event types: conversation.created, message.progress, citations, message.completed, message.error.',
        parameters: [{ name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', minLength: 1, maxLength: 2000 },
                  idempotencyKey: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Server-Sent Events event stream',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  example: 'event: message.progress\ndata: {"delta":"Employees "}\n\nevent: message.completed\ndata: {"content":"..."}\n\n',
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/feedback': {
      post: {
        tags: ['Feedback'],
        security: [{ bearerAuth: [] }],
        summary: 'Submit or update feedback for an assistant response',
        description: 'Allows thumbs_up or thumbs_down rating with categorization. Upserts atomically on user and message.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['conversationId', 'messageId', 'rating'],
                properties: {
                  conversationId: { type: 'string' },
                  messageId: { type: 'string' },
                  rating: { type: 'string', enum: ['thumbs_up', 'thumbs_down'] },
                  category: {
                    type: 'string',
                    enum: ['accurate_helpful', 'hallucination', 'irrelevant_context', 'missing_information', 'outdated', 'other'],
                  },
                  userComment: { type: 'string', maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Feedback recorded',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } } } },
          },
        },
      },
    },
    '/api/v1/feedback/message/{messageId}': {
      get: {
        tags: ['Feedback'],
        security: [{ bearerAuth: [] }],
        summary: 'Get existing feedback submitted by user for a message',
        parameters: [{ name: 'messageId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Feedback details returned or null if none submitted' },
        },
      },
    },
    '/api/v1/admin/users': {
      get: {
        tags: ['Admin - Users'],
        security: [{ bearerAuth: [] }],
        summary: 'List user directory with pagination, search, and effective permissions',
        description: 'Requires ADMIN or SUPER_ADMIN role.',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'User management list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    users: { type: 'array', items: { $ref: '#/components/schemas/UserClaims' } },
                    pagination: { $ref: '#/components/schemas/PaginationMeta' },
                    availablePermissions: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          403: { description: 'Admin role required' },
        },
      },
    },
    '/api/v1/admin/users/{id}': {
      get: {
        tags: ['Admin - Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Get user details by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'User found' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/v1/admin/users/{id}/permissions': {
      patch: {
        tags: ['Admin - Users'],
        security: [{ bearerAuth: [] }],
        summary: 'Update granular user permissions',
        description: 'Allows Admin/Super Admin to grant or revoke specific permissions. Self-modification is forbidden. Granting sensitive permissions like ADMIN_AUDIT requires SUPER_ADMIN.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['permissions'],
                properties: {
                  permissions: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: [
                        'documents:upload',
                        'documents:delete',
                        'documents:retry',
                        'documents:manage_access',
                        'admin:analytics',
                        'admin:audit',
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Permissions updated successfully' },
          400: { description: 'Invalid permission claim requested' },
          403: { description: 'Self-modification forbidden or privilege escalation blocked' },
        },
      },
    },
    '/api/v1/admin/documents/{id}': {
      delete: {
        tags: ['Admin - Documents'],
        security: [{ bearerAuth: [] }],
        summary: 'Admin delete document, chunks, storage file, and vector embeddings',
        description: 'Requires ADMIN or SUPER_ADMIN role. Safely deletes MongoDB document, chunk records, storage files, and Qdrant vectors.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Document and associated vectors deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Document and associated vectors deleted successfully' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid document ID format' },
          401: { description: 'Authentication token is required' },
          403: { description: 'Insufficient permissions (requires Admin or Super Admin)' },
          404: { description: 'Document not found' },
        },
      },
    },
    '/api/v1/admin/analytics/overview': {
      get: {
        tags: ['Admin - Analytics'],
        security: [{ bearerAuth: [] }],
        summary: 'Get aggregated system telemetry and KPI metrics',
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          200: {
            description: 'Overview metrics containing user, document, query, latency, and feedback telemetry',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userMetrics: { type: 'object' },
                    documentMetrics: { type: 'object' },
                    queryMetrics: { type: 'object' },
                    feedbackMetrics: { type: 'object' },
                    topSources: { type: 'array', items: { type: 'object' } },
                    topQuestions: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/admin/analytics/trends': {
      get: {
        tags: ['Admin - Analytics'],
        security: [{ bearerAuth: [] }],
        summary: 'Get daily time-series trends for queries, latency, and conversations',
        responses: {
          200: {
            description: 'Daily trend time-series',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
          },
        },
      },
    },
    '/api/v1/admin/analytics/ingestion': {
      get: {
        tags: ['Admin - Analytics'],
        security: [{ bearerAuth: [] }],
        summary: 'Get ingestion success and failure rates with recent error logs',
        responses: {
          200: { description: 'Ingestion pipeline operational statistics' },
        },
      },
    },
    '/api/v1/admin/audit/logs': {
      get: {
        tags: ['Admin - Audit'],
        security: [{ bearerAuth: [] }],
        summary: 'List paginated audit trail entries',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['success', 'denied', 'error'] } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Paginated audit trail log entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    logs: { type: 'array', items: { type: 'object' } },
                    total: { type: 'integer' },
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    totalPages: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/admin/audit/summary': {
      get: {
        tags: ['Admin - Audit'],
        security: [{ bearerAuth: [] }],
        summary: 'Get aggregate audit log counters',
        description: 'Returns total, success, denied, error, and security-critical event counts.',
        responses: {
          200: {
            description: 'Audit summary metrics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer', example: 160 },
                    success: { type: 'integer', example: 140 },
                    denied: { type: 'integer', example: 18 },
                    error: { type: 'integer', example: 2 },
                    failedTotal: { type: 'integer', example: 20 },
                    securityCritical: { type: 'integer', example: 25 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/admin/audit/verify': {
      get: {
        tags: ['Admin - Audit'],
        security: [{ bearerAuth: [] }],
        summary: 'Cryptographically verify the SHA-256 HMAC audit log hash chain',
        description: 'Recalculates canonical HMAC signatures from the genesis record through all sequence numbers. Flags any broken hash linkages, signature mismatches, or sequence gaps.',
        responses: {
          200: {
            description: 'Cryptographic verification report',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['PASS', 'FAIL'], example: 'PASS' },
                    isValid: { type: 'boolean', example: true },
                    totalVerified: { type: 'integer', example: 163 },
                    invalidSignatureCount: { type: 'integer', example: 0 },
                    brokenPreviousHashCount: { type: 'integer', example: 0 },
                    sequenceGapCount: { type: 'integer', example: 0 },
                    firstInvalidSequence: { type: 'integer', nullable: true, example: null },
                    verifiedAt: { type: 'string', format: 'date-time' },
                    processIsolationNotice: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/admin/audit/export': {
      get: {
        tags: ['Admin - Audit'],
        security: [{ bearerAuth: [] }],
        summary: 'Export audit logs in CSV or JSON format',
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 1000 } },
        ],
        responses: {
          200: {
            description: 'Export file download (CSV or JSON)',
            content: {
              'text/csv': { schema: { type: 'string' } },
              'application/json': { schema: { type: 'array', items: { type: 'object' } } },
            },
          },
        },
      },
    },
  },
};

export function setupSwagger(router: Router): void {
  // Serve raw OpenAPI JSON specification
  router.get('/api/docs/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(openapiSpecification);
  });

  // Mount Swagger UI
  router.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiSpecification, {
      customSiteTitle: 'Enterprise AI Copilot — API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
      },
    })
  );
}
