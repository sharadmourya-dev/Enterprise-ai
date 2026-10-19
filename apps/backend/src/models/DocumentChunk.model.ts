import mongoose, { Schema, Document } from 'mongoose';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';

export interface IDocumentChunkEntity extends Document {
  documentId: mongoose.Types.ObjectId;
  chunkIndex: number;
  revision: number;
  content: string;
  tokenCount: number;
  vectorId: string;
  metadata: {
    title: string;
    pageNumber?: number;
    charStart?: number;
    charEnd?: number;
    sectionHeader?: string;
  };
  accessControl: {
    allowedRoles: Role[];
    allowedDepartments: string[];
    minimumClearance: ClearanceLevel;
    allowedUserIds: mongoose.Types.ObjectId[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const DocumentChunkSchema = new Schema<IDocumentChunkEntity>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'Parent document ID is required'],
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: [true, 'Chunk index is required'],
    },
    revision: {
      type: Number,
      required: [true, 'Revision number is required'],
      default: 1,
      index: true,
    },
    content: {
      type: String,
      required: [true, 'Chunk content is required'],
    },
    tokenCount: {
      type: Number,
      required: [true, 'Token count is required'],
    },
    vectorId: {
      type: String,
      required: [true, 'Qdrant vector ID is required'],
      unique: true,
      index: true,
    },
    metadata: {
      title: { type: String, required: true },
      pageNumber: { type: Number },
      charStart: { type: Number },
      charEnd: { type: Number },
      sectionHeader: { type: String },
    },
    accessControl: {
      allowedRoles: { type: [String], enum: Object.values(Role), default: [] },
      allowedDepartments: { type: [String], default: [] },
      minimumClearance: { type: String, enum: Object.values(ClearanceLevel), default: ClearanceLevel.INTERNAL },
      allowedUserIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    },
  },
  {
    timestamps: true,
  }
);

DocumentChunkSchema.index({ documentId: 1, revision: 1, chunkIndex: 1 });

export const DocumentChunkModel = mongoose.model<IDocumentChunkEntity>('DocumentChunk', DocumentChunkSchema);
