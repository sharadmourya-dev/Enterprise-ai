import crypto from 'crypto';
import { IEmbeddingProvider } from './embedding.interface.js';

export class MockEmbeddingProvider implements IEmbeddingProvider {
  public readonly providerName = 'mock';
  public readonly modelName = 'mock-embedding-v1';
  public readonly dimensions: number;

  constructor(dimensions = 768) {
    this.dimensions = dimensions;
  }

  public async embedText(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.generateDeterministicVector(t));
  }

  /**
   * Generates a deterministic L2-normalized float vector from input string
   */
  private generateDeterministicVector(text: string): number[] {
    const vector = new Array<number>(this.dimensions);
    // Hash text to produce reproducible seed
    const hash = crypto.createHash('sha256').update(text).digest();

    let sumSquares = 0;
    for (let i = 0; i < this.dimensions; i++) {
      // Generate pseudo-random float between -1.0 and 1.0 from byte stream
      const byteVal = hash[i % hash.length];
      const val = ((byteVal + (i * 31) % 256) / 128.0) - 1.0;
      vector[i] = val;
      sumSquares += val * val;
    }

    // L2 Normalize
    const norm = Math.sqrt(sumSquares) || 1.0;
    for (let i = 0; i < this.dimensions; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(6));
    }

    return vector;
  }
}
