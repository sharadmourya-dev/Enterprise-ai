import { FallbackLlmProvider } from '../src/services/llm/fallback.llm.js';
import { ILlmProvider, ILlmGenerateResult } from '../src/services/llm/llm.interface.js';
import {
  BadRequestError,
  ServiceUnavailableError,
} from '../src/utils/errors.js';

describe('Resilient LLM Model Fallback & Deadline Enforcement', () => {
  const primaryModel = 'gemini-3.8-flash';
  const fallbackModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

  // Helper to create mock provider with programmable responses per model
  function createMockProviderFactory(
    handlers: Record<string, (prompt: string) => Promise<ILlmGenerateResult>>
  ) {
    const callCounts: Record<string, number> = {};

    const factory = (modelName: string): ILlmProvider => {
      return {
        providerName: 'gemini',
        modelName,
        generateText: async (prompt: string) => {
          callCounts[modelName] = (callCounts[modelName] || 0) + 1;
          const handler = handlers[modelName];
          if (!handler) {
            throw new Error(`No mock handler configured for model: ${modelName}`);
          }
          return handler(prompt);
        },
      };
    };

    return { factory, callCounts };
  }

  it('1. Primary model success: Returns primary result immediately without invoking fallback models', async () => {
    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => ({
        text: 'Primary answer [S1]',
        promptTokens: 25,
        completionTokens: 10,
        model: primaryModel,
      }),
      'gemini-3.5-flash-lite': async () => ({
        text: 'Fallback answer [S1]',
        promptTokens: 25,
        completionTokens: 10,
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 1 }
    );

    const result = await fallbackProvider.generateText('Policy query');

    expect(result.text).toBe('Primary answer [S1]');
    expect(result.model).toBe(primaryModel);
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBeUndefined();
    expect(callCounts['gemini-3.5-flash']).toBeUndefined();
  });

  it('2. Primary transient failure (503 UNAVAILABLE) followed by fallback success', async () => {
    const highDemandError = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.',
          status: 'UNAVAILABLE',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw highDemandError;
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Fallback 3.5 Lite grounded response [S1]',
        promptTokens: 30,
        completionTokens: 15,
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 0 }
    );

    const result = await fallbackProvider.generateText('Query during high demand');

    expect(result.text).toBe('Fallback 3.5 Lite grounded response [S1]');
    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1);
  });

  it('3. Rate-limit (429) quota exhaustion: Immediately advances to next candidate model without futile retries', async () => {
    const quotaExceededError = new Error(
      JSON.stringify({
        error: {
          code: 429,
          message:
            'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash. Please retry in 20h.',
          status: 'RESOURCE_EXHAUSTED',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw quotaExceededError;
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Response from unexhausted fallback model [S1]',
        promptTokens: 20,
        completionTokens: 10,
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 2 }
    );

    const result = await fallbackProvider.generateText('Query with exhausted primary quota');

    expect(result.text).toBe('Response from unexhausted fallback model [S1]');
    expect(result.model).toBe('gemini-3.5-flash-lite');
    // Must NOT retry gemini-3.8-flash 2 more times when quota is exhausted
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1);
  });

  it('3b. Generic HTTP 429 without quota keywords: Immediately advances to fallback without futile retries', async () => {
    const generic429Error = new Error(
      JSON.stringify({
        error: {
          code: 429,
          message: 'Too Many Requests',
          status: 'TOO_MANY_REQUESTS',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw generic429Error;
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Response from fallback model after generic 429 [S1]',
        promptTokens: 20,
        completionTokens: 10,
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 2 }
    );

    const result = await fallbackProvider.generateText('Query with generic 429');

    expect(result.text).toBe('Response from fallback model after generic 429 [S1]');
    expect(result.model).toBe('gemini-3.5-flash-lite');
    // Must NOT retry primary model 2 more times on any 429
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1);
  });

  it('3c. Primary candidate returning 404 (Not Found): Immediately falls back to next candidate without retrying primary, and succeeds', async () => {
    const notFoundError = new Error(
      JSON.stringify({
        error: {
          code: 404,
          message:
            'models/gemini-3.8-flash is not found for API version v1beta, or is not supported for generateContent.',
          status: 'NOT_FOUND',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw notFoundError;
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Response from fallback model after primary 404 [S1]',
        promptTokens: 20,
        completionTokens: 10,
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 2 }
    );

    const result = await fallbackProvider.generateText('Query with missing primary model');

    expect(result.text).toBe('Response from fallback model after primary 404 [S1]');
    expect(result.model).toBe('gemini-3.5-flash-lite');
    // Must NOT retry primary model when 404 Not Found is returned
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1);
  });

  it('3d. Fallback candidate returning 404 (Not Found): Skipped immediately and subsequent candidate succeeds', async () => {
    const primaryError = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: 'High demand spike on primary',
          status: 'UNAVAILABLE',
        },
      })
    );
    const candidate404Error = new Error(
      JSON.stringify({
        error: {
          code: 404,
          message: 'models/gemini-3.5-flash-lite is not found for API version v1beta',
          status: 'NOT_FOUND',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw primaryError;
      },
      'gemini-3.5-flash-lite': async () => {
        throw candidate404Error;
      },
      'gemini-3.5-flash': async () => ({
        text: 'Response from second fallback model [S1]',
        promptTokens: 22,
        completionTokens: 12,
        model: 'gemini-3.5-flash',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 2 }
    );

    const result = await fallbackProvider.generateText('Query where first fallback candidate is 404');

    expect(result.text).toBe('Response from second fallback model [S1]');
    expect(result.model).toBe('gemini-3.5-flash');
    expect(callCounts[primaryModel]).toBe(3); // 1 initial + 2 retries for 503
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1); // 404 must not be retried
    expect(callCounts['gemini-3.5-flash']).toBe(1); // Next candidate succeeds
    expect(callCounts['gemini-3.1-flash-lite']).toBeUndefined(); // Chain stops once candidate succeeds
  });

  it('4. Timeout on primary model: Fails over to fallback model which succeeds', async () => {
    const timeoutError = new Error('Gemini LLM request timed out after 500ms');

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw timeoutError;
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Fast response after primary timeout [S1]',
        promptTokens: 20,
        completionTokens: 10,
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 500, maxRetriesPerModel: 0 }
    );

    const result = await fallbackProvider.generateText('Query that timed out upstream');

    expect(result.text).toBe('Fast response after primary timeout [S1]');
    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1);
  });

  it('5. Non-transient error (401 Invalid Credentials): Fails fast immediately without trying fallbacks', async () => {
    const authError = new Error(
      JSON.stringify({
        error: {
          code: 401,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'UNAUTHENTICATED',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw authError;
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Should never be called',
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 2 }
    );

    await expect(fallbackProvider.generateText('Query with bad credentials')).rejects.toThrow();

    // Must NOT cycle through fallback models on permanent credential errors
    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBeUndefined();
    expect(callCounts['gemini-3.5-flash']).toBeUndefined();
  });

  it('5b. Fallback candidate returning 401 (Invalid Credentials): Stops chain immediately and does not call subsequent candidates', async () => {
    const transientError = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: 'High demand spike on primary',
          status: 'UNAVAILABLE',
        },
      })
    );
    const authError = new Error(
      JSON.stringify({
        error: {
          code: 401,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'UNAUTHENTICATED',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw transientError;
      },
      'gemini-3.5-flash-lite': async () => {
        throw authError;
      },
      'gemini-3.5-flash': async () => ({
        text: 'Should never be reached after 401',
        model: 'gemini-3.5-flash',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 0 }
    );

    await expect(fallbackProvider.generateText('Query where fallback candidate returns 401')).rejects.toThrow();

    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBe(1);
    expect(callCounts['gemini-3.5-flash']).toBeUndefined();
    expect(callCounts['gemini-3.1-flash-lite']).toBeUndefined();
  });

  it('6. All models fail: Throws structured ServiceUnavailableError with clear, retryable message', async () => {
    const serverError = new Error(
      JSON.stringify({
        error: {
          code: 500,
          message: 'Internal server error occurred at Google endpoint.',
          status: 'INTERNAL_ERROR',
        },
      })
    );

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        throw serverError;
      },
      'gemini-3.5-flash-lite': async () => {
        throw serverError;
      },
      'gemini-3.5-flash': async () => {
        throw serverError;
      },
      'gemini-3.1-flash-lite': async () => {
        throw serverError;
      },
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 2000, maxRetriesPerModel: 0 }
    );

    await expect(fallbackProvider.generateText('Query when all upstream is down')).rejects.toThrow(
      ServiceUnavailableError
    );

    await expect(fallbackProvider.generateText('Query when all upstream is down')).rejects.toThrow(
      /The AI service is temporarily unavailable\. We tried the available models but could not complete your request\. Please try again shortly\./
    );

    // Every candidate model should have been attempted once
    expect(callCounts[primaryModel]).toBeGreaterThanOrEqual(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBeGreaterThanOrEqual(1);
  });

  it('7. Overall deadline enforcement: Halts candidate traversal when remaining deadline is exhausted', async () => {
    let callIndex = 0;
    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        // Burn 150ms
        await new Promise((resolve) => setTimeout(resolve, 150));
        throw new Error(JSON.stringify({ error: { code: 503, message: 'Unavailable', status: 'UNAVAILABLE' } }));
      },
      'gemini-3.5-flash-lite': async () => {
        // Burn 150ms
        await new Promise((resolve) => setTimeout(resolve, 150));
        throw new Error(JSON.stringify({ error: { code: 503, message: 'Unavailable', status: 'UNAVAILABLE' } }));
      },
      'gemini-3.5-flash': async () => ({
        text: 'Should not run if deadline expired',
        model: 'gemini-3.5-flash',
      }),
    });

    // Tight deadline of 200ms
    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
      factory,
      { overallDeadlineMs: 200, attemptTimeoutMs: 200, maxRetriesPerModel: 0 }
    );

    await expect(fallbackProvider.generateText('Query with tight deadline')).rejects.toThrow(
      ServiceUnavailableError
    );

    // Third model should NOT have been called because 200ms expired
    expect(callCounts['gemini-3.5-flash']).toBeUndefined();
  });

  it('8. Client AbortSignal: Immediately halts without attempting remaining fallback models', async () => {
    const controller = new AbortController();

    const { factory, callCounts } = createMockProviderFactory({
      [primaryModel]: async () => {
        controller.abort();
        throw new BadRequestError('LLM generation request aborted by client');
      },
      'gemini-3.5-flash-lite': async () => ({
        text: 'Should not run after abort',
        model: 'gemini-3.5-flash-lite',
      }),
    });

    const fallbackProvider = new FallbackLlmProvider(
      'gemini',
      primaryModel,
      fallbackModels,
      factory,
      { overallDeadlineMs: 10000, attemptTimeoutMs: 3000, maxRetriesPerModel: 1 }
    );

    await expect(
      fallbackProvider.generateText('Query with cancellation', { abortSignal: controller.signal })
    ).rejects.toThrow(BadRequestError);

    expect(callCounts[primaryModel]).toBe(1);
    expect(callCounts['gemini-3.5-flash-lite']).toBeUndefined();
  });
});
