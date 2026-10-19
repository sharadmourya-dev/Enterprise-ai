export enum AuditAction {
  AUTH_LOGIN = 'auth.login',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_FAILED_LOGIN = 'auth.failed_login',
  AUTH_TOKEN_REFRESH = 'auth.token_refresh',
  AUTH_TOKEN_REVOKED = 'auth.token_revoked',
  DOC_UPLOAD = 'document.upload',
  DOC_DELETE = 'document.delete',
  DOC_REINDEX = 'document.reindex',
  DOC_ACL_UPDATE = 'document.acl_update',
  RAG_QUERY = 'rag.query',
  CHAT_QUERY = 'chat.query',
  ADMIN_ROLE_CHANGE = 'admin.user_role_change',
  ADMIN_CLEARANCE_CHANGE = 'admin.user_clearance_change',
  ADMIN_EXPORT_LOGS = 'admin.export_logs',
  ADMIN_PURGE = 'admin.purge',
}

export enum AuditResourceType {
  USER = 'user',
  DOCUMENT = 'document',
  CHUNK = 'chunk',
  CONVERSATION = 'conversation',
  SYSTEM = 'system',
}

export interface IAuditLog {
  id: string;
  sequenceNumber: number;
  previousHash: string;
  userId?: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  ipAddress: string;
  userAgent: string;
  status: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
  tamperHash: string; // SHA-256 HMAC chained to previous record
  createdAt: string;
}
