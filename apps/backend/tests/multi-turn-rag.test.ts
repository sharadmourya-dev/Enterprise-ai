import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ConversationService } from '../src/services/conversation/conversation.service.js';
import { PromptBuilder } from '../src/services/rag/prompt-builder.js';
import { RetrievalService } from '../src/services/retrieval.service.js';
import { LlmFactory } from '../src/services/llm/llm.factory.js';
import { MockLlmProvider } from '../src/services/llm/mock.llm.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { MessageModel } from '../src/models/Message.model.js';
import { RedisService } from '../src/services/redis.service.js';
import { createMockRedis } from './helpers/mock-redis.js';
import { env } from '../src/config/env.js';
import {
  IJwtPayload,
  Role,
  ClearanceLevel,
  MessageSender,
  IRetrievalCandidate,
} from '@enterprise-ai/shared-types';

describe('Phase 5 — Multi-Turn RAG Context & Dynamic Authorization Reevaluation (Part C & I2)', () => {
  const mockRedis = createMockRedis();
  let mockLlm: MockLlmProvider;

  beforeAll(() => {
    RedisService.setClientOverride(mockRedis as any);
    mockLlm = new MockLlmProvider();
    LlmFactory.setProvider(mockLlm);
  });

  afterAll(() => {
    RedisService.setClientOverride(null);
    LlmFactory.setProvider(null);
  });

  beforeEach(async () => {
    mockRedis.clear();
    await ConversationModel.deleteMany({});
    await MessageModel.deleteMany({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createTestUser(clearance: ClearanceLevel, department = 'Engineering'): IJwtPayload {
    const id = new mongoose.Types.ObjectId().toString();
    return {
      sub: id,
      email: `user_${id}@enterprise.com`,
      role: Role.USER,
      department,
      securityClearance: clearance,
      sessionId: `sess_${id}`,
    };
  }

  describe('C2 & I2. Multi-turn Prompt Construction & Segregation', () => {
    it('1. Segregates historical dialogue from verified evidence in prompt', () => {
      const history = [
        { sender: 'user', content: 'What is our travel policy?' },
        { sender: 'assistant', content: 'You can book standard flights via Concur [S1].' },
      ];
      const evidence = '<<<EVIDENCE>>>\n[S1] Hotel reimbursement is capped at $200/night.\n<<<END EVIDENCE>>>';

      const prompt = PromptBuilder.buildMultiTurnUserPrompt(
        'What about hotel expenses?',
        evidence,
        history
      );

      // Verify clear boundary separation
      expect(prompt).toContain('--- BEGIN PRIOR CONVERSATION HISTORY (UNTRUSTED DIALOGUE) ---');
      expect(prompt).toContain('[History Turn 1 - USER]: What is our travel policy?');
      expect(prompt).toContain('[History Turn 2 - ASSISTANT]: You can book standard flights via Concur [S1].');
      expect(prompt).toContain('--- END PRIOR CONVERSATION HISTORY ---');
      expect(prompt).toContain('--- BEGIN VERIFIED EVIDENCE CONTEXT (UNTRUSTED DATA) ---');
      expect(prompt).toContain('CURRENT USER QUESTION: What about hotel expenses?');
      expect(prompt).toContain('OPERATIONAL DIRECTIVE: Use prior conversation history ONLY to understand references');
    });

    it('2. Bounded history limits turns to CONVERSATION_HISTORY_LIMIT and preserves chronological order', async () => {
      const user = createTestUser(ClearanceLevel.INTERNAL);
      const conversation = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(user.sub),
        title: 'Multi-turn History Limit Test',
        status: 'active',
      });

      // Seed 15 historical messages (more than CONVERSATION_HISTORY_LIMIT = 10)
      for (let i = 1; i <= 15; i++) {
        await MessageModel.create({
          conversationId: conversation._id,
          sender: i % 2 === 1 ? MessageSender.USER : MessageSender.ASSISTANT,
          content: `Historical message turn ${i}`,
          status: 'completed',
          createdAt: new Date(Date.now() - (20 - i) * 1000), // Chronological timestamps
        });
      }

      // Mock retrieval to return dummy candidate so prompt is built
      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [
          {
            chunkId: new mongoose.Types.ObjectId().toString(),
            documentId: new mongoose.Types.ObjectId().toString(),
            documentTitle: 'Policy Doc',
            content: 'Policy details here.',
            pageNumber: 1,
            relevanceScore: 0.95,
          } as IRetrievalCandidate,
        ],
        timings: { embeddingMs: 10, searchMs: 15, totalMs: 25 },
      });

      const spyPrompt = jest.spyOn(PromptBuilder, 'buildMultiTurnUserPrompt');

      await ConversationService.sendMessage(
        conversation._id.toString(),
        user,
        'Turn 16 question'
      );

      expect(spyPrompt).toHaveBeenCalledTimes(1);
      const passedHistory = spyPrompt.mock.calls[0][2];

      // Must be bounded to CONVERSATION_HISTORY_LIMIT (10)
      expect(passedHistory.length).toBeLessThanOrEqual(env.CONVERSATION_HISTORY_LIMIT);
      expect(passedHistory.length).toBe(10);

      // Verify chronological order: first item should be turn 6, last item should be turn 15
      expect(passedHistory[0].content).toBe('Historical message turn 6');
      expect(passedHistory[passedHistory.length - 1].content).toBe('Historical message turn 15');

      spyPrompt.mockRestore();
    });

    it('3. Excludes failed, incomplete, or cancelled assistant responses from history', async () => {
      const user = createTestUser(ClearanceLevel.INTERNAL);
      const conversation = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(user.sub),
        title: 'Status Filtering Test',
        status: 'active',
      });

      // Seed valid user message
      await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.USER,
        content: 'Valid user query',
        status: 'completed',
        createdAt: new Date(Date.now() - 5000),
      });

      // Seed failed assistant message
      await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.ASSISTANT,
        content: 'Partial hallucinated content that failed validation',
        status: 'failed',
        createdAt: new Date(Date.now() - 4000),
      });

      // Seed cancelled assistant message
      await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.ASSISTANT,
        content: 'Incomplete content cancelled by client disconnect',
        status: 'cancelled',
        createdAt: new Date(Date.now() - 3000),
      });

      const spyPrompt = jest.spyOn(PromptBuilder, 'buildMultiTurnUserPrompt');

      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [
          {
            chunkId: new mongoose.Types.ObjectId().toString(),
            documentId: new mongoose.Types.ObjectId().toString(),
            documentTitle: 'Guide',
            content: 'Instruction guide content.',
            pageNumber: 1,
            relevanceScore: 0.9,
          } as IRetrievalCandidate,
        ],
        timings: { embeddingMs: 10, searchMs: 15, totalMs: 25 },
      });

      await ConversationService.sendMessage(
        conversation._id.toString(),
        user,
        'Next turn'
      );

      expect(spyPrompt).toHaveBeenCalledTimes(1);
      const passedHistory = spyPrompt.mock.calls[0][2];

      // Only the completed message should be present
      expect(passedHistory).toHaveLength(1);
      expect(passedHistory[0].content).toBe('Valid user query');

      spyPrompt.mockRestore();
    });
  });

  describe('C3 & I2. Authorization Reevaluated on Every Turn', () => {
    it('4. Re-evaluates retrieval authorization on every turn with current credentials', async () => {
      const user = createTestUser(ClearanceLevel.INTERNAL, 'Engineering');
      const conversation = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(user.sub),
        title: 'Dynamic ACL Reevaluation Test',
        status: 'active',
      });

      const searchSpy = jest.spyOn(RetrievalService, 'search').mockResolvedValue({
        candidates: [],
        timings: { embeddingMs: 5, searchMs: 10, totalMs: 15 },
      });

      await ConversationService.sendMessage(
        conversation._id.toString(),
        user,
        'Question requiring security clearance'
      );

      // Search MUST be called with current user principal (user.sub, department, securityClearance)
      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(searchSpy).toHaveBeenCalledWith(
        'Question requiring security clearance',
        expect.objectContaining({
          sub: user.sub,
          department: 'Engineering',
          securityClearance: ClearanceLevel.INTERNAL,
        }),
        expect.any(Object)
      );

      searchSpy.mockRestore();
    });

    it('5. Returns canonical insufficient evidence response when new turn has empty authorized evidence', async () => {
      const user = createTestUser(ClearanceLevel.INTERNAL);
      const conversation = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(user.sub),
        title: 'Revoked Access Test',
        status: 'active',
      });

      // Retrieval returns 0 candidates (e.g. document access was revoked or document revision updated)
      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [],
        timings: { embeddingMs: 5, searchMs: 10, totalMs: 15 },
      });

      const result = await ConversationService.sendMessage(
        conversation._id.toString(),
        user,
        'Summarize the restricted confidential policy'
      );

      expect(result.assistantMessage.content).toBe(
        'I do not have sufficient information in the provided documentation to answer this question.'
      );
      expect(result.assistantMessage.citations).toEqual([]);
    });

    it('6. Historical citations cannot authorize retrieval and historical answers cannot bypass ACLs', async () => {
      const user = createTestUser(ClearanceLevel.INTERNAL);
      const conversation = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(user.sub),
        title: 'Historical Citations Security Test',
        status: 'active',
      });

      // Seed a historical turn that cited [S1] from a previously authorized document
      await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.USER,
        content: 'Tell me about project Apollo',
        status: 'completed',
      });
      await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.ASSISTANT,
        content: 'Project Apollo launch is scheduled for Q3 [S1].',
        citations: [
          {
            chunkId: new mongoose.Types.ObjectId().toString(),
            documentId: new mongoose.Types.ObjectId().toString(),
            title: 'Project Apollo Confidential',
            snippet: 'Project Apollo launch is scheduled for Q3',
            relevanceScore: 0.98,
          },
        ],
        status: 'completed',
      });

      // Turn 2: Access to Project Apollo was revoked -> Retrieval returns empty
      jest.spyOn(RetrievalService, 'search').mockResolvedValueOnce({
        candidates: [],
        timings: { embeddingMs: 5, searchMs: 10, totalMs: 15 },
      });

      const result = await ConversationService.sendMessage(
        conversation._id.toString(),
        user,
        'What was the launch date mentioned earlier?'
      );

      // Must NOT reuse previous citations or bypass current ACL
      expect(result.assistantMessage.content).toBe(
        'I do not have sufficient information in the provided documentation to answer this question.'
      );
      expect(result.assistantMessage.citations).toHaveLength(0);
    });
  });
});
