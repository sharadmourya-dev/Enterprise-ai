import { ILlmProvider } from './llm.interface.js';
import { GeminiLlmProvider } from './gemini.llm.js';
import { OpenAILlmProvider } from './openai.llm.js';
import { MockLlmProvider } from './mock.llm.js';
import { FallbackLlmProvider } from './fallback.llm.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';

export class LlmFactory {
  private static customProvider: ILlmProvider | null = null;

  /**
   * Overrides active LLM provider (for testing or isolated mock scenarios)
   */
  public static setProvider(provider: ILlmProvider | null): void {
    this.customProvider = provider;
  }

  /**
   * Retrieves the active resilient LLM provider based on configuration or test override.
   * Wraps configured primary and fallback models into a FallbackLlmProvider for automatic
   * failover on transient upstream issues while enforcing the global request deadline.
   */
  public static getProvider(): ILlmProvider {
    if (this.customProvider) {
      return this.customProvider;
    }

    if (env.NODE_ENV === 'test') {
      // In test mode without custom override, default to MockLlmProvider
      return new MockLlmProvider();
    }

    switch (env.LLM_PROVIDER) {
      case 'gemini': {
        const fallbackString = env.LLM_FALLBACK_MODELS || env.GEMINI_FALLBACK_MODELS || '';
        const fallbackModels = fallbackString
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);

        return new FallbackLlmProvider(
          'gemini',
          env.GEMINI_MODEL,
          fallbackModels,
          (modelName: string) => new GeminiLlmProvider(modelName)
        );
      }
      case 'openai': {
        const fallbackString = env.LLM_FALLBACK_MODELS || env.OPENAI_FALLBACK_MODELS || '';
        const fallbackModels = fallbackString
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);

        return new FallbackLlmProvider(
          'openai',
          env.OPENAI_MODEL,
          fallbackModels,
          (modelName: string) => new OpenAILlmProvider(modelName)
        );
      }
      default:
        throw new BadRequestError(`Unsupported LLM provider '${env.LLM_PROVIDER}' configured`);
    }
  }
}
