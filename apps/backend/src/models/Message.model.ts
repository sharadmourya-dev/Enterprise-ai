import mongoose, { Schema, Document } from 'mongoose';
import { MessageSender, LlmProvider, IChunkCitation, ITokenUsage } from '@enterprise-ai/shared-types';

export interface IMessageEntity extends Document {
  conversationId: mongoose.Types.ObjectId;
  sender: MessageSender;
  content: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  citations: IChunkCitation[];
  tokensUsed?: ITokenUsage;
  latencyMs?: number;
  modelProvider?: LlmProvider;
  modelName?: string;
  queryLogId?: mongoose.Types.ObjectId | null;
  idempotencyKey?: string | null;
  requestId?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CitationSchema = new Schema(
  {
    chunkId: { type: Schema.Types.Mixed, required: true },
    documentId: { type: Schema.Types.Mixed, required: true },
    title: { type: String },
    source: { type: String },
    evidenceId: { type: String },
    revision: { type: Number },
    page: { type: Number },
    pageNumber: { type: Number },
    snippet: { type: String },
    relevanceScore: { type: Number },
  },
  { _id: false }
);

const TokenUsageSchema = new Schema(
  {
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessageEntity>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'Conversation ID is required'],
      index: true,
    },
    sender: {
      type: String,
      enum: Object.values(MessageSender),
      required: [true, 'Message sender is required'],
    },
    content: {
      type: String,
      required: [true, 'Message content is required'],
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'completed',
      index: true,
    },
    citations: {
      type: [CitationSchema],
      default: [],
    },
    tokensUsed: {
      type: TokenUsageSchema,
    },
    latencyMs: {
      type: Number,
    },
    modelProvider: {
      type: String,
      enum: Object.values(LlmProvider),
    },
    modelName: {
      type: String,
    },
    queryLogId: {
      type: Schema.Types.ObjectId,
      ref: 'QueryLog',
      default: null,
    },
    idempotencyKey: {
      type: String,
      default: undefined,
    },
    requestId: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index(
  { conversationId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

export const MessageModel = mongoose.model<IMessageEntity>('Message', MessageSchema);
