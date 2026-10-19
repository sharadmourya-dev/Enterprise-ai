import mongoose from 'mongoose';
import {
  ICreateFeedbackRequest,
  IFeedback,
  FeedbackRating,
  FeedbackCategory,
  MessageSender,
  AuditAction,
  AuditResourceType,
  IJwtPayload,
} from '@enterprise-ai/shared-types';
import { FeedbackModel, IFeedbackEntity } from '../../models/Feedback.model.js';
import { ConversationModel } from '../../models/Conversation.model.js';
import { MessageModel } from '../../models/Message.model.js';
import { AuditService } from '../audit.service.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';

export class FeedbackService {
  /**
   * Formats a Mongoose Feedback document into the shared IFeedback contract
   */
  public static formatFeedback(doc: IFeedbackEntity): IFeedback {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      conversationId: doc.conversationId.toString(),
      messageId: doc.messageId.toString(),
      rating: doc.rating,
      category: doc.category,
      userComment: doc.userComment,
      reviewedByAdmin: doc.reviewedByAdmin,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /**
   * Submits or updates user feedback for an eligible completed assistant message
   */
  public static async submitFeedback(
    user: IJwtPayload,
    dto: ICreateFeedbackRequest,
    meta?: { ip?: string; userAgent?: string }
  ): Promise<IFeedback> {
    const { conversationId, messageId, rating, category, userComment } = dto;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestError('Invalid conversation ID format');
    }
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new BadRequestError('Invalid message ID format');
    }

    // 1. Verify conversation exists and belongs to the authenticated user (Anti-enumeration policy)
    const conversation = await ConversationModel.findOne({
      _id: new mongoose.Types.ObjectId(conversationId),
      userId: new mongoose.Types.ObjectId(user.sub),
      status: { $ne: 'deleted' },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    // 2. Verify message exists within this exact conversation
    const message = await MessageModel.findOne({
      _id: new mongoose.Types.ObjectId(messageId),
      conversationId: conversation._id,
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    // 3. Verify message eligibility: Must be a completed assistant response
    if (message.sender !== MessageSender.ASSISTANT) {
      throw new BadRequestError('Feedback can only be submitted on assistant responses');
    }

    if (message.status !== 'completed') {
      throw new BadRequestError('Feedback can only be submitted on completed assistant responses');
    }

    // 4. Default category based on rating if not specified
    const finalCategory =
      category ||
      (rating === FeedbackRating.THUMBS_UP
        ? FeedbackCategory.ACCURATE_HELPFUL
        : FeedbackCategory.OTHER);

    // 5. Atomic Upsert: Update existing feedback if already submitted, or create if new
    const feedbackDoc = await FeedbackModel.findOneAndUpdate(
      {
        messageId: message._id,
        userId: new mongoose.Types.ObjectId(user.sub),
      },
      {
        $set: {
          conversationId: conversation._id,
          rating,
          category: finalCategory,
          userComment: userComment !== undefined ? userComment.trim() : undefined,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // 6. Audit log entry for feedback submission (safe, non-blocking)
    await AuditService.log({
      userId: user.sub,
      action: AuditAction.RAG_QUERY, // Recorded as telemetry on generated output
      resourceType: AuditResourceType.CONVERSATION,
      resourceId: message._id.toString(),
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
      status: 'success',
      details: {
        feedbackId: feedbackDoc._id.toString(),
        rating,
        category: finalCategory,
        hasComment: Boolean(userComment && userComment.trim().length > 0),
      },
    });

    return this.formatFeedback(feedbackDoc);
  }

  /**
   * Retrieves an authenticated user's feedback for a specific message
   */
  public static async getFeedbackForMessage(
    user: IJwtPayload,
    messageId: string
  ): Promise<IFeedback | null> {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new BadRequestError('Invalid message ID format');
    }

    const doc = await FeedbackModel.findOne({
      messageId: new mongoose.Types.ObjectId(messageId),
      userId: new mongoose.Types.ObjectId(user.sub),
    });

    if (!doc) {
      return null;
    }

    return this.formatFeedback(doc);
  }
}
