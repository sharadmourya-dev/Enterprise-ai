import mongoose from 'mongoose';
import {
  IJwtPayload,
  IRagQueryRequest,
  IRagQueryResponse,
  AuditAction,
  AuditResourceType,
} from '@enterprise-ai/shared-types';
import { RetrievalService, ISearchOptions } from '../retrieval.service.js';
import { ContextAssembler } from './context-assembler.js';
import { CitationValidator } from './citation-validator.js';
import { PromptBuilder } from './prompt-builder.js';
import { LlmFactory } from '../llm/llm.factory.js';
import { QueryLogModel } from '../../models/QueryLog.model.js';
import { AuditService } from '../audit.service.js';
import { RagCacheService } from '../cache/rag-cache.service.js';
import { env } from '../../config/env.js';
import { BadRequestError, BadGatewayError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export interface IRagContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export class RagService {
  private static readonly INSUFFICIENT_EVIDENCE_ANSWER =
    'I do not have sufficient information in the provided documentation to answer this question.';

  /**
   * Executes the complete, secure RAG pipeline:
   * Authenticated Query -> ACL Vector Retrieval -> Revision & Status Validation ->
   * Context Assembly -> Grounded LLM Generation -> Citation Verification -> Structured Response
   */
  public static async query(
    request: IRagQueryRequest,
    user: IJwtPayload,
    context?: IRagContext,
    searchOptions?: ISearchOptions
  ): Promise<IRagQueryResponse> {
    const startTime = Date.now();

    const rawQuery = request?.query?.trim();
    if (!rawQuery) {
      throw new BadRequestError('Query string cannot be empty');
    }

    if (rawQuery.length > 1000) {
      throw new BadRequestError('Query length exceeds the maximum allowed limit of 1000 characters');
    }

    const llmProvider = LlmFactory.getProvider();
    const modelName = llmProvider.modelName;

    // Check authorization-aware response cache
    const { cached, generation: queryGeneration } = await RagCacheService.getWithGeneration(request, user, modelName);
    if (cached) {
      const totalDurationMs = Date.now() - startTime;
      await this.safeLogQuery({
        userId: user.sub,
        rawQuery,
        topK: request.topK ?? env.RAG_TOP_K,
        similarityThreshold: request.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD,
        retrievedChunkIds: [],
        timings: { totalDurationMs },
        status: 'success',
        insufficientEvidence: false,
        cacheHit: true,
        context,
        citationsCount: cached.citations.length,
        candidatesCount: cached.retrievalMetadata?.totalCandidates ?? 0,
      });

      return {
        answer: cached.answer,
        citations: cached.citations,
        insufficientEvidence: false,
        retrievalMetadata: {
          totalCandidates: cached.retrievalMetadata?.totalCandidates ?? 0,
          authorizedChunks: cached.retrievalMetadata?.authorizedChunks ?? 0,
          timingsMs: {
            embedding: cached.retrievalMetadata?.timingsMs?.embedding ?? 0,
            retrieval: cached.retrievalMetadata?.timingsMs?.retrieval ?? 0,
            generation: cached.retrievalMetadata?.timingsMs?.generation,
            total: totalDurationMs,
          },
        },
      };
    }

    // 1. Execute ACL-filtered vector retrieval and active-revision validation
    const searchRes = await RetrievalService.search(
      rawQuery,
      user,
      searchOptions ?? {
        topK: request.topK,
        similarityThreshold: request.similarityThreshold,
      }
    );

    const candidates = searchRes.candidates;

    // 2. Handle zero candidates -> explicit Insufficient Evidence
    if (candidates.length === 0) {
      const totalDurationMs = Date.now() - startTime;
      await this.safeLogQuery({
        userId: user.sub,
        rawQuery,
        topK: request.topK ?? env.RAG_TOP_K,
        similarityThreshold: request.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD,
        retrievedChunkIds: [],
        timings: {
          embeddingMs: searchRes.timings.embeddingMs,
          vectorSearchMs: searchRes.timings.searchMs,
          totalDurationMs,
        },
        status: 'filtered_empty',
        insufficientEvidence: true,
        context,
      });

      return {
        answer: this.INSUFFICIENT_EVIDENCE_ANSWER,
        citations: [],
        insufficientEvidence: true,
        retrievalMetadata: {
          totalCandidates: 0,
          authorizedChunks: 0,
          timingsMs: {
            embedding: searchRes.timings.embeddingMs,
            retrieval: searchRes.timings.searchMs,
            total: totalDurationMs,
          },
        },
      };
    }

    // 3. Assemble bounded, numbered evidence context [S1..Sn]
    const assembledContext = ContextAssembler.assemble(candidates);
    if (assembledContext.evidenceList.length === 0) {
      const totalDurationMs = Date.now() - startTime;
      await this.safeLogQuery({
        userId: user.sub,
        rawQuery,
        topK: request.topK ?? env.RAG_TOP_K,
        similarityThreshold: request.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD,
        retrievedChunkIds: [],
        timings: {
          embeddingMs: searchRes.timings.embeddingMs,
          vectorSearchMs: searchRes.timings.searchMs,
          totalDurationMs,
        },
        status: 'filtered_empty',
        insufficientEvidence: true,
        context,
      });

      return {
        answer: this.INSUFFICIENT_EVIDENCE_ANSWER,
        citations: [],
        insufficientEvidence: true,
        retrievalMetadata: {
          totalCandidates: candidates.length,
          authorizedChunks: 0,
          timingsMs: {
            embedding: searchRes.timings.embeddingMs,
            retrieval: searchRes.timings.searchMs,
            total: totalDurationMs,
          },
        },
      };
    }

    // 4. Build prompt and generate answer via configured LLM provider
    const userPrompt = PromptBuilder.buildUserPrompt(rawQuery, assembledContext.formattedContext);

    let llmResponse;
    const startGeneration = Date.now();
    try {
      llmResponse = await llmProvider.generateText(userPrompt, {
        systemInstruction: PromptBuilder.SYSTEM_INSTRUCTION,
        temperature: 0.2,
        maxTokens: 1024,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('LLM provider failure during generation', { error: errMsg });
      throw new BadGatewayError(`LLM generation service failure: ${errMsg}`);
    }
    const generationMs = Date.now() - startGeneration;

    // 5. Validate citations and detect hallucinated references
    const rawAnswerText = llmResponse?.text?.trim() || '';
    if (!rawAnswerText) {
      const totalDurationMs = Date.now() - startTime;
      await this.safeLogQuery({
        userId: user.sub,
        rawQuery,
        topK: request.topK ?? env.RAG_TOP_K,
        similarityThreshold: request.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD,
        retrievedChunkIds: [],
        timings: {
          embeddingMs: searchRes.timings.embeddingMs,
          vectorSearchMs: searchRes.timings.searchMs,
          llmFirstTokenMs: generationMs,
          totalDurationMs,
        },
        status: 'filtered_empty',
        insufficientEvidence: true,
        context,
      });

      return {
        answer: this.INSUFFICIENT_EVIDENCE_ANSWER,
        citations: [],
        insufficientEvidence: true,
        retrievalMetadata: {
          totalCandidates: candidates.length,
          authorizedChunks: assembledContext.evidenceList.length,
          timingsMs: {
            embedding: searchRes.timings.embeddingMs,
            retrieval: searchRes.timings.searchMs,
            generation: generationMs,
            total: totalDurationMs,
          },
        },
      };
    }

    const validationResult = CitationValidator.validate(
      rawAnswerText,
      assembledContext.evidenceMap
    );

    // 6. Evaluate insufficient evidence status
    const isExplicitInsufficient =
      /insufficient information|do not have sufficient|no relevant documents|cannot answer|not enough information/i.test(
        validationResult.sanitizedAnswer
      );

    // Grounding requirement: Response MUST cite at least one verified evidence source to be considered grounded.
    // If the model produced zero valid citations, or all citations were hallucinated, or it explicitly disclaimed knowledge:
    const insufficientEvidence = isExplicitInsufficient || !validationResult.hasValidCitations;

    const finalAnswer = insufficientEvidence
      ? this.INSUFFICIENT_EVIDENCE_ANSWER
      : validationResult.sanitizedAnswer;

    const finalCitations = insufficientEvidence ? [] : validationResult.validatedCitations;

    const totalDurationMs = Date.now() - startTime;

    // Cache successful grounded responses
    if (!insufficientEvidence) {
      await RagCacheService.set(
        request,
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
              total: totalDurationMs,
            },
          },
        },
        queryGeneration
      );
    }

    // 7. Telemetry & audit logging
    const chunkObjectIds = assembledContext.evidenceList
      .map((ev) => (mongoose.Types.ObjectId.isValid(ev.chunkId) ? new mongoose.Types.ObjectId(ev.chunkId) : null))
      .filter((id): id is mongoose.Types.ObjectId => id !== null);

    await this.safeLogQuery({
      userId: user.sub,
      rawQuery,
      topK: request.topK ?? env.RAG_TOP_K,
      similarityThreshold: request.similarityThreshold ?? env.RAG_SIMILARITY_THRESHOLD,
      retrievedChunkIds: chunkObjectIds,
      timings: {
        embeddingMs: searchRes.timings.embeddingMs,
        vectorSearchMs: searchRes.timings.searchMs,
        llmFirstTokenMs: generationMs,
        totalDurationMs,
      },
      tokenUsage: {
        promptTokens: llmResponse.promptTokens ?? Math.ceil(userPrompt.length / 4),
        completionTokens: llmResponse.completionTokens ?? Math.ceil(finalAnswer.length / 4),
      },
      status: insufficientEvidence ? 'filtered_empty' : 'success',
      insufficientEvidence,
      context,
      citationsCount: finalCitations.length,
      candidatesCount: candidates.length,
    });

    return {
      answer: finalAnswer,
      citations: finalCitations,
      insufficientEvidence,
      retrievalMetadata: {
        totalCandidates: candidates.length,
        authorizedChunks: assembledContext.evidenceList.length,
        timingsMs: {
          embedding: searchRes.timings.embeddingMs,
          retrieval: searchRes.timings.searchMs,
          generation: generationMs,
          total: totalDurationMs,
        },
      },
    };
  }

  /**
   * Safely logs telemetry to QueryLogModel and AuditService without throwing on logging failure
   */
  private static async safeLogQuery(params: {
    userId: string;
    rawQuery: string;
    topK: number;
    similarityThreshold: number;
    retrievedChunkIds: mongoose.Types.ObjectId[];
    timings: {
      embeddingMs?: number;
      vectorSearchMs?: number;
      llmFirstTokenMs?: number;
      totalDurationMs: number;
    };
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
    };
    status: 'success' | 'filtered_empty' | 'rate_limited' | 'error';
    insufficientEvidence: boolean;
    context?: IRagContext;
    citationsCount?: number;
    candidatesCount?: number;
    cacheHit?: boolean;
  }): Promise<void> {
    try {
      if (mongoose.Types.ObjectId.isValid(params.userId)) {
        await QueryLogModel.create({
          userId: new mongoose.Types.ObjectId(params.userId),
          rawQuery: params.rawQuery.slice(0, 500), // Bounded length, no confidential prompt leakage
          retrievalParams: {
            topK: params.topK,
            similarityThreshold: params.similarityThreshold,
          },
          retrievedChunkIds: params.retrievedChunkIds,
          timings: params.timings,
          cacheHit: params.cacheHit ?? false,
          tokenUsage: params.tokenUsage,
          status: params.status,
        });
      }

      await AuditService.log({
        userId: params.userId,
        action: AuditAction.RAG_QUERY,
        resourceType: AuditResourceType.SYSTEM,
        resourceId: 'rag_query',
        ipAddress: params.context?.ipAddress || '127.0.0.1',
        userAgent: params.context?.userAgent || 'internal',
        status: 'success',
        details: {
          candidatesCount: params.candidatesCount ?? 0,
          citationsCount: params.citationsCount ?? 0,
          insufficientEvidence: params.insufficientEvidence,
          timingsMs: params.timings,
        },
      });
    } catch (logErr) {
      // Safe logging: log failure never crashes user query
      logger.warn('Failed to record RAG query log or audit event', { error: logErr });
    }
  }
}
