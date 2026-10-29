import mongoose, { Schema, Document } from 'mongoose';
import { AuditAction, AuditResourceType } from '@enterprise-ai/shared-types';

export interface IAuditLogEntity extends Document {
  sequenceNumber: number;
  previousHash: string;
  userId?: mongoose.Types.ObjectId | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  ipAddress: string;
  userAgent: string;
  status: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
  tamperHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<IAuditLogEntity>(
  {
    sequenceNumber: {
      type: Number,
      required: [true, 'Monotonic sequence number is required'],
      unique: true,
      index: true,
    },
    previousHash: {
      type: String,
      required: [true, 'Previous record tamper hash link is required'],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    action: {
      type: String,
      enum: Object.values(AuditAction),
      required: [true, 'Audit action is required'],
      index: true,
    },
    resourceType: {
      type: String,
      enum: Object.values(AuditResourceType),
      required: [true, 'Resource type is required'],
      index: true,
    },
    resourceId: {
      type: String,
      required: [true, 'Resource ID is required'],
    },
    ipAddress: {
      type: String,
      default: 'unknown',
    },
    userAgent: {
      type: String,
      default: 'unknown',
    },
    status: {
      type: String,
      enum: ['success', 'denied', 'error'],
      required: [true, 'Status is required'],
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    tamperHash: {
      type: String,
      required: [true, 'Cryptographic tamper hash is required'],
    },
  },
  {
    timestamps: true,
  }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1 });

export const AuditLogModel = mongoose.model<IAuditLogEntity>('AuditLog', AuditLogSchema);

// Dedicated atomic counter for sequence reservation
interface IAuditCounterEntity extends Document {
  _id: any;
  seq: number;
}

const AuditCounterSchema = new Schema<IAuditCounterEntity>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const AuditCounterModel = mongoose.model<IAuditCounterEntity>('AuditCounter', AuditCounterSchema);

// Shared authoritative audit chain head for multi-process ACID transactions
export interface IAuditChainHeadEntity extends Document {
  _id: any;
  sequenceNumber: number;
  lastHash: string;
  updatedAt: Date;
  createdAt: Date;
}

const AuditChainHeadSchema = new Schema<IAuditChainHeadEntity>(
  {
    _id: { type: String, required: true },
    sequenceNumber: { type: Number, required: true, default: 0 },
    lastHash: { type: String, required: true, default: 'GENESIS_HASH_INITIAL_LOG' },
  },
  {
    timestamps: true,
  }
);

export const AuditChainHeadModel = mongoose.model<IAuditChainHeadEntity>('AuditChainHead', AuditChainHeadSchema);
