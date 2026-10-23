import { ILlmProvider, ILlmGenerateOptions, ILlmGenerateResult } from './llm.interface.js';
import { parseProviderError } from './gemini.llm.js';
import { env } from '../../config/env.js';
import {
  BadRequestError,
  ServiceUnavailableError,
} from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export interface IFallbackLlmOptions {
  overallDeadlineMs?: number;
  attemptTimeoutMs?: number;
  maxRetriesPerModel?: number;
}

export class FallbackLlmProvider implements ILlmProvider {
  public readonly providerName: string;
  public readonly modelName: string;
  public readonly candidateModels: string[];
  private readonly providerFactory: (modelName: string) => ILlmProvider;
  private readonly overallDeadlineMs: number;
  private readonly attemptTimeoutMs: number;
  private readonly maxRetriesPerModel: number;

  constructor(
    providerName: string,
    primaryModel: string,
    fallbackModels: string[],
    providerFactory: (modelName: string) => ILlmProvider,
    options?: IFallbackLlmOptions
  ) {
    this.providerName = providerName;
    this.modelName = primaryModel;
    this.providerFactory = providerFactory;

    // Deduplicate models preserving primary as first candidate
    const modelSet = new Set<string>();
    if (primaryModel && primaryModel.trim()) {
      modelSet.add(primaryModel.trim());
    }
    for (const m of fallbackModels) {
      if (m && m.trim()) {
        modelSet.add(m.trim());
      }
    }
    this.candidateModels = Array.from(modelSet);

    this.overallDeadlineMs = options?.overallDeadlineMs ?? env.LLM_OVERALL_DEADLINE_MS;
    this.attemptTimeoutMs = options?.attemptTimeoutMs ?? env.LLM_ATTEMPT_TIMEOUT_MS;
    this.maxRetriesPerModel = options?.maxRetriesPerModel ?? env.LLM_MAX_RETRIES_PER_MODEL;
  }

