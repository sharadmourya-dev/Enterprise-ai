import { GoogleGenAI } from '@google/genai';
import { ILlmProvider, ILlmGenerateOptions, ILlmGenerateResult } from './llm.interface.js';
import { env } from '../../config/env.js';
import {
  BadRequestError,
  BadGatewayError,
  ServiceUnavailableError,
} from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export interface IProviderErrorDetails {
  statusCode: number;
  statusText: string;
  isTransient: boolean;
  safeMessage: string;
}

/**
 * Parses and sanitizes raw provider errors from @google/genai into structured diagnostics.
 * Strips secrets, API keys, or credentials and identifies whether the error is transient.
 */
export function parseProviderError(err: unknown): IProviderErrorDetails {
  let statusCode = 500;
  let statusText = 'INTERNAL_ERROR';
  let safeMessage = 'An upstream provider error occurred';

  if (!err) {
    return { statusCode, statusText, isTransient: false, safeMessage };
  }

  const rawMsg = err instanceof Error ? err.message : String(err);

  // 1. Try to parse JSON from error message (Google GenAI error format)
  try {
    const parsed = JSON.parse(rawMsg);
    if (parsed?.error) {
      if (typeof parsed.error.code === 'number') {
        statusCode = parsed.error.code;
      }
      if (typeof parsed.error.status === 'string') {
        statusText = parsed.error.status;
      }
      if (typeof parsed.error.message === 'string') {
        safeMessage = parsed.error.message;
      }
    }
  } catch {
    // Non-JSON error message
    if (typeof (err as any).status === 'number') {
      statusCode = (err as any).status;
    } else if (typeof (err as any).statusCode === 'number') {
      statusCode = (err as any).statusCode;
    }

    if (typeof (err as any).statusText === 'string') {
      statusText = (err as any).statusText;
    }

    if (rawMsg) {
      safeMessage = rawMsg;
    }
  }

  // Sanitize message: redact any key parameters if present
  safeMessage = safeMessage.replace(/key=[A-Za-z0-9_-]+/gi, 'key=[REDACTED]');

  const isTransient =
    statusCode === 503 || // Unavailable / High Demand
    statusCode === 429 || // Resource Exhausted / Rate Limit
    statusCode === 502 || // Bad Gateway
    statusCode === 504 || // Gateway Timeout
    statusCode === 500 || // Internal Google server error
    /high demand|spikes in demand|overloaded|temporarily unavailable|resource_exhausted|rate limit|econnreset|etimedout|timeout|timed out/i.test(
      safeMessage
    );

  return { statusCode, statusText, isTransient, safeMessage };
}

