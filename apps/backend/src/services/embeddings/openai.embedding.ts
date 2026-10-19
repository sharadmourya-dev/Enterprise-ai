import OpenAI from 'openai';
import { IEmbeddingProvider } from './embedding.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  public readonly providerName = 'openai';
  public readonly modelName: string;
  public readonly dimensions = 1536; // text-embedding-3-small dimension
  private client: OpenAI | null = null;

  constructor(modelName = env.OPENAI_EMBEDDING_MODEL) {
    this.modelName = modelName;
    if (env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('your_')) {
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
  }

  public async embedText(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new BadRequestError(
        'OpenAI API key is not configured. Please set OPENAI_API_KEY in .env or switch LLM_PROVIDER.'
      );
    }

    try {
      const embeddings: number[][] = [];
      const batchSize = 100;

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const response = await this.client.embeddings.create({
          model: this.modelName,
          input: batch,
        });

        for (const item of response.data) {
          embeddings.push(item.embedding);
        }
      }

      return embeddings;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('OpenAI embedding generation error', { error: errMsg, model: this.modelName });
      throw new BadRequestError(`Failed to generate embeddings via OpenAI: ${errMsg}`);
    }
  }
}
