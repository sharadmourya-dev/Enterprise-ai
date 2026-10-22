export interface ILlmGenerateOptions {
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

export interface ILlmGenerateResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  model: string;
}

export interface ILlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateText(prompt: string, options?: ILlmGenerateOptions): Promise<ILlmGenerateResult>;
}