export class GeminiLlmProvider implements ILlmProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;
  private aiClient: GoogleGenAI | null = null;

  constructor(modelName = env.GEMINI_MODEL) {
    this.modelName = modelName;
    if (env.GEMINI_API_KEY && !env.GEMINI_API_KEY.startsWith('your_')) {
      this.aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    }
  }

  /**
   * Constructs the generation config payload for `@google/genai` models.generateContent.
   *
   * Per Google official Gemini 3.8 migration documentation
   * (https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8):
   * Gemini 3 and later models (e.g. gemini-3.8-flash, gemini-3.6-flash) deprecate
   * and remove sampling parameters including temperature, top_p, and top_k.
   * For legacy models (e.g. gemini-2.0, gemini-2.5), temperature is preserved.
   */
  public buildGenerateConfig(options?: ILlmGenerateOptions): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    if (options?.systemInstruction) {
      config.systemInstruction = options.systemInstruction;
    }

    if (options?.maxTokens !== undefined) {
      config.maxOutputTokens = options.maxTokens;
    }

    // Omit deprecated sampling parameters for Gemini 3 and later
    const isGemini3OrLater = /^gemini-[3-9]|^gemini-\d{2,}/i.test(this.modelName);
    if (!isGemini3OrLater) {
      config.temperature = options?.temperature ?? 0.2;
    }

    return config;
  }

  /**
   * Executes a single attempt against the Google Gemini API with timeout and abort handling
   */
  private async executeSingleAttempt(
    prompt: string,
    options: ILlmGenerateOptions | undefined,
    config: Record<string, unknown>
  ): Promise<ILlmGenerateResult> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    try {
      const generatePromise = this.aiClient!.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config,
      });

      const timerPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Gemini LLM request timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      });

      const promises: Promise<any>[] = [generatePromise, timerPromise];

      if (options?.abortSignal) {
        if (options.abortSignal.aborted) {
          throw new BadRequestError('LLM generation request aborted by client');
        }
        const abortPromise = new Promise<never>((_, reject) => {
          onAbort = () => reject(new BadRequestError('LLM generation request aborted by client'));
          options.abortSignal!.addEventListener('abort', onAbort, { once: true });
        });
        promises.push(abortPromise);
      }

      const response = await Promise.race(promises);

      const text = response.text || '';
      const usageMetadata = (response as any).usageMetadata;

      return {
        text,
        promptTokens: usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4),
        completionTokens: usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4),
        model: this.modelName,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort && options?.abortSignal) {
        options.abortSignal.removeEventListener('abort', onAbort);
      }
    }
  }

  /**
   * Generates text via Gemini with automatic exponential backoff retry for transient provider errors
   * (e.g. 503 UNAVAILABLE / high demand spikes, 429 rate limits, network resets).
   */
  public async generateText(
    prompt: string,
    options?: ILlmGenerateOptions
  ): Promise<ILlmGenerateResult> {
    if (!this.aiClient) {
      throw new BadRequestError(
        'Gemini API key is not configured. Please set GEMINI_API_KEY in .env or switch LLM_PROVIDER.'
      );
    }

    const config = this.buildGenerateConfig(options);
    const maxRetries = options?.maxRetries ?? 3;
    const initialRetryDelayMs = options?.initialRetryDelayMs ?? 800;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options?.abortSignal?.aborted) {
        throw new BadRequestError('LLM generation request aborted by client');
      }

      try {
        const result = await this.executeSingleAttempt(prompt, options, config);
        if (attempt > 0) {
          logger.info('Gemini text generation succeeded after retry', {
            model: this.modelName,
            attempt: attempt + 1,
          });
        }
        return result;
      } catch (err: unknown) {
        if (options?.abortSignal?.aborted) {
          throw new BadRequestError('LLM generation request aborted by client');
        }

        const parsed = parseProviderError(err);
        const isLastAttempt = attempt >= maxRetries;

        if (!parsed.isTransient || isLastAttempt) {
          logger.error('Gemini text generation failed', {
            model: this.modelName,
            providerStatusCode: parsed.statusCode,
            providerStatusText: parsed.statusText,
            message: parsed.safeMessage,
            totalAttempts: attempt + 1,
            isTransient: parsed.isTransient,
          });

          if (parsed.statusCode === 503 || parsed.statusCode === 429) {
            throw new ServiceUnavailableError(
              `Gemini upstream service unavailable (${parsed.statusCode}): ${parsed.safeMessage}`,
              'LLM_PROVIDER_UNAVAILABLE'
            );
          } else if (parsed.statusCode >= 500) {
            throw new BadGatewayError(
              `Gemini upstream provider error (${parsed.statusCode}): ${parsed.safeMessage}`,
              'LLM_PROVIDER_ERROR'
            );
          } else {
            throw new BadRequestError(
              `Failed to generate text via Gemini: ${parsed.safeMessage}`,
              'LLM_GENERATION_FAILED'
            );
          }
        }

        const delayMs = Math.min(
          6000,
          initialRetryDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200)
        );

        logger.warn('Gemini upstream returned transient error; retrying with backoff', {
          model: this.modelName,
          providerStatusCode: parsed.statusCode,
          statusText: parsed.statusText,
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          retryDelayMs: delayMs,
          safeMessage: parsed.safeMessage,
        });

        await new Promise<void>((resolve, reject) => {
          const timerId = setTimeout(resolve, delayMs);
          if (options?.abortSignal) {
            const onAbort = () => {
              clearTimeout(timerId);
              reject(new BadRequestError('LLM generation request aborted by client'));
            };
            options.abortSignal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }

    throw new ServiceUnavailableError(
      'Gemini text generation failed after maximum retries',
      'LLM_PROVIDER_UNAVAILABLE'
    );
  }
}