  /**
   * Generates text with resilient model fallback, bounded retries, and overall deadline enforcement.
   *
   * Flow:
   * 1. Attempts configured primary model first.
   * 2. On transient failure (503, 500, timeouts, rate limits), safely fails over to the next candidate model.
   * 3. Non-transient errors (401 invalid credentials, 403 forbidden, 400 malformed requests, aborts)
   *    fast-fail immediately without retry or model cycling.
   * 4. Enforces an overall deadline across all attempts, models, and backoffs.
   * 5. Never leaks credentials, sensitive document text, or full prompts to logs.
   * 6. If all candidate models fail, throws a clean, retryable ServiceUnavailableError.
   */
  public async generateText(
    prompt: string,
    options?: ILlmGenerateOptions
  ): Promise<ILlmGenerateResult> {
    const startTime = Date.now();
    const effectiveDeadlineMs = options?.timeoutMs
      ? Math.min(options.timeoutMs, this.overallDeadlineMs)
      : this.overallDeadlineMs;
    const deadline = startTime + effectiveDeadlineMs;

    let lastError: unknown = null;
    let attemptsCount = 0;

    for (let modelIdx = 0; modelIdx < this.candidateModels.length; modelIdx++) {
      const activeModel = this.candidateModels[modelIdx];
      const isPrimary = activeModel === this.modelName;

      // Check remaining deadline before attempting next model
      const remainingOverallMs = deadline - Date.now();
      if (remainingOverallMs <= 500) {
        logger.warn('LLM fallback deadline exceeded before model attempt', {
          provider: this.providerName,
          activeModel,
          elapsedMs: Date.now() - startTime,
          deadlineMs: effectiveDeadlineMs,
        });
        break;
      }

      if (options?.abortSignal?.aborted) {
        throw new BadRequestError('LLM generation request aborted by client');
      }

      const activeProvider = this.providerFactory(activeModel);

      // Model attempt loop (bounded by maxRetriesPerModel for transient hiccups)
      for (let retry = 0; retry <= this.maxRetriesPerModel; retry++) {
        attemptsCount++;
        const currentRemainingMs = deadline - Date.now();
        if (currentRemainingMs <= 500) {
          break;
        }

        const currentAttemptTimeoutMs = Math.min(this.attemptTimeoutMs, currentRemainingMs);

        const attemptStart = Date.now();
        try {
          if (!isPrimary && retry === 0) {
            logger.info('Invoking fallback LLM model', {
              provider: this.providerName,
              primaryModel: this.modelName,
              fallbackModel: activeModel,
              candidateIndex: modelIdx + 1,
              totalCandidates: this.candidateModels.length,
              remainingDeadlineMs: currentRemainingMs,
            });
          }

          const result = await activeProvider.generateText(prompt, {
            ...options,
            timeoutMs: currentAttemptTimeoutMs,
            // Disable nested internal retry multiplication in underlying provider
            maxRetries: 0,
          });

          const latencyMs = Date.now() - attemptStart;
          const totalDurationMs = Date.now() - startTime;

          logger.info('LLM text generation succeeded', {
            provider: this.providerName,
            model: activeModel,
            isFallback: !isPrimary,
            attemptNumber: attemptsCount,
            attemptLatencyMs: latencyMs,
            totalDurationMs,
          });

          return {
            ...result,
            model: activeModel,
          };
        } catch (err: unknown) {
          lastError = err;

          if (
            options?.abortSignal?.aborted ||
            (err as any)?.name === 'AbortError' ||
            (err as any)?.message?.includes('aborted')
          ) {
            throw new BadRequestError('LLM generation request aborted by client');
          }

          const parsed = parseProviderError(err);
          const attemptLatencyMs = Date.now() - attemptStart;

          logger.warn('LLM candidate attempt failed', {
            provider: this.providerName,
            model: activeModel,
            isPrimary,
            statusCode: parsed.statusCode,
            statusText: parsed.statusText,
            safeMessage: parsed.safeMessage,
            isTransient: parsed.isTransient,
            attemptLatencyMs,
            remainingDeadlineMs: deadline - Date.now(),
          });

          // HTTP 404 indicates an unavailable, retired, or unreleased candidate model.
          // Retrying the same model will never succeed, but subsequent fallback candidates
          // may still be available. Log a sanitized warning and advance immediately to the next model.
          if (parsed.statusCode === 404) {
            logger.warn('Candidate model unavailable or not found (HTTP 404); advancing directly to fallback', {
              provider: this.providerName,
              model: activeModel,
              safeMessage: parsed.safeMessage,
            });
            break; // Break inner retry loop to switch to next candidate model immediately
          }

          // Non-transient errors (e.g. 401 unauthenticated, 403 forbidden, 400 bad request)
          // must fail fast immediately without retrying or switching models.
          if (!parsed.isTransient) {
            logger.error('Non-transient LLM provider error encountered; halting fallback', {
              provider: this.providerName,
              model: activeModel,
              statusCode: parsed.statusCode,
              statusText: parsed.statusText,
              safeMessage: parsed.safeMessage,
            });
            throw err;
          }

          // HTTP 429 indicates rate-limiting or quota exhaustion on this specific model.
          // Retrying the same model will rarely succeed within a short deadline, whereas
          // fallback models maintain independent quotas. Advance immediately to the next candidate model.
          if (parsed.statusCode === 429) {
            logger.warn('Candidate model rate-limited or quota exhausted (HTTP 429); advancing directly to fallback', {
              provider: this.providerName,
              model: activeModel,
              safeMessage: parsed.safeMessage,
            });
            break; // Break inner retry loop to switch to next candidate model immediately
          }

          // If retries remain for this model and deadline allows, apply short jittered backoff
          const hasMoreModelRetries = retry < this.maxRetriesPerModel;
          const timeRemaining = deadline - Date.now();
          if (hasMoreModelRetries && timeRemaining > 1500) {
            const jitterMs = Math.floor(Math.random() * 200) + 200;
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, jitterMs);
              if (options?.abortSignal) {
                options.abortSignal.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(timer);
                    reject(new BadRequestError('LLM generation request aborted by client'));
                  },
                  { once: true }
                );
              }
            });
          }
        }
      }
    }

    // All candidate models or global deadline exhausted
    const totalTimeSpentMs = Date.now() - startTime;
    logger.error('All candidate LLM models failed or generation deadline exhausted', {
      provider: this.providerName,
      primaryModel: this.modelName,
      candidateModels: this.candidateModels,
      totalAttempts: attemptsCount,
      totalTimeSpentMs,
      effectiveDeadlineMs,
      lastError: lastError instanceof Error ? lastError.message : String(lastError || 'Unknown error'),
    });

    throw new ServiceUnavailableError(
      'The AI service is temporarily unavailable. We tried the available models but could not complete your request. Please try again shortly.',
      'AI_SERVICE_UNAVAILABLE'
    );
  }
}
