import { openapiSpecification } from '../src/docs/swagger.js';

describe('OpenAPI 3.0 Specification & Swagger Documentation Tests', () => {
  it('1. Conforms to OpenAPI 3.0.3 specification structure', () => {
    expect(openapiSpecification.openapi).toBe('3.0.3');
    expect(openapiSpecification.info).toBeDefined();
    expect((openapiSpecification.info as any).title).toContain('Enterprise AI');
    expect((openapiSpecification.info as any).version).toBe('1.0.0');
    expect(Array.isArray(openapiSpecification.servers)).toBe(true);
  });

  it('2. Defines bearerAuth security scheme for JWT authentication', () => {
    const components = (openapiSpecification.components as any) || {};
    expect(components.securitySchemes?.bearerAuth).toBeDefined();
    expect(components.securitySchemes.bearerAuth.type).toBe('http');
    expect(components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(components.securitySchemes.bearerAuth.bearerFormat).toBe('JWT');
  });

  it('3. Documents all required endpoint categories and functional paths', () => {
    const paths = (openapiSpecification.paths as any) || {};
    const documentedPaths = Object.keys(paths);

    // Health (actual mounted probes)
    expect(documentedPaths).toContain('/health/liveness');
    expect(documentedPaths).toContain('/health/readiness');
    expect(documentedPaths).not.toContain('/health');

    // Authentication
    expect(documentedPaths).toContain('/api/v1/auth/register');
    expect(documentedPaths).toContain('/api/v1/auth/login');
    expect(documentedPaths).toContain('/api/v1/auth/refresh');
    expect(documentedPaths).toContain('/api/v1/auth/logout');
    expect(documentedPaths).toContain('/api/v1/auth/me');

    // Documents
    expect(documentedPaths).toContain('/api/v1/documents/upload');
    expect(documentedPaths).toContain('/api/v1/documents');
    expect(documentedPaths).toContain('/api/v1/documents/{id}');
    expect(documentedPaths).toContain('/api/v1/documents/{id}/retry');

    // RAG & Conversations & Compatibility Aliases
    expect(documentedPaths).toContain('/api/v1/rag/query');
    expect(documentedPaths).toContain('/api/v1/chat');
    expect(documentedPaths).toContain('/api/v1/search');
    expect(documentedPaths).toContain('/api/v1/conversations');
    expect(documentedPaths).toContain('/api/v1/conversations/{conversationId}');
    expect(documentedPaths).toContain('/api/v1/conversations/{conversationId}/messages');
    expect(documentedPaths).toContain('/api/v1/conversations/{conversationId}/messages/stream');

    // Feedback
    expect(documentedPaths).toContain('/api/v1/feedback');
    expect(documentedPaths).toContain('/api/v1/feedback/message/{messageId}');

    // Admin APIs
    expect(documentedPaths).toContain('/api/v1/admin/documents/{id}');
    expect(documentedPaths).toContain('/api/v1/admin/users');
    expect(documentedPaths).toContain('/api/v1/admin/users/{id}');
    expect(documentedPaths).toContain('/api/v1/admin/users/{id}/permissions');
    expect(documentedPaths).toContain('/api/v1/admin/analytics/overview');
    expect(documentedPaths).toContain('/api/v1/admin/analytics/trends');
    expect(documentedPaths).toContain('/api/v1/admin/analytics/ingestion');
    expect(documentedPaths).toContain('/api/v1/admin/audit/logs');
    expect(documentedPaths).toContain('/api/v1/admin/audit/summary');
    expect(documentedPaths).toContain('/api/v1/admin/audit/verify');
    expect(documentedPaths).toContain('/api/v1/admin/audit/export');
  });

  it('4. Correctly describes Server-Sent Events content type for streaming', () => {
    const streamEndpoint = (openapiSpecification.paths as any)['/api/v1/conversations/{conversationId}/messages/stream'];
    expect(streamEndpoint?.post?.responses['200']?.content['text/event-stream']).toBeDefined();
  });

  it('5. Correctly describes CSV and JSON exports for audit logs', () => {
    const exportEndpoint = (openapiSpecification.paths as any)['/api/v1/admin/audit/export'];
    expect(exportEndpoint?.get?.responses['200']?.content['text/csv']).toBeDefined();
    expect(exportEndpoint?.get?.responses['200']?.content['application/json']).toBeDefined();
  });

  it('6. Correctly describes document upload 202 status code and request fields', () => {
    const uploadEndpoint = (openapiSpecification.paths as any)['/api/v1/documents/upload'];
    expect(uploadEndpoint?.post?.responses['202']).toBeDefined();
    expect(uploadEndpoint?.post?.responses['201']).toBeUndefined();
    const reqProps = uploadEndpoint?.post?.requestBody?.content['multipart/form-data']?.schema?.properties;
    expect(reqProps?.title).toBeDefined();
    expect(reqProps?.customTitle).toBeUndefined();
    expect(reqProps?.allowedUserIds).toBeDefined();
  });

  it('7. Correctly describes document list department filter and data envelope', () => {
    const listEndpoint = (openapiSpecification.paths as any)['/api/v1/documents'];
    const params = listEndpoint?.get?.parameters || [];
    const paramNames = params.map((p: any) => p.name);
    expect(paramNames).toContain('department');
    expect(paramNames).not.toContain('search');
    const respSchema = listEndpoint?.get?.responses['200']?.content['application/json']?.schema;
    expect(respSchema?.properties?.data?.properties?.documents).toBeDefined();
    expect(respSchema?.properties?.data?.properties?.total).toBeDefined();
    expect(respSchema?.properties?.data?.properties?.totalPages).toBeDefined();
  });
});
