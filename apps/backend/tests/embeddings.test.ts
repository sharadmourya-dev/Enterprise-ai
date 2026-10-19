import { MockEmbeddingProvider } from '../src/services/embeddings/mock.embedding.js';
import { EmbeddingFactory } from '../src/services/embeddings/embedding.factory.js';
import { GeminiEmbeddingProvider } from '../src/services/embeddings/gemini.embedding.js';
import { OpenAIEmbeddingProvider } from '../src/services/embeddings/openai.embedding.js';
import { BadRequestError } from '../src/utils/errors.js';

describe('Embedding Provider Abstraction Unit Tests', () => {
  afterEach(() => {
    EmbeddingFactory.setProvider(null);
  });

  describe('MockEmbeddingProvider', () => {
    it('1. Generates vectors of specified dimensions (768 and 1536)', async () => {
      const mock768 = new MockEmbeddingProvider(768);
      const mock1536 = new MockEmbeddingProvider(1536);

      const vec768 = await mock768.embedText('Enterprise document chunk');
      const vec1536 = await mock1536.embedText('Enterprise document chunk');

      expect(vec768).toHaveLength(768);
      expect(vec1536).toHaveLength(1536);
    });

    it('2. Produces deterministic vectors for identical input strings', async () => {
      const provider = new MockEmbeddingProvider(768);
      const text = 'Deterministic security clearance check';

      const vec1 = await provider.embedText(text);
      const vec2 = await provider.embedText(text);

      expect(vec1).toEqual(vec2);

      const differentVec = await provider.embedText('Completely different text input');
      expect(vec1).not.toEqual(differentVec);
    });

    it('3. Generates L2-normalized vectors (norm ≈ 1.0 for cosine similarity)', async () => {
      const provider = new MockEmbeddingProvider(768);
      const vec = await provider.embedText('Normalized vector check');

      const sumSquares = vec.reduce((acc, val) => acc + val * val, 0);
      const norm = Math.sqrt(sumSquares);

      expect(norm).toBeCloseTo(1.0, 3);
    });

    it('4. Embeds batch of texts returning exact count and matching dimensions', async () => {
      const provider = new MockEmbeddingProvider(768);
      const texts = ['Chunk A', 'Chunk B', 'Chunk C', 'Chunk D'];

      const batch = await provider.embedBatch(texts);

      expect(batch).toHaveLength(4);
      for (const vec of batch) {
        expect(vec).toHaveLength(768);
      }
    });
  });

  describe('EmbeddingFactory', () => {
    it('1. Defaults to MockEmbeddingProvider in test environment without live credentials', () => {
      const provider = EmbeddingFactory.getProvider();
      expect(provider.providerName).toBe('mock');
      expect(provider.dimensions).toBe(768);
      expect(EmbeddingFactory.getExpectedDimensions()).toBe(768);
    });

    it('2. Supports injecting custom provider for testing or isolation', async () => {
      const customMock = new MockEmbeddingProvider(1536);
      EmbeddingFactory.setProvider(customMock);

      const provider = EmbeddingFactory.getProvider();
      expect(provider.dimensions).toBe(1536);
      expect(EmbeddingFactory.getExpectedDimensions()).toBe(1536);
    });

    it('3. Throws descriptive error when Gemini/OpenAI is instantiated without API key', async () => {
      const geminiProvider = new GeminiEmbeddingProvider();
      expect(geminiProvider.modelName).toBe('gemini-embedding-2');
      expect(geminiProvider.dimensions).toBe(768);

      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.startsWith('your_')) {
        await expect(geminiProvider.embedText('test')).rejects.toThrow(BadRequestError);
        await expect(geminiProvider.embedText('test')).rejects.toThrow(/Gemini API key is not configured/);
      }

      const openaiProvider = new OpenAIEmbeddingProvider();
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('your_')) {
        await expect(openaiProvider.embedText('test')).rejects.toThrow(BadRequestError);
        await expect(openaiProvider.embedText('test')).rejects.toThrow(/OpenAI API key is not configured/);
      }
    });

    it('4. Gemini provider explicitly requests outputDimensionality: 768 in embedContent call', async () => {
      const geminiProvider = new GeminiEmbeddingProvider('gemini-embedding-2');
      const mockEmbedContent = jest.fn().mockResolvedValue({
        embeddings: [{ values: new Array(768).fill(0.05) }],
      });

      // Inject mock client to verify request parameters without external API calls
      (geminiProvider as any).aiClient = {
        models: { embedContent: mockEmbedContent },
      };

      const result = await geminiProvider.embedText('Sample enterprise knowledge text');

      expect(mockEmbedContent).toHaveBeenCalledWith({
        model: 'gemini-embedding-2',
        contents: [{ role: 'user', parts: [{ text: 'Sample enterprise knowledge text' }] }],
        config: { outputDimensionality: 768 },
      });
      expect(result).toHaveLength(768);
    });

    it('5. Gemini provider detects and rejects runtime vector dimension mismatch', async () => {
      const geminiProvider = new GeminiEmbeddingProvider('gemini-embedding-2');
      // Simulate Gemini returning 1536 dimensions instead of expected 768
      const mockEmbedContent = jest.fn().mockResolvedValue({
        embeddings: [{ values: new Array(1536).fill(0.01) }],
      });

      (geminiProvider as any).aiClient = {
        models: { embedContent: mockEmbedContent },
      };

      await expect(geminiProvider.embedText('Test text')).rejects.toThrow(BadRequestError);
      await expect(geminiProvider.embedText('Test text')).rejects.toThrow(
        /Gemini embedding response dimension mismatch for item 0: expected 768, received 1536/
      );
    });
  });
});
