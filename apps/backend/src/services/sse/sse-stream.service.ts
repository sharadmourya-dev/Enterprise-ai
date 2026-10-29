import { Response, Request } from 'express';
import mongoose from 'mongoose';
import {
  IJwtPayload,
  MessageSender,
  AuditAction,
  AuditResourceType,
  DocumentStatus,
} from '@enterprise-ai/shared-types';
import { ConversationModel } from '../../models/Conversation.model.js';
import { MessageModel } from '../../models/Message.model.js';
import { DocumentModel } from '../../models/Document.model.js';
import { RetrievalService } from '../retrieval.service.js';
import { ContextAssembler } from '../rag/context-assembler.js';
import { CitationValidator } from '../rag/citation-validator.js';
import { PromptBuilder } from '../rag/prompt-builder.js';
import { QueryRewriterService } from '../rag/query-rewriter.service.js';
import { LlmFactory } from '../llm/llm.factory.js';
import { AuditService } from '../audit.service.js';
import { RagCacheService } from '../cache/rag-cache.service.js';
import { ConflictError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

export class SseStreamService {
  private static readonly INSUFFICIENT_EVIDENCE_ANSWER =
    'I do not have sufficient information in the provided documentation to answer this question.';

  /**
   * Formats and writes an SSE event to the response stream
   */
  public static writeEvent(res: Response, event: string, data: any): void {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    const payload = JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  }

  /**
   * Emits exactly one terminal event (message.completed or message.error) and terminates the stream
   */
  public static emitTerminalEvent(
    res: Response,
    event: 'message.completed' | 'message.error',
    data: any,
    flags: { terminalEmitted: boolean }
  ): void {
    if (flags.terminalEmitted || res.writableEnded || res.destroyed) {
      return;
    }
    flags.terminalEmitted = true;
    this.writeEvent(res, event, data);
    res.end();
  }

  /**
   * Handles full SSE streaming lifecycle for a conversational message
   */
  public static async streamMessage(
    req: Request,
    res: Response,
    conversation: any,
    user: IJwtPayload,
    content: string,
    idempotencyKey?: string
  ): Promise<void> {
    const startTime = Date.now();
    const flags = { terminalEmitted: false };
    let isClientDisconnected = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let userMessage: any = null;
    let assistantMessage: any = null;

    // Abort controller for downstream operations
    const abortController = new AbortController();

    const cleanup = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      res.off('close', onClientClose);
      abortController.abort();
    };

    // Client disconnection detection via response close signal when not ended normally
    const onClientClose = () => {
      if (!res.writableEnded) {
        isClientDisconnected = true;
        cleanup();
        logger.info('SSE client disconnected prematurely', {
          conversationId: conversation._id.toString(),
          userId: user.sub,
        });
      }
    };

    res.on('close', onClientClose);

    try {
      // 1. Idempotency check: return existing message if already processed or in-flight
      if (idempotencyKey) {
        const existingUserMsg = await MessageModel.findOne({
          conversationId: conversation._id,
          idempotencyKey,
          sender: MessageSender.USER,
        });

        if (existingUserMsg) {
          if (existingUserMsg.content !== content) {
            throw new ConflictError(
              'Idempotency key has already been used with a different message payload'
            );
          }

          const existingAssistantMsg = await MessageModel.findOne({
            conversationId: conversation._id,
            sender: MessageSender.ASSISTANT,
            createdAt: { $gte: existingUserMsg.createdAt },
          }).sort({ createdAt: 1 });

          if (existingAssistantMsg) {
            this.streamExistingAssistantMessage(res, conversation._id.toString(), existingAssistantMsg, flags);
            return;
          }

          // Await in-flight assistant generation
          const polled = await this.pollForCompletedAssistantMessageSse(conversation._id, existingUserMsg);
          if (polled) {
            this.streamExistingAssistantMessage(res, conversation._id.toString(), polled, flags);
            return;
          }
        }
      }

      // 2. Persist the submitted user message with atomic index collision handling
      try {
        userMessage = await MessageModel.create({
          conversationId: conversation._id,
          sender: MessageSender.USER,
          content,
          status: 'completed',
          idempotencyKey: idempotencyKey || undefined,
          requestId: (req as any).id || null,
        });
      } catch (insertErr: any) {
        if (insertErr?.code === 11000 && idempotencyKey) {
          // Concurrent request inserted the user message
          const raceUserMsg = await MessageModel.findOne({
            conversationId: conversation._id,
            idempotencyKey,
            sender: MessageSender.USER,
          });
          if (raceUserMsg) {
            if (raceUserMsg.content !== content) {
              throw new ConflictError(
                'Idempotency key has already been used with a different message payload'
              );
            }
            const polled = await this.pollForCompletedAssistantMessageSse(conversation._id, raceUserMsg);
            if (polled) {
              this.streamExistingAssistantMessage(res, conversation._id.toString(), polled, flags);
              return;
            }
          }
        }
        throw insertErr;
      }

      if (isClientDisconnected) return;

      // 3. Send SSE headers
      this.sendSseHeaders(res);

      // 4. Emit message.started
      this.writeEvent(res, 'message.started', {
        conversationId: conversation._id.toString(),
        messageId: userMessage._id.toString(),
      });

      // 5. Setup heartbeat timer to keep connection alive during generation
      heartbeatTimer = setInterval(() => {
        if (!isClientDisconnected && !res.writableEnded) {
          res.write(': heartbeat\n\n');
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        }
      }, env.SSE_HEARTBEAT_INTERVAL_MS);

      // Emit retrieving progress
      this.writeEvent(res, 'message.progress', { stage: 'retrieving', progress: 25 });

      if (isClientDisconnected) return;

      const llmProvider = LlmFactory.getProvider();
      const modelName = llmProvider.modelName;

      // 6. Load bounded conversation history for contextual disambiguation & prompt construction
      const priorMessages = await MessageModel.find({
        conversationId: conversation._id,
        _id: { $ne: userMessage._id },
        status: 'completed',
      })
        .sort({ createdAt: -1 })
        .limit(env.CONVERSATION_HISTORY_LIMIT)
        .lean();

      const chronologicalHistory = priorMessages.reverse().map((m: any) => ({
        sender: m.sender,
        content: m.content,
      }));

      // 7. Resolve contextual follow-up query rewriting (resolves ambiguous references)
      const effectiveQuery = await QueryRewriterService.rewriteQuery(
        content,
        chronologicalHistory,
        { abortSignal: abortController.signal, llmProvider }
      );

      if (isClientDisconnected) return;

      // 8. Check cache for effective query under current authorization
      const { cached, generation: queryGeneration } = await RagCacheService.getWithGeneration(
        { query: effectiveQuery },
        user,
        modelName
      );

      let finalAnswer: string;
      let finalCitations: any[] = [];
      let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let generationMs = 0;

      if (cached) {
        finalAnswer = cached.answer;
        finalCitations = cached.citations;
      } else {
        // 9. Re-evaluate authorization on this turn: search with user's current principal
        const searchRes = await RetrievalService.search(effectiveQuery, user, {
          topK: env.RAG_TOP_K,
          similarityThreshold: env.RAG_SIMILARITY_THRESHOLD,
        });

        if (isClientDisconnected) return;

        const candidates = searchRes.candidates;

        if (candidates.length === 0) {
          const hasAnyDocs = await DocumentModel.exists({ status: DocumentStatus.READY });
          finalAnswer = hasAnyDocs
            ? this.INSUFFICIENT_EVIDENCE_ANSWER
            : 'No documents have been indexed in the knowledge repository yet. Please upload organizational documents in the Documents repository to enable Copilot answers.';
          finalCitations = [];
        } else {
          const assembledContext = ContextAssembler.assemble(candidates);

          if (assembledContext.evidenceList.length === 0) {
            finalAnswer = this.INSUFFICIENT_EVIDENCE_ANSWER;
            finalCitations = [];
          } else {
            this.writeEvent(res, 'message.progress', { stage: 'generating', progress: 50 });

            // 9. Build multi-turn prompt separating dialogue history from evidence
            const prompt = PromptBuilder.buildMultiTurnUserPrompt(
              content,
              assembledContext.formattedContext,
              chronologicalHistory
            );

            // 10. Generate full answer internally with abortSignal propagation
            const startGen = Date.now();
            let llmResponse;
            try {
              llmResponse = await llmProvider.generateText(prompt, {
                systemInstruction: conversation.systemPromptOverride || PromptBuilder.SYSTEM_INSTRUCTION,
                temperature: 0.2,
                maxTokens: 1024,
                abortSignal: abortController.signal,
              });
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (isClientDisconnected || abortController.signal.aborted) {
                logger.info('Downstream LLM generation aborted due to client disconnect');
                return;
              }
              const statusCode = (err as any)?.statusCode || 500;
              const errorCode = (err as any)?.errorCode || 'AI_SERVICE_UNAVAILABLE';
              const userSafeMessage =
                (err as any)?.errorCode === 'AI_SERVICE_UNAVAILABLE'
                  ? 'The AI service is temporarily unavailable. We tried the available models but could not complete your request. Please try again shortly.'
                  : (err as any)?.isOperational && (err as any)?.message
                    ? (err as any).message
                    : 'The AI service is temporarily unavailable. We tried the available models but could not complete your request. Please try again shortly.';

              logger.error('LLM generation failed in SSE stream', {
                error: errMsg,
                statusCode,
                errorCode,
                model: modelName,
              });
              this.emitTerminalEvent(res, 'message.error', {
                code: errorCode,
                message: userSafeMessage,
              }, flags);
              return;
            }
            generationMs = Date.now() - startGen;

            if (isClientDisconnected) return;

            this.writeEvent(res, 'message.progress', { stage: 'validating', progress: 90 });

            // 11. CITATION-SAFE VALIDATION: Validate complete answer before releasing tokens
            const rawText = llmResponse?.text?.trim() || '';
            const validation = CitationValidator.validate(rawText, assembledContext.evidenceMap);
            const isDisclaimer =
              /insufficient information|do not have sufficient|no relevant documents|cannot answer|not enough information/i.test(
                validation.sanitizedAnswer
              );

            const insufficientEvidence = isDisclaimer || !validation.hasValidCitations;
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
                { query: effectiveQuery },
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

      // 12. Safe release: Emit validated answer tokens / chunks only after validation succeeded
      if (!isClientDisconnected) {
        // Chunk the validated text for smooth delivery
        const chunkSize = 64;
        for (let i = 0; i < finalAnswer.length; i += chunkSize) {
          const chunk = finalAnswer.slice(i, i + chunkSize);
          this.writeEvent(res, 'message.delta', { content: chunk });
        }

        // Emit validated citations
        this.writeEvent(res, 'message.citations', { citations: finalCitations });
      }

      const totalDurationMs = Date.now() - startTime;

      // 13. Persist completed assistant message
      assistantMessage = await MessageModel.create({
        conversationId: conversation._id,
        sender: MessageSender.ASSISTANT,
        content: finalAnswer,
        citations: finalCitations,
        status: 'completed',
        tokensUsed: tokenUsage,
        latencyMs: totalDurationMs,
        modelProvider: conversation.selectedModelProvider,
        modelName: conversation.selectedModelName,
        requestId: (req as any).id || null,
      });

      // Update conversation timestamp & title if new
      const updates: any = { updatedAt: new Date() };
      if (conversation.title === 'New Conversation') {
        updates.title = content.slice(0, 40) + (content.length > 40 ? '...' : '');
      }
      await ConversationModel.updateOne({ _id: conversation._id }, { $set: updates });

      // 14. Emit completion event
      if (!isClientDisconnected) {
        this.emitTerminalEvent(res, 'message.completed', {
          messageId: assistantMessage._id.toString(),
          tokensUsed: tokenUsage,
          latencyMs: totalDurationMs,
          modelProvider: conversation.selectedModelProvider,
          modelName: conversation.selectedModelName,
        }, flags);
      }

      // 15. Audit logging
      await AuditService.log({
        userId: user.sub,
        action: AuditAction.RAG_QUERY,
        resourceType: AuditResourceType.CONVERSATION,
        resourceId: conversation._id.toString(),
        ipAddress: req.ip || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'internal',
        status: 'success',
        details: {
          conversationId: conversation._id.toString(),
          userMessageId: userMessage._id.toString(),
          assistantMessageId: assistantMessage._id.toString(),
          citationsCount: finalCitations.length,
          latencyMs: totalDurationMs,
          streamed: true,
        },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Unexpected error during SSE stream', { error: errMsg });

      if (err instanceof ConflictError) {
        if (!res.headersSent) {
          res.status(409).json({
            success: false,
            error: {
              code: 'CONFLICT',
              message: err.message,
            },
          });
          return;
        } else {
          this.emitTerminalEvent(res, 'message.error', {
            code: 'CONFLICT',
            message: err.message,
          }, flags);
          return;
        }
      }

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: {
            code: 'STREAM_FAILED',
            message: 'An error occurred while initiating the response stream.',
          },
        });
      } else if (!isClientDisconnected && !res.writableEnded) {
        this.emitTerminalEvent(res, 'message.error', {
          code: 'INTERNAL_STREAM_ERROR',
          message: 'An unexpected error occurred during stream generation.',
        }, flags);
      }
    } finally {
      // Disconnect/failure cleanup: If the request was aborted or failed before
      // assistant message could be persisted, remove the unfulfilled user message
      if (idempotencyKey && userMessage?._id && !assistantMessage) {
        await MessageModel.deleteOne({ _id: userMessage._id }).catch(() => {});
      }
      cleanup();
    }
  }

  private static streamExistingAssistantMessage(
    res: Response,
    conversationId: string,
    assistantMsg: any,
    flags: { terminalEmitted: boolean }
  ): void {
    if (!res.headersSent) {
      this.sendSseHeaders(res);
    }
    this.writeEvent(res, 'message.started', {
      conversationId,
      messageId: assistantMsg._id.toString(),
    });
    this.writeEvent(res, 'message.delta', { content: assistantMsg.content });
    this.writeEvent(res, 'message.citations', { citations: assistantMsg.citations });
    this.emitTerminalEvent(res, 'message.completed', {
      messageId: assistantMsg._id.toString(),
      tokensUsed: assistantMsg.tokensUsed,
      latencyMs: assistantMsg.latencyMs,
      modelProvider: assistantMsg.modelProvider,
      modelName: assistantMsg.modelName,
    }, flags);
  }

  private static async pollForCompletedAssistantMessageSse(
    conversationId: mongoose.Types.ObjectId,
    userMessage: any,
    maxWaitMs: number = 20000
  ): Promise<any | null> {
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
        return assistantMsg;
      }

      const stillExists = await MessageModel.findById(userMessage._id);
      if (!stillExists) {
        return null;
      }
    }
    return null;
  }

  private static sendSseHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }
  }
}
