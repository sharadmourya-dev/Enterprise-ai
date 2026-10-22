import mongoose from 'mongoose';
import {
  IJwtPayload,
  MessageSender,
  LlmProvider,
  ICreateConversationRequest,
  IConversationListQuery,
  IConversationListResponse,
  IConversation,
  IMessage,
  AuditAction,
  AuditResourceType,
  DocumentStatus,
} from '@enterprise-ai/shared-types';
import { ConversationModel, IConversationEntity } from '../../models/Conversation.model.js';
import { MessageModel } from '../../models/Message.model.js';
import { DocumentModel } from '../../models/Document.model.js';
import { RetrievalService } from '../retrieval.service.js';
import { ContextAssembler } from '../rag/context-assembler.js';
import { CitationValidator } from '../rag/citation-validator.js';
import { PromptBuilder } from '../rag/prompt-builder.js';
import { LlmFactory } from '../llm/llm.factory.js';
import { AuditService } from '../audit.service.js';
import { RagCacheService } from '../cache/rag-cache.service.js';
import { env } from '../../config/env.js';
import { BadRequestError, NotFoundError, BadGatewayError, ConflictError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export interface ISendMessageResult {
  userMessage: IMessage;
  assistantMessage: IMessage;
}

export class ConversationService {
  private static readonly INSUFFICIENT_EVIDENCE_ANSWER =
    'I do not have sufficient information in the provided documentation to answer this question.';

  /**
   * Creates a new conversation owned exclusively by the authenticated user
   */
  public static async createConversation(
    user: IJwtPayload,
    reqData?: ICreateConversationRequest,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<IConversation> {
    const rawTitle = reqData?.title?.trim();
    const title = rawTitle && rawTitle.length > 0 ? rawTitle.slice(0, 150) : 'New Conversation';

    const provider = reqData?.selectedModelProvider || (env.LLM_PROVIDER as LlmProvider);
    const modelName =
      reqData?.selectedModelName ||
      (provider === LlmProvider.OPENAI ? env.OPENAI_MODEL : env.GEMINI_MODEL);

    const conversation = await ConversationModel.create({
      userId: new mongoose.Types.ObjectId(user.sub),
      title,
      status: 'active',
      selectedModelProvider: provider,
      selectedModelName: modelName,
      systemPromptOverride: reqData?.systemPromptOverride?.slice(0, 1000),
    });

    await AuditService.log({
      userId: user.sub,
      action: AuditAction.CHAT_QUERY,
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: conversation._id.toString(),
      ipAddress: clientMeta?.ip || '127.0.0.1',
      userAgent: clientMeta?.userAgent || 'internal',
      status: 'success',
      details: { operation: 'create', title, provider, modelName },
    });

    return this.formatConversation(conversation);
  }

  /**
   * Retrieves paginated conversations owned by the authenticated user
   */
  public static async getUserConversations(
    user: IJwtPayload,
    query?: IConversationListQuery
  ): Promise<IConversationListResponse> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: any = {
      userId: new mongoose.Types.ObjectId(user.sub),
      status: { $ne: 'deleted' },
    };

    if (query?.search?.trim()) {
      filter.title = { $regex: query.search.trim(), $options: 'i' };
    }

    const [conversations, total] = await Promise.all([
      ConversationModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      ConversationModel.countDocuments(filter),
    ]);

    return {
      conversations: conversations.map((c: any) => this.formatConversation(c)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieves conversation metadata with strict ownership enforcement
   */
  public static async getConversationById(
    conversationId: string,
    user: IJwtPayload
  ): Promise<IConversationEntity> {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestError('Invalid conversation ID format');
    }

    const conversation = await ConversationModel.findById(conversationId);

    // Enforce strict ownership & non-enumeration policy (return 404 for non-owners and deleted)
    if (!conversation || conversation.userId.toString() !== user.sub || conversation.status === 'deleted') {
      throw new NotFoundError('Conversation not found');
    }

    return conversation;
  }

  /**
   * Soft-deletes a conversation
   */
  public static async deleteConversation(
    conversationId: string,
    user: IJwtPayload,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<void> {
    const conversation = await this.getConversationById(conversationId, user);

    await ConversationModel.updateOne(
      { _id: conversation._id },
      { $set: { status: 'deleted' } }
    );

    await AuditService.log({
      userId: user.sub,
      action: AuditAction.CHAT_QUERY,
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: conversation._id.toString(),
      ipAddress: clientMeta?.ip || '127.0.0.1',
      userAgent: clientMeta?.userAgent || 'internal',
      status: 'success',
      details: { operation: 'delete', conversationId: conversation._id.toString() },
    });
  }

  /**
   * Retrieves paginated messages for an authorized conversation
   */
  public static async getMessages(
    conversationId: string,
    user: IJwtPayload,
    page: number = 1,
    limit: number = 50
  ): Promise<{ messages: IMessage[]; total: number; page: number; limit: number; totalPages: number }> {
    await this.getConversationById(conversationId, user);

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const filter = {
      conversationId: new mongoose.Types.ObjectId(conversationId),
      status: 'completed',
    };

    const [messages, total] = await Promise.all([
      MessageModel.find(filter).sort({ createdAt: 1 }).skip(skip).limit(safeLimit).lean(),
      MessageModel.countDocuments(filter),
    ]);

    return {
      messages: messages.map((m: any) => this.formatMessage(m)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Submits a user message and generates a grounded RAG multi-turn response
   */
  public static async sendMessage(
    conversationId: string,
    user: IJwtPayload,
    content: string,
    idempotencyKey?: string,
    clientMeta?: { ip?: string; userAgent?: string; requestId?: string }
  ): Promise<ISendMessageResult> {
    const startTime = Date.now();
    const conversation = await this.getConversationById(conversationId, user);

    const rawContent = (content || '').trim();
    if (!rawContent) {
      throw new BadRequestError('Message content cannot be empty');
    }

    if (rawContent.length > env.CONVERSATION_MESSAGE_MAX_CHARS) {
      throw new BadRequestError(
        `Message content exceeds maximum allowed limit of ${env.CONVERSATION_MESSAGE_MAX_CHARS} characters`
      );
    }

    // 1. Idempotency verification: Check if an idempotent message was already processed or is in-flight
    if (idempotencyKey) {
      const existingUserMessage = await MessageModel.findOne({
        conversationId: conversation._id,
        idempotencyKey,
        sender: MessageSender.USER,
      });

      if (existingUserMessage) {
        if (existingUserMessage.content !== rawContent) {
          throw new ConflictError(
            'Idempotency key has already been used with a different message payload'
          );
        }

        const existingAssistantMessage = await MessageModel.findOne({
          conversationId: conversation._id,
          sender: MessageSender.ASSISTANT,
          createdAt: { $gte: existingUserMessage.createdAt },
        }).sort({ createdAt: 1 });

        if (existingAssistantMessage) {
          logger.info('Returning idempotent cached conversation message pair', { idempotencyKey });
          return {
            userMessage: this.formatMessage(existingUserMessage),
            assistantMessage: this.formatMessage(existingAssistantMessage),
          };
        }

        // An in-flight request is currently generating the assistant response: await its completion
        return this.pollForCompletedAssistantMessage(conversation._id, existingUserMessage, rawContent);
      }
    }

    // 2. Persist the submitted user message with atomic unique index protection
    let userMessage: any;
    try {
      userMessage = await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.USER,
        content: rawContent,
        status: 'completed',
        idempotencyKey: idempotencyKey || undefined,
        requestId: clientMeta?.requestId || null,
      });
    } catch (insertErr: any) {
      if (insertErr?.code === 11000 && idempotencyKey) {
        // Race condition: another concurrent request just inserted this idempotency key
        const raceUserMessage = await MessageModel.findOne({
          conversationId: conversation._id,
          idempotencyKey,
          sender: MessageSender.USER,
        });
        if (raceUserMessage) {
          if (raceUserMessage.content !== rawContent) {
            throw new ConflictError(
              'Idempotency key has already been used with a different message payload'
            );
          }
          return this.pollForCompletedAssistantMessage(conversation._id, raceUserMessage, rawContent);
        }
      }
      throw insertErr;
    }

    try {
      // 3. Load prior conversation history bounded by CONVERSATION_HISTORY_LIMIT
      const priorMessages = await MessageModel.find({
        conversationId: conversation._id,
        _id: { $ne: userMessage._id },
        status: 'completed',
      })
        .sort({ createdAt: -1 })
        .limit(env.CONVERSATION_HISTORY_LIMIT)
        .lean();

      // Reverse to chronological order
      const chronologicalHistory = priorMessages.reverse().map((m: any) => ({
        sender: m.sender,
        content: m.content,
      }));

      // 4. Check cache for query under current authorization
      const llmProvider = LlmFactory.getProvider();
      const modelName = llmProvider.modelName;

      // Cache key incorporates query + user authorization fingerprint and captures generation counter
      const { cached, generation: queryGeneration } = await RagCacheService.getWithGeneration(
        { query: rawContent },
        user,
        modelName
      );

      let finalAnswer: string;
      let finalCitations: any[] = [];
      let insufficientEvidence = false;
      let generationMs = 0;
      let candidatesCount = 0;
      let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (cached) {
        finalAnswer = cached.answer;
        finalCitations = cached.citations;
        insufficientEvidence = cached.insufficientEvidence;
        candidatesCount = cached.retrievalMetadata?.totalCandidates ?? 0;
      } else {
        // 5. Execute fresh RAG retrieval with current user's authorization & active revision checks
        const searchRes = await RetrievalService.search(rawContent, user, {
          topK: env.RAG_TOP_K,
          similarityThreshold: env.RAG_SIMILARITY_THRESHOLD,
        });

        const candidates = searchRes.candidates;
        candidatesCount = candidates.length;

        if (candidates.length === 0) {
          const hasAnyDocs = await DocumentModel.exists({ status: DocumentStatus.READY });
          finalAnswer = hasAnyDocs
            ? this.INSUFFICIENT_EVIDENCE_ANSWER
            : 'No documents have been indexed in the knowledge repository yet. Please upload organizational documents in the Documents repository to enable Copilot answers.';
          finalCitations = [];
          insufficientEvidence = true;
        } else {
          const assembledContext = ContextAssembler.assemble(candidates);

          if (assembledContext.evidenceList.length === 0) {
            finalAnswer = this.INSUFFICIENT_EVIDENCE_ANSWER;
            finalCitations = [];
            insufficientEvidence = true;
          } else {
            // 6. Build multi-turn prompt separating historical dialogue from verified evidence
            const prompt = PromptBuilder.buildMultiTurnUserPrompt(
              rawContent,
              assembledContext.formattedContext,
              chronologicalHistory
            );

            const startGen = Date.now();
            let llmResponse;
            try {
              llmResponse = await llmProvider.generateText(prompt, {
                systemInstruction: conversation.systemPromptOverride || PromptBuilder.SYSTEM_INSTRUCTION,
                temperature: 0.2,
                maxTokens: 1024,
              });
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error('LLM failure in conversation turn', { error: errMsg });
              throw new BadGatewayError(`LLM generation service failure: ${errMsg}`);
            }
            generationMs = Date.now() - startGen;

            const rawText = llmResponse?.text?.trim() || '';
            if (!rawText) {
              finalAnswer = this.INSUFFICIENT_EVIDENCE_ANSWER;
              finalCitations = [];
              insufficientEvidence = true;
            } else {
              // 7. Validate citations strictly against currently authorized evidence map
              const validation = CitationValidator.validate(rawText, assembledContext.evidenceMap);
              const isDisclaimer =
                /insufficient information|do not have sufficient|no relevant documents|cannot answer|not enough information/i.test(
                  validation.sanitizedAnswer
                );

              insufficientEvidence = isDisclaimer || !validation.hasValidCitations;
              finalAnswer = insufficientEvidence
                ? this.INSUFFICIENT_EVIDENCE_ANSWER
                : validation.sanitizedAnswer;
              finalCitations = insufficientEvidence ? [] : validation.validatedCitations;

              tokenUsage = {
                promptTokens: llmResponse.promptTokens ?? Math.ceil(prompt.length / 4),
                completionTokens: llmResponse.completionTokens ?? Math.ceil(finalAnswer.length / 4),
                totalTokens:
                  (llmResponse.promptTokens ?? Math.ceil(prompt.length / 4)) +
                  (llmResponse.completionTokens ?? Math.ceil(finalAnswer.length / 4)),
              };

              // Cache grounded response with in-flight invalidation protection
              if (!insufficientEvidence) {
                await RagCacheService.set(
                  { query: rawContent },
                  user,
                  modelName,
                  {
                    answer: finalAnswer,
                    citations: finalCitations,
                    insufficientEvidence: false,
                    retrievalMetadata: {
                      totalCandidates: candidates.length,
                      authorizedChunks: assembledContext.evidenceList.length,
                      timingsMs: {
                        embedding: searchRes.timings.embeddingMs,
                        retrieval: searchRes.timings.searchMs,
                        generation: generationMs,
                        total: Date.now() - startTime,
                      },
                    },
                  },
                  queryGeneration
                );
              }
            }
          }
        }
      }

      const totalDurationMs = Date.now() - startTime;

      // 8. Persist validated assistant response
      const assistantMessage = await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.ASSISTANT,
        content: finalAnswer,
        citations: finalCitations,
        status: 'completed',
        tokensUsed: tokenUsage,
        latencyMs: totalDurationMs,
        modelProvider: conversation.selectedModelProvider,
        modelName: conversation.selectedModelName,
        requestId: clientMeta?.requestId || null,
      });

      // 9. Update conversation timestamps and title if newly created
      const updates: any = { updatedAt: new Date() };
      if (conversation.title === 'New Conversation') {
        updates.title = rawContent.slice(0, 40) + (rawContent.length > 40 ? '...' : '');
      }
      await ConversationModel.updateOne({ _id: conversation._id }, { $set: updates });

      // 10. Audit logging
      await AuditService.log({
        userId: user.sub,
        action: AuditAction.RAG_QUERY,
        resourceType: AuditResourceType.CONVERSATION,
        resourceId: conversation._id.toString(),
        ipAddress: clientMeta?.ip || '127.0.0.1',
        userAgent: clientMeta?.userAgent || 'internal',
        status: 'success',
        details: {
          conversationId: conversation._id.toString(),
          userMessageId: userMessage._id.toString(),
          assistantMessageId: assistantMessage._id.toString(),
          citationsCount: finalCitations.length,
          candidatesCount,
          insufficientEvidence,
          latencyMs: totalDurationMs,
        },
      });

      return {
        userMessage: this.formatMessage(userMessage),
        assistantMessage: this.formatMessage(assistantMessage),
      };
    } catch (pipelineErr) {
      // If the operation failed before the assistant message could be created,
      // remove the unfulfilled user message so retries can proceed cleanly
      if (idempotencyKey && userMessage?._id) {
        await MessageModel.deleteOne({ _id: userMessage._id }).catch(() => {});
      }
      throw pipelineErr;
    }
  }

  /**
   * Concurrently polls for the completion of an in-flight idempotent assistant response
   */
  private static async pollForCompletedAssistantMessage(
    conversationId: mongoose.Types.ObjectId,
    userMessage: any,
    _expectedContent?: string,
    maxWaitMs: number = 20000
  ): Promise<ISendMessageResult> {
    const pollIntervalMs = 200;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const assistantMsg = await MessageModel.findOne({
        conversationId,
        sender: MessageSender.ASSISTANT,
        createdAt: { $gte: userMessage.createdAt },
      }).sort({ createdAt: 1 });

      if (assistantMsg) {
        return {
          userMessage: this.formatMessage(userMessage),
          assistantMessage: this.formatMessage(assistantMsg),
        };
      }

      // Check if userMessage was deleted (indicating in-flight failure)
      const stillExists = await MessageModel.findById(userMessage._id);
      if (!stillExists) {
        throw new BadGatewayError('In-flight request failed during generation. Please retry.');
      }
    }

    throw new BadGatewayError('Timed out waiting for concurrent idempotent request to complete.');
  }

  public static formatConversation(doc: any): IConversation {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      title: doc.title,
      status: doc.status,
      selectedModelProvider: doc.selectedModelProvider,
      selectedModelName: doc.selectedModelName,
      systemPromptOverride: doc.systemPromptOverride,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }

  public static formatMessage(doc: any): IMessage {
    return {
      id: doc._id.toString(),
      conversationId: doc.conversationId.toString(),
      sender: doc.sender,
      content: doc.content,
      status: doc.status,
      citations: doc.citations || [],
      tokensUsed: doc.tokensUsed,
      latencyMs: doc.latencyMs,
      modelProvider: doc.modelProvider,
      modelName: doc.modelName,
      idempotencyKey: doc.idempotencyKey || undefined,
      requestId: doc.requestId || undefined,
      errorMessage: doc.errorMessage || undefined,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    };
  }
}
