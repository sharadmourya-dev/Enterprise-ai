import mongoose, { Schema, Document } from 'mongoose';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';

export interface IUserDocument extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  department: string;
  securityClearance: ClearanceLevel;
  permissions: string[];
  isActive: boolean;
  refreshTokenHash?: string | null;
  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: Date | null;
  tokenVersion: number;
  failedLoginAttempts: number;
  lockoutUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: Object.values(Role),
      default: Role.USER,
      index: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
      index: true,
    },
    securityClearance: {
      type: String,
      enum: Object.values(ClearanceLevel),
      default: ClearanceLevel.INTERNAL,
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshTokenHash: {
      type: String,
      default: null,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
      index: true,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockoutUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ department: 1, securityClearance: 1 });

export const UserModel = mongoose.model<IUserDocument>('User', UserSchema);
