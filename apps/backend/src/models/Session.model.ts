import mongoose, { Schema, Document } from 'mongoose';

export interface ISessionEntity extends Document {
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  refreshTokenHash: string;
  previousTokenHash?: string | null;
  rotationGraceUntil?: Date | null;
  encryptedActiveRefreshToken?: string | null;
  activeAccessToken?: string | null;
  tokenVersion: number;
  userAgent?: string;
  ipAddress?: string;
  isRevoked: boolean;
  revokedReason?: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISessionEntity>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      index: true,
    },
    previousTokenHash: {
      type: String,
      default: null,
    },
    rotationGraceUntil: {
      type: Date,
      default: null,
    },
    encryptedActiveRefreshToken: {
      type: String,
      default: null,
    },
    activeAccessToken: {
      type: String,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    userAgent: {
      type: String,
      default: 'unknown',
    },
    ipAddress: {
      type: String,
      default: 'unknown',
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    revokedReason: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index for automatic expiration cleanup
    },
  },
  {
    timestamps: true,
  }
);

SessionSchema.index({ userId: 1, isRevoked: 1 });

export const SessionModel = mongoose.model<ISessionEntity>('Session', SessionSchema);
