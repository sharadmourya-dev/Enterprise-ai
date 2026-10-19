import mongoose, { Schema, Document } from 'mongoose';
import { LlmProvider } from '@enterprise-ai/shared-types';

export interface IConversationEntity extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  selectedModelProvider: LlmProvider;
  selectedModelName: string;
  systemPromptOverride?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversationEntity>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    title: {
      type: String,
      default: 'New Conversation',
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'archived', 'deleted'],
      default: 'active',
      index: true,
    },
    selectedModelProvider: {
      type: String,
      enum: Object.values(LlmProvider),
      default: LlmProvider.GEMINI,
    },
    selectedModelName: {
      type: String,
      default: 'gemini-1.5-pro',
    },
    systemPromptOverride: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

ConversationSchema.index({ userId: 1, updatedAt: -1 });

export const ConversationModel = mongoose.model<IConversationEntity>('Conversation', ConversationSchema);
