import mongoose, { Schema, Document } from 'mongoose';
import { DocumentMimeType, DocumentStatus, Role, ClearanceLevel } from '@enterprise-ai/shared-types';

export interface IDocumentEntity extends Document {
  title: string;
  originalFilename: string;
  mimeType: DocumentMimeType;
  fileSizeBytes: number;
  storagePath: string;
  fileHash: string;
  status: DocumentStatus;
  errorMessage?: string | null;
  chunkCount: number;
  tokenCount: number;
  currentRevision: number;
  stagedRevision?: number | null;
  jobId?: string | null;
  processingAttempts: number;
  uploadedBy: mongoose.Types.ObjectId;
  accessControl: {
    allowedRoles: Role[];
    allowedDepartments: string[];
    minimumClearance: ClearanceLevel;
    allowedUserIds: mongoose.Types.ObjectId[];
  };
  metadata?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const AccessControlSchema = new Schema(
  {
    allowedRoles: {
      type: [String],
      enum: Object.values(Role),
      default: [],
    },
    allowedDepartments: {
      type: [String],
      default: [],
    },
    minimumClearance: {
      type: String,
      enum: Object.values(ClearanceLevel),
      default: ClearanceLevel.INTERNAL,
    },
    allowedUserIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
  },
  { _id: false }
);

const DocumentSchema = new Schema<IDocumentEntity>(
  {
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true,
      index: true,
    },
    originalFilename: {
      type: String,
      required: [true, 'Original filename is required'],
    },
    mimeType: {
      type: String,
      enum: Object.values(DocumentMimeType),
      required: [true, 'Mime type is required'],
    },
    fileSizeBytes: {
      type: Number,
      required: [true, 'File size in bytes is required'],
    },
    storagePath: {
      type: String,
      required: [true, 'Storage path is required'],
    },
    fileHash: {
      type: String,
      required: [true, 'File SHA-256 hash is required'],
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(DocumentStatus),
      default: DocumentStatus.PENDING,
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    currentRevision: {
      type: Number,
      default: 1,
      index: true,
    },
    stagedRevision: {
      type: Number,
      default: null,
    },
    jobId: {
      type: String,
      default: null,
      index: true,
    },
    processingAttempts: {
      type: Number,
      default: 0,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Uploader user ID is required'],
      index: true,
    },
    accessControl: {
      type: AccessControlSchema,
      required: true,
      default: () => ({
        allowedRoles: [],
        allowedDepartments: [],
        minimumClearance: ClearanceLevel.INTERNAL,
        allowedUserIds: [],
      }),
    },
    metadata: {
      type: Map,
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

DocumentSchema.index({ 'accessControl.minimumClearance': 1 });
DocumentSchema.index({ 'accessControl.allowedDepartments': 1 });

export const DocumentModel = mongoose.model<IDocumentEntity>('Document', DocumentSchema);
