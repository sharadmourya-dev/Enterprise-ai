export interface IEmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimensions: number;

  /**
   * Generates a normalized vector embedding for a single text chunk
   */
  embedText(text: string): Promise<number[]>;

  /**
   * Generates normalized vector embeddings for a batch of text chunks
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}
