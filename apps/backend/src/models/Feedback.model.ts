import mongoose, { Schema, Document } from 'mongoose';
import { FeedbackRating, FeedbackCategory } from '@enterprise-ai/shared-types';

export interface IFeedbackEntity extends Document {
  userId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  messageId: mongoose.Types.ObjectId;
  rating: FeedbackRating;
  category: FeedbackCategory;
  userComment?: string;
  reviewedByAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackSchema = new Schema<IFeedbackEntity>(
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
      required: [true, 'Conversation ID is required'],
      index: true,
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: [true, 'Message ID is required'],
      index: true,
    },
    rating: {
      type: String,
      enum: Object.values(FeedbackRating),
      required: [true, 'Rating is required'],
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(FeedbackCategory),
      default: FeedbackCategory.OTHER,
    },
    userComment: {
      type: String,
      trim: true,
    },
    reviewedByAdmin: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

FeedbackSchema.index({ messageId: 1, userId: 1 }, { unique: true });

export const FeedbackModel = mongoose.model<IFeedbackEntity>('Feedback', FeedbackSchema);
