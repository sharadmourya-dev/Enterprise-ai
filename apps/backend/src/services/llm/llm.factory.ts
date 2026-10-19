import { ILlmProvider } from './llm.interface.js';
import { GeminiLlmProvider } from './gemini.llm.js';
import { OpenAILlmProvider } from './openai.llm.js';
import { MockLlmProvider } from './mock.llm.js';
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
   * Retrieves the active LLM provider based on configuration or test override
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
      case 'gemini':
        return new GeminiLlmProvider();
      case 'openai':
        return new OpenAILlmProvider();
      default:
        throw new BadRequestError(`Unsupported LLM provider '${env.LLM_PROVIDER}' configured`);
    }
  }
}
