import { IEmbeddingProvider } from './embedding.interface.js';
import { GeminiEmbeddingProvider } from './gemini.embedding.js';
import { OpenAIEmbeddingProvider } from './openai.embedding.js';
import { MockEmbeddingProvider } from './mock.embedding.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';

export class EmbeddingFactory {
  private static customProvider: IEmbeddingProvider | null = null;

  /**
   * Overrides active provider (for deterministic unit/integration testing)
   */
  public static setProvider(provider: IEmbeddingProvider | null): void {
    this.customProvider = provider;
  }

  /**
   * Retrieves the active embedding provider based on configuration or test override
   */
  public static getProvider(): IEmbeddingProvider {
    if (this.customProvider) {
      return this.customProvider;
    }

    if (env.NODE_ENV === 'test') {
      // In test mode without custom override, default to MockEmbeddingProvider
      return new MockEmbeddingProvider(768);
    }

    switch (env.LLM_PROVIDER) {
      case 'gemini':
        return new GeminiEmbeddingProvider();
      case 'openai':
        return new OpenAIEmbeddingProvider();
      default:
        throw new BadRequestError(`Unsupported LLM provider '${env.LLM_PROVIDER}' configured`);
    }
  }

  /**
   * Returns expected vector dimensions for active provider
   */
  public static getExpectedDimensions(): number {
    return this.getProvider().dimensions;
  }
}
