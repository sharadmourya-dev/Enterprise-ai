import { GoogleGenAI } from '@google/genai';
import { IEmbeddingProvider } from './embedding.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;
  public readonly dimensions = 768; // gemini-embedding-2 dimension (768)
  private aiClient: GoogleGenAI | null = null;

  constructor(modelName = env.GEMINI_EMBEDDING_MODEL) {
    this.modelName = modelName;
    if (env.GEMINI_API_KEY && !env.GEMINI_API_KEY.startsWith('your_')) {
      this.aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    }
  }

  public async embedText(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.aiClient) {
      throw new BadRequestError(
        'Gemini API key is not configured. Please set GEMINI_API_KEY in .env or switch LLM_PROVIDER.'
      );
    }

    try {
      const embeddings: number[][] = [];
      // Google API supports batch embedding calls; batch in chunks of 50
      const batchSize = 50;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        // Using models.embedContent from @google/genai with explicit outputDimensionality
        const response = await this.aiClient.models.embedContent({
          model: this.modelName,
          contents: batch.map((content) => ({
            role: 'user',
            parts: [{ text: content }],
          })),
          config: {
            outputDimensionality: this.dimensions,
          },
        });

        const res = response as any;
        if (Array.isArray(res.embeddings)) {
          for (const item of res.embeddings) {
            if (item.values) {
              embeddings.push(item.values);
            }
          }
        } else if (res.embedding?.values) {
          embeddings.push(res.embedding.values);
        }
      }

      if (embeddings.length !== texts.length) {
        throw new Error(
          `Embedding batch count mismatch: expected ${texts.length}, received ${embeddings.length}`
        );
      }

      // Runtime vector dimension verification
      for (let i = 0; i < embeddings.length; i++) {
        const vec = embeddings[i];
        if (!Array.isArray(vec) || vec.length !== this.dimensions) {
          throw new BadRequestError(
            `Gemini embedding response dimension mismatch for item ${i}: expected ${this.dimensions}, received ${vec?.length ?? 'invalid'}`
          );
        }
      }

      return embeddings;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Gemini embedding generation error', { error: errMsg, model: this.modelName });
      throw new BadRequestError(`Failed to generate embeddings via Gemini: ${errMsg}`);
    }
  }
}
