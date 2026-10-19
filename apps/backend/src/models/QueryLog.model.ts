import mongoose, { Schema, Document } from 'mongoose';

export interface IQueryLogEntity extends Document {
  userId: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId;
  messageId?: mongoose.Types.ObjectId;
  rawQuery: string;
  expandedQuery?: string;
  retrievalParams: {
    topK: number;
    similarityThreshold: number;
    filters?: Record<string, unknown>;
  };
  retrievedChunkIds: mongoose.Types.ObjectId[];
  timings: {
    embeddingMs?: number;
    vectorSearchMs?: number;
    rerankMs?: number;
    llmFirstTokenMs?: number;
    totalDurationMs: number;
  };
  cacheHit: boolean;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
  status: 'success' | 'filtered_empty' | 'rate_limited' | 'error';
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const QueryLogSchema = new Schema<IQueryLogEntity>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
    },
    rawQuery: {
      type: String,
      required: [true, 'Raw query string is required'],
    },
    expandedQuery: {
      type: String,
    },
    retrievalParams: {
      topK: { type: Number, default: 5 },
      similarityThreshold: { type: Number, default: 0.65 },
      filters: { type: Schema.Types.Mixed },
    },
    retrievedChunkIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'DocumentChunk' }],
      default: [],
    },
    timings: {
      embeddingMs: { type: Number },
      vectorSearchMs: { type: Number },
      rerankMs: { type: Number },
      llmFirstTokenMs: { type: Number },
      totalDurationMs: { type: Number, required: true },
    },
    cacheHit: {
      type: Boolean,
      default: false,
    },
    tokenUsage: {
      promptTokens: { type: Number },
      completionTokens: { type: Number },
    },
    status: {
      type: String,
      enum: ['success', 'filtered_empty', 'rate_limited', 'error'],
      default: 'success',
      index: true,
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

QueryLogSchema.index({ createdAt: -1 });

export const QueryLogModel = mongoose.model<IQueryLogEntity>('QueryLog', QueryLogSchema);
