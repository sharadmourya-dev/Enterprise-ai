import { GoogleGenAI } from '@google/genai';
import { ILlmProvider, ILlmGenerateOptions, ILlmGenerateResult } from './llm.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

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

  public async generateText(
    prompt: string,
    options?: ILlmGenerateOptions
  ): Promise<ILlmGenerateResult> {
    if (!this.aiClient) {
      throw new BadRequestError(
        'Gemini API key is not configured. Please set GEMINI_API_KEY in .env or switch LLM_PROVIDER.'
      );
    }

    const timeoutMs = options?.timeoutMs ?? 30000;

    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const config = this.buildGenerateConfig(options);

      const generatePromise = this.aiClient.models.generateContent({
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Gemini text generation error', { error: errMsg, model: this.modelName });
      throw new BadRequestError(`Failed to generate text via Gemini: ${errMsg}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort && options?.abortSignal) {
        options.abortSignal.removeEventListener('abort', onAbort);
      }
    }
  }
}
