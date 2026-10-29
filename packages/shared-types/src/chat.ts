export enum MessageSender {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export enum LlmProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
}

export interface IChunkCitation {
  chunkId: string;
  documentId: string;
  title: string;
  pageNumber?: number;
  snippet: string;
  relevanceScore: number;
}

export interface ITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type MessageStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface IMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  content: string;
  status?: MessageStatus;
  citations?: IChunkCitation[];
  tokensUsed?: ITokenUsage;
  latencyMs?: number;
  modelProvider?: LlmProvider;
  modelName?: string;
  idempotencyKey?: string;
  requestId?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface IConversation {
  id: string;
  userId: string;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  selectedModelProvider: LlmProvider;
  selectedModelName: string;
  systemPromptOverride?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateConversationRequest {
  title?: string;
  selectedModelProvider?: LlmProvider;
  selectedModelName?: string;
  systemPromptOverride?: string;
}

export interface IUpdateConversationRequest {
  title: string;
}

export interface IConversationListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface IConversationListResponse {
  conversations: IConversation[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ISendMessageRequest {
  content: string;
  idempotencyKey?: string;
}

export interface ISendMessageResponse {
  userMessage: IMessage;
  assistantMessage: IMessage;
}

/**
 * Server-Sent Event (SSE) Stream Messages emitted during LLM response generation
 */
export type SSEEventType =
  | 'token'
  | 'citations'
  | 'metadata'
  | 'error'
  | 'done'
  | 'message.started'
  | 'message.progress'
  | 'message.delta'
  | 'message.citations'
  | 'message.completed'
  | 'message.error';

export interface ISSETokenEvent {
  type: 'token';
  delta: string;
}

export interface ISSECitationsEvent {
  type: 'citations';
  citations: IChunkCitation[];
}

export interface ISSEMetadataEvent {
  type: 'metadata';
  messageId: string;
  latencyMs: number;
  tokensUsed: ITokenUsage;
  modelProvider: string;
  modelName: string;
}

export interface ISSEErrorEvent {
  type: 'error';
  error: {
    code: string;
    message: string;
  };
}

export interface ISSEDoneEvent {
  type: 'done';
}

export interface ISSEMessageStartedPayload {
  conversationId: string;
  messageId: string;
}

export interface ISSEMessageProgressPayload {
  stage: 'retrieving' | 'generating' | 'validating';
  progress?: number;
  message?: string;
}

export interface ISSEMessageDeltaPayload {
  content: string;
}

export interface ISSEMessageCitationsPayload {
  citations: IChunkCitation[];
}

export interface ISSEMessageCompletedPayload {
  messageId: string;
  tokensUsed?: ITokenUsage;
  latencyMs?: number;
  modelProvider?: string;
  modelName?: string;
}

export interface ISSEMessageErrorPayload {
  code: string;
  message: string;
}

export type ISSEPayload =
  | ISSETokenEvent
  | ISSECitationsEvent
  | ISSEMetadataEvent
  | ISSEErrorEvent
  | ISSEDoneEvent
  | { type: 'message.started'; data: ISSEMessageStartedPayload }
  | { type: 'message.progress'; data: ISSEMessageProgressPayload }
  | { type: 'message.delta'; data: ISSEMessageDeltaPayload }
  | { type: 'message.citations'; data: ISSEMessageCitationsPayload }
  | { type: 'message.completed'; data: ISSEMessageCompletedPayload }
  | { type: 'message.error'; data: ISSEMessageErrorPayload };
