import { ILlmProvider, ILlmGenerateOptions, ILlmGenerateResult } from './llm.interface.js';

export type MockGenerateHandler = (
  prompt: string,
  options?: ILlmGenerateOptions
) => Promise<ILlmGenerateResult> | ILlmGenerateResult;

export class MockLlmProvider implements ILlmProvider {
  public readonly providerName = 'mock';
  public readonly modelName = 'mock-llm-v1';

  private customHandler: MockGenerateHandler | null = null;
  private cannedResponse: string | null = null;
  private simulateError: Error | null = null;

  constructor(defaultCannedResponse?: string) {
    if (defaultCannedResponse) {
      this.cannedResponse = defaultCannedResponse;
    }
  }

  public setCannedResponse(response: string | null): void {
    this.cannedResponse = response;
  }

  public setHandler(handler: MockGenerateHandler | null): void {
    this.customHandler = handler;
  }

  public setSimulateError(error: Error | null): void {
    this.simulateError = error;
  }

  public async generateText(
    prompt: string,
    options?: ILlmGenerateOptions
  ): Promise<ILlmGenerateResult> {
    if (options?.abortSignal?.aborted) {
      throw new Error('LLM generation request aborted by client');
    }

    if (this.simulateError) {
      throw this.simulateError;
    }

    if (this.customHandler) {
      return this.customHandler(prompt, options);
    }

    if (this.cannedResponse !== null) {
      return {
        text: this.cannedResponse,
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(this.cannedResponse.length / 4),
        model: this.modelName,
      };
    }

    // Query rewriting prompt handling in mock
    if (
      options?.systemInstruction?.includes('query formulation') ||
      prompt.includes('STANDALONE SEARCH QUERY')
    ) {
      const questionMatch = prompt.match(/LATEST USER FOLLOW-UP QUESTION:\s*([^\n\r]+)/i);
      const question = questionMatch ? questionMatch[1].trim() : prompt.trim();

      if (/contractor/i.test(question) && /leave policy/i.test(prompt)) {
        const text = 'What is the annual leave policy for contractors?';
        return {
          text,
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(text.length / 4),
          model: this.modelName,
        };
      }

      return {
        text: question,
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(question.length / 4),
        model: this.modelName,
      };
    }

    // Default deterministic synthesis based on prompt evidence
    const evidenceMatches = prompt.match(/\[S\d+\]/g);
    if (!evidenceMatches || evidenceMatches.length === 0) {
      const fallbackText =
        'I do not have sufficient information in the provided documentation to answer this question.';
      return {
        text: fallbackText,
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(fallbackText.length / 4),
        model: this.modelName,
      };
    }

    // Unique evidence references in order
    const uniqueEvidences = Array.from(new Set(evidenceMatches));
    const evidenceCitations = uniqueEvidences.join(' ');
    const generatedText = `Based on the provided documentation, the enterprise standards require compliance with the documented protocol ${evidenceCitations}.`;

    return {
      text: generatedText,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: Math.ceil(generatedText.length / 4),
      model: this.modelName,
    };
  }
}
