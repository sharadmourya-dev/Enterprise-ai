import { LlmFactory } from '../src/services/llm/llm.factory.js';
import { GeminiLlmProvider, parseProviderError } from '../src/services/llm/gemini.llm.js';
import { OpenAILlmProvider } from '../src/services/llm/openai.llm.js';
import { MockLlmProvider } from '../src/services/llm/mock.llm.js';
import { env } from '../src/config/env.js';
import {
  BadRequestError,
  ServiceUnavailableError,
  BadGatewayError,
} from '../src/utils/errors.js';

describe('LLM Provider Abstraction & Model Configuration Tests', () => {
  afterEach(() => {
    LlmFactory.setProvider(null);
  });

  describe('LlmFactory Configuration & Provider Selection', () => {
    it('1. Defaults to MockLlmProvider in test environment without live credentials', () => {
      const provider = LlmFactory.getProvider();
      expect(provider).toBeInstanceOf(MockLlmProvider);
      expect(provider.providerName).toBe('mock');
    });

    it('2. Supports injecting custom provider override for testing', () => {
      const customMock = new MockLlmProvider('Custom canned answer');
      LlmFactory.setProvider(customMock);

      const active = LlmFactory.getProvider();
      expect(active).toBe(customMock);
    });

    it('3. Reverts to default provider when custom override is cleared with null', () => {
      const customMock = new MockLlmProvider('Temporary override');
      LlmFactory.setProvider(customMock);
      expect(LlmFactory.getProvider()).toBe(customMock);

      LlmFactory.setProvider(null);
      expect(LlmFactory.getProvider()).toBeInstanceOf(MockLlmProvider);
    });
  });

  describe('GeminiLlmProvider Model Configuration & SDK Parameters', () => {
    it('4. Uses configured GEMINI_MODEL default (gemini-3.8-flash) and accepts custom model in constructor', () => {
      const defaultProvider = new GeminiLlmProvider();
      expect(defaultProvider.modelName).toBe(env.GEMINI_MODEL);
      expect(defaultProvider.modelName).toBe('gemini-3.8-flash');

      const customProvider = new GeminiLlmProvider('gemini-2.5-pro');
      expect(customProvider.modelName).toBe('gemini-2.5-pro');
    });

    it('5. Passes configured modelName and options to @google/genai SDK generateContent with sampling parameters omitted for Gemini 3.8', async () => {
      const provider = new GeminiLlmProvider('gemini-3.8-flash');
      const mockGenerateContent = jest.fn().mockResolvedValue({
        text: 'Generated enterprise answer [S1].',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
      });

      // Inject mocked client to verify request parameters without live API calls
      (provider as any).aiClient = {
        models: { generateContent: mockGenerateContent },
      };

      const result = await provider.generateText('User question', {
        systemInstruction: 'You are an AI assistant',
        temperature: 0.1,
        maxTokens: 512,
      });

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-3.8-flash',
        contents: 'User question',
        config: {
          systemInstruction: 'You are an AI assistant',
          maxOutputTokens: 512,
        },
      });

      const passedConfig = mockGenerateContent.mock.calls[0][0].config;
      expect(passedConfig).not.toHaveProperty('temperature');
      expect(passedConfig).not.toHaveProperty('top_p');
      expect(passedConfig).not.toHaveProperty('top_k');

      expect(result.text).toBe('Generated enterprise answer [S1].');
      expect(result.promptTokens).toBe(50);
      expect(result.completionTokens).toBe(20);
      expect(result.model).toBe('gemini-3.8-flash');
    });

    it('5b. Preserves temperature for older Gemini models (e.g. gemini-2.5-flash) while omitting it for Gemini 3+', () => {
      const olderProvider = new GeminiLlmProvider('gemini-2.5-flash');
      const olderConfig = olderProvider.buildGenerateConfig({
        temperature: 0.1,
        maxTokens: 512,
      });
      expect(olderConfig).toEqual({
        temperature: 0.1,
        maxOutputTokens: 512,
      });

      const gemini3Provider = new GeminiLlmProvider('gemini-3.8-flash');
      const gemini3Config = gemini3Provider.buildGenerateConfig({
        temperature: 0.1,
        maxTokens: 512,
      });
      expect(gemini3Config).toEqual({
        maxOutputTokens: 512,
      });
      expect(gemini3Config).not.toHaveProperty('temperature');
    });

    it('6. Throws clear, sanitized error when Gemini API key is missing or placeholder', async () => {
      const provider = new GeminiLlmProvider();
      // Ensure aiClient is null (unconfigured)
      (provider as any).aiClient = null;

      await expect(provider.generateText('test prompt')).rejects.toThrow(BadRequestError);
      await expect(provider.generateText('test prompt')).rejects.toThrow(
        /Gemini API key is not configured/
      );
    });

    it('6b. Retries and recovers from transient Google Gemini 503 "high demand" error', async () => {
      const provider = new GeminiLlmProvider('gemini-3.8-flash');
      const highDemandError = new Error(
        JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
            status: 'UNAVAILABLE',
          },
        })
      );

      const mockGenerateContent = jest
        .fn()
        .mockRejectedValueOnce(highDemandError)
        .mockResolvedValueOnce({
          text: 'Answer generated after retry [S1].',
          usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 15 },
        });

      (provider as any).aiClient = {
        models: { generateContent: mockGenerateContent },
      };

      const result = await provider.generateText('Policy question', {
        initialRetryDelayMs: 10,
        maxRetries: 2,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('Answer generated after retry [S1].');
      expect(result.promptTokens).toBe(40);
      expect(result.completionTokens).toBe(15);
    });

    it('6c. Retries and recovers from transient Google Gemini 429 rate limit error', async () => {
      const provider = new GeminiLlmProvider('gemini-3.8-flash');
      const rateLimitError = new Error(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Resource has been exhausted (e.g. check quota).',
            status: 'RESOURCE_EXHAUSTED',
          },
        })
      );

      const mockGenerateContent = jest
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: 'Answer generated after rate limit backoff.',
        });

      (provider as any).aiClient = {
        models: { generateContent: mockGenerateContent },
      };

      const result = await provider.generateText('Test question', {
        initialRetryDelayMs: 10,
        maxRetries: 2,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('Answer generated after rate limit backoff.');
    });

    it('6d. Fails immediately without retry on non-transient client error (e.g. 400 INVALID_ARGUMENT)', async () => {
      const provider = new GeminiLlmProvider('gemini-3.8-flash');
      const clientError = new Error(
        JSON.stringify({
          error: {
            code: 400,
            message: 'Invalid argument provided in request config.',
            status: 'INVALID_ARGUMENT',
          },
        })
      );

      const mockGenerateContent = jest.fn().mockRejectedValue(clientError);
      (provider as any).aiClient = {
        models: { generateContent: mockGenerateContent },
      };

      await expect(
        provider.generateText('Test question', { initialRetryDelayMs: 10, maxRetries: 3 })
      ).rejects.toThrow(BadRequestError);

      // Must NOT retry on 400
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('6e. Throws ServiceUnavailableError (503) when transient failure persists after exhausting maxRetries', async () => {
      const provider = new GeminiLlmProvider('gemini-3.8-flash');
      const highDemandError = new Error(
        JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand.',
            status: 'UNAVAILABLE',
          },
        })
      );

      const mockGenerateContent = jest.fn().mockRejectedValue(highDemandError);
      (provider as any).aiClient = {
        models: { generateContent: mockGenerateContent },
      };

      await expect(
        provider.generateText('Test question', { initialRetryDelayMs: 10, maxRetries: 2 })
      ).rejects.toThrow(ServiceUnavailableError);

      // Initial attempt + 2 retries = 3 attempts
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });

    it('6f. parseProviderError extracts structured diagnostics and redacts credentials', () => {
      const errorWithKey = new Error(
        'Request failed at endpoint https://generativelanguage.googleapis.com?key=AIzaSySecretApiKey123: 503 High Demand'
      );
      const parsed = parseProviderError(errorWithKey);

      expect(parsed.isTransient).toBe(true);
      expect(parsed.safeMessage).not.toContain('AIzaSySecretApiKey123');
      expect(parsed.safeMessage).toContain('key=[REDACTED]');
    });
  });

  describe('OpenAILlmProvider Model Configuration & SDK Parameters', () => {
    it('7. Uses configured OPENAI_MODEL default (gpt-4o-mini) and accepts custom model in constructor', () => {
      const defaultProvider = new OpenAILlmProvider();
      expect(defaultProvider.modelName).toBe(env.OPENAI_MODEL);
      expect(defaultProvider.modelName).toBe('gpt-4o-mini');

      const customProvider = new OpenAILlmProvider('gpt-4o');
      expect(customProvider.modelName).toBe('gpt-4o');
    });

    it('8. Passes configured modelName and options to openai chat.completions.create for standard models', async () => {
      const provider = new OpenAILlmProvider('gpt-4o-mini');
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Verified response [S1].' } }],
        usage: { prompt_tokens: 60, completion_tokens: 15 },
      });

      (provider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await provider.generateText('User question', {
        systemInstruction: 'System rules',
        temperature: 0.3,
        maxTokens: 256,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'System rules' },
            { role: 'user', content: 'User question' },
          ],
          temperature: 0.3,
          max_tokens: 256,
        },
        { timeout: 30000 }
      );

      expect(result.text).toBe('Verified response [S1].');
      expect(result.promptTokens).toBe(60);
      expect(result.completionTokens).toBe(15);
      expect(result.model).toBe('gpt-4o-mini');
    });

    it('8b. Automatically uses max_completion_tokens and omits temperature for o-series reasoning models', async () => {
      const reasoningProvider = new OpenAILlmProvider('o3-mini');
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Reasoning model answer [S1].' } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
      });

      (reasoningProvider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      await reasoningProvider.generateText('Complex query', {
        systemInstruction: 'Reasoning guidelines',
        temperature: 0.2,
        maxTokens: 500,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'o3-mini',
          messages: [
            { role: 'system', content: 'Reasoning guidelines' },
            { role: 'user', content: 'Complex query' },
          ],
          // temperature must be omitted for o-series reasoning models
          max_completion_tokens: 500,
        },
        { timeout: 30000 }
      );
    });

    it('9. Throws clear, sanitized error when OpenAI API key is missing or placeholder', async () => {
      const provider = new OpenAILlmProvider();
      (provider as any).client = null;

      await expect(provider.generateText('test prompt')).rejects.toThrow(BadRequestError);
      await expect(provider.generateText('test prompt')).rejects.toThrow(
        /OpenAI API key is not configured/
      );
    });
  });

  describe('MockLlmProvider Deterministic Behavior', () => {
    it('10. Extracts evidence references from prompt and generates deterministic citation tags', async () => {
      const mock = new MockLlmProvider();
      const prompt = 'Evidence block: [S1] and [S2]. Question: What is the policy?';
      const result = await mock.generateText(prompt);

      expect(result.text).toContain('[S1]');
      expect(result.text).toContain('[S2]');
      expect(result.model).toBe('mock-llm-v1');
    });

    it('11. Returns explicit insufficient evidence disclaimer when prompt contains no evidence tags', async () => {
      const mock = new MockLlmProvider();
      const prompt = 'No evidence tags here. Question: What is the secret?';
      const result = await mock.generateText(prompt);

      expect(result.text).toContain('I do not have sufficient information');
    });

    it('12. Simulates provider errors when configured', async () => {
      const mock = new MockLlmProvider();
      mock.setSimulateError(new Error('Simulated upstream 503 Service Unavailable'));

      await expect(mock.generateText('test')).rejects.toThrow(
        'Simulated upstream 503 Service Unavailable'
      );
    });
  });
});
