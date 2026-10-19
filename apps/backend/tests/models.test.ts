import mongoose from 'mongoose';
import {
  UserModel,
  DocumentModel,
  DocumentChunkModel,
  ConversationModel,
  MessageModel,
  QueryLogModel,
  FeedbackModel,
  AuditLogModel,
  SessionModel,
} from '../src/models/index.js';
import {
  Role,
  ClearanceLevel,
  DocumentMimeType,
  DocumentStatus,
  MessageSender,
  LlmProvider,
  FeedbackRating,
  FeedbackCategory,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';

describe('MongoDB Mongoose Models (8 Collections Schema Validation)', () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const dummyDocId = new mongoose.Types.ObjectId();
  const dummyConvId = new mongoose.Types.ObjectId();
  const dummyMsgId = new mongoose.Types.ObjectId();

  it('1. UserModel should enforce required fields and defaults', async () => {
    const user = new UserModel({
      email: 'test.model@enterprise.com',
      passwordHash: 'hashed_pw_test',
      name: 'Test Model User',
      department: 'Finance',
    });

    await user.validate();
    expect(user.role).toBe(Role.USER);
    expect(user.securityClearance).toBe(ClearanceLevel.INTERNAL);
    expect(user.isActive).toBe(true);
    expect(user.tokenVersion).toBe(0);
  });

  it('2. DocumentModel should validate status and access control structure', async () => {
    const doc = new DocumentModel({
      title: 'Q3 Financial Audit.pdf',
      originalFilename: 'Q3_Audit.pdf',
      mimeType: DocumentMimeType.PDF,
      fileSizeBytes: 1048576,
      storagePath: '/uploads/docs/q3_audit.pdf',
      fileHash: 'sha256_mock_hash_12345',
      uploadedBy: dummyUserId,
    });

    await doc.validate();
    expect(doc.status).toBe(DocumentStatus.PENDING);
    expect(doc.currentRevision).toBe(1);
    expect(doc.accessControl.minimumClearance).toBe(ClearanceLevel.INTERNAL);
  });

  it('3. DocumentChunkModel should validate chunkIndex, revision, and vectorId requirements', async () => {
    const chunk = new DocumentChunkModel({
      documentId: dummyDocId,
      chunkIndex: 0,
      content: 'This is the first paragraph of executive summary.',
      tokenCount: 45,
      vectorId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      metadata: { title: 'Executive Summary', pageNumber: 1 },
    });

    await chunk.validate();
    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.revision).toBe(1);
    expect(chunk.vectorId).toBe('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  });

  it('4. ConversationModel should require userId and set active status', async () => {
    const conv = new ConversationModel({
      userId: dummyUserId,
      title: 'Customer Inquiry Discussion',
    });

    await conv.validate();
    expect(conv.status).toBe('active');
    expect(conv.selectedModelProvider).toBe(LlmProvider.GEMINI);
  });

  it('5. MessageModel should store citations and token usage telemetry', async () => {
    const msg = new MessageModel({
      conversationId: dummyConvId,
      sender: MessageSender.ASSISTANT,
      content: 'According to page 4 of the financial report, net margin was 18%.',
      citations: [
        {
          chunkId: new mongoose.Types.ObjectId(),
          documentId: dummyDocId,
          title: 'Financial Report',
          pageNumber: 4,
          snippet: 'Net profit margin was 18% in Q3.',
          relevanceScore: 0.94,
        },
      ],
      tokensUsed: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
      latencyMs: 850,
      modelProvider: LlmProvider.GEMINI,
    });

    await msg.validate();
    expect(msg.citations.length).toBe(1);
    expect(msg.tokensUsed?.totalTokens).toBe(160);
  });

  it('6. QueryLogModel should record query and latency timings', async () => {
    const queryLog = new QueryLogModel({
      userId: dummyUserId,
      conversationId: dummyConvId,
      rawQuery: 'What was the Q3 net margin?',
      timings: { embeddingMs: 45, vectorSearchMs: 12, llmFirstTokenMs: 250, totalDurationMs: 950 },
      status: 'success',
    });

    await queryLog.validate();
    expect(queryLog.cacheHit).toBe(false);
    expect(queryLog.status).toBe('success');
  });

  it('7. FeedbackModel should enforce rating and category enums', async () => {
    const feedback = new FeedbackModel({
      userId: dummyUserId,
      conversationId: dummyConvId,
      messageId: dummyMsgId,
      rating: FeedbackRating.THUMBS_UP,
      category: FeedbackCategory.ACCURATE_HELPFUL,
      userComment: 'Very accurate citation!',
    });

    await feedback.validate();
    expect(feedback.reviewedByAdmin).toBe(false);
  });

  it('8. AuditLogModel should require tamperHash, sequenceNumber, and previousHash', async () => {
    const audit = new AuditLogModel({
      sequenceNumber: 1,
      previousHash: 'GENESIS_HASH_INITIAL_LOG',
      userId: dummyUserId,
      action: AuditAction.DOC_UPLOAD,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: dummyDocId.toString(),
      status: 'success',
      tamperHash: 'mock_tamper_evident_sha256_hash_value',
    });

    await audit.validate();
    expect(audit.sequenceNumber).toBe(1);
    expect(audit.previousHash).toBe('GENESIS_HASH_INITIAL_LOG');
    expect(audit.status).toBe('success');
    expect(audit.tamperHash).toBeDefined();
  });

  it('9. SessionModel should enforce sessionId, userId, refreshTokenHash, and TTL expiresAt', async () => {
    const session = new SessionModel({
      sessionId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      userId: dummyUserId,
      refreshTokenHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await session.validate();
    expect(session.isRevoked).toBe(false);
    expect(session.tokenVersion).toBe(0);
  });
});
