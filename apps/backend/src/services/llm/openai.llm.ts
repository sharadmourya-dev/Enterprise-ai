import OpenAI from 'openai';
import { ILlmProvider, ILlmGenerateOptions, ILlmGenerateResult } from './llm.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';
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

  public async generateText(
    prompt: string,
    options?: ILlmGenerateOptions
  ): Promise<ILlmGenerateResult> {
    if (!this.client) {
      throw new BadRequestError(
        'OpenAI API key is not configured. Please set OPENAI_API_KEY in .env or switch LLM_PROVIDER.'
      );
    }

    const timeoutMs = options?.timeoutMs ?? 30000;

    try {
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

      const response = await this.client.chat.completions.create(
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('OpenAI text generation error', { error: errMsg, model: this.modelName });
      throw new BadRequestError(`Failed to generate text via OpenAI: ${errMsg}`);
    }
  }
}
