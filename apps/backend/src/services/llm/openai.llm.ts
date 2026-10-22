import OpenAI from 'openai';
import { ILlmProvider, ILlmGenerateOptions, ILlmGenerateResult } from './llm.interface.js';
import { parseProviderError } from './gemini.llm.js';
import { env } from '../../config/env.js';
import {
  BadRequestError,
  BadGatewayError,
  ServiceUnavailableError,
} from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export class OpenAILlmProvider implements ILlmProvider {
  public readonly providerName = 'openai';
  public readonly modelName: string;
  private client: OpenAI | null = null;

  constructor(modelName = env.OPENAI_MODEL) {
    this.modelName = modelName;
    if (env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('your_')) {
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
  }

  /**
   * Constructs chat completion request parameters for OpenAI.
   * Standard models (including default gpt-4o-mini) support temperature and max_tokens.
   * The dedicated o-series reasoning models (e.g. o1, o3-mini) strictly disallow
   * the temperature parameter in Chat Completions and utilize max_completion_tokens.
   */
  public buildRequestParams(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options?: ILlmGenerateOptions
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {
      model: this.modelName,
      messages,
    };

    // Specific o-series reasoning models strictly reject temperature in Chat Completions
    const isOSeriesReasoning = /^o[1-9]/i.test(this.modelName);
    if (!isOSeriesReasoning) {
      params.temperature = options?.temperature ?? 0.2;
    }

    if (options?.maxTokens !== undefined) {
      if (isOSeriesReasoning) {
        params.max_completion_tokens = options.maxTokens;
      } else {
        params.max_tokens = options.maxTokens;
      }
    }

    return params;
  }

  private async executeSingleAttempt(
    prompt: string,
    options: ILlmGenerateOptions | undefined
  ): Promise<ILlmGenerateResult> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    if (options?.systemInstruction) {
      messages.push({
        role: 'system',
        content: options.systemInstruction,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    const requestParams = this.buildRequestParams(messages, options);

    const requestOptions: { timeout: number; signal?: AbortSignal } = { timeout: timeoutMs };
    if (options?.abortSignal) {
      requestOptions.signal = options.abortSignal;
    }

    const response = await this.client!.chat.completions.create(
      requestParams as any,
      requestOptions
    );

    const choice = response.choices[0];
    const text = choice?.message?.content || '';

    return {
      text,
      promptTokens: response.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4),
      completionTokens: response.usage?.completion_tokens ?? Math.ceil(text.length / 4),
      model: this.modelName,
    };
  }

  public async generateText(
    prompt: string,
    options?: ILlmGenerateOptions
  ): Promise<ILlmGenerateResult> {
    if (!this.client) {
      throw new BadRequestError(
        'OpenAI API key is not configured. Please set OPENAI_API_KEY in .env or switch LLM_PROVIDER.'
      );
    }

    const maxRetries = options?.maxRetries ?? 3;
    const initialRetryDelayMs = options?.initialRetryDelayMs ?? 800;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options?.abortSignal?.aborted) {
        throw new BadRequestError('LLM generation request aborted by client');
      }

      try {
        const result = await this.executeSingleAttempt(prompt, options);
        if (attempt > 0) {
          logger.info('OpenAI text generation succeeded after retry', {
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
          logger.error('OpenAI text generation failed', {
            model: this.modelName,
            providerStatusCode: parsed.statusCode,
            providerStatusText: parsed.statusText,
            message: parsed.safeMessage,
            totalAttempts: attempt + 1,
            isTransient: parsed.isTransient,
          });

          if (parsed.statusCode === 503 || parsed.statusCode === 429) {
            throw new ServiceUnavailableError(
              `OpenAI upstream service unavailable (${parsed.statusCode}): ${parsed.safeMessage}`,
              'LLM_PROVIDER_UNAVAILABLE'
            );
          } else if (parsed.statusCode >= 500) {
            throw new BadGatewayError(
              `OpenAI upstream provider error (${parsed.statusCode}): ${parsed.safeMessage}`,
              'LLM_PROVIDER_ERROR'
            );
          } else {
            throw new BadRequestError(
              `Failed to generate text via OpenAI: ${parsed.safeMessage}`,
              'LLM_GENERATION_FAILED'
            );
          }
        }

        const delayMs = Math.min(
          6000,
          initialRetryDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200)
        );

        logger.warn('OpenAI upstream returned transient error; retrying with backoff', {
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
      'OpenAI text generation failed after maximum retries',
      'LLM_PROVIDER_UNAVAILABLE'
    );
  }
}
