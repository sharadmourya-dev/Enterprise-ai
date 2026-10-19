import mongoose from 'mongoose';
import {
  DocumentStatus,
  Role,
  ClearanceLevel,
  CLEARANCE_RANK,
  IAccessControl,
  IDocumentUploadResponse,
  IDocumentListQuery,
  IDocumentListResponse,
  AuditAction,
  AuditResourceType,
  IJwtPayload,
} from '@enterprise-ai/shared-types';
import { DocumentModel, IDocumentEntity } from '../models/Document.model.js';
import { DocumentChunkModel } from '../models/DocumentChunk.model.js';
import { StorageService } from './storage.service.js';
import { FileValidator } from './parsers/file-validator.js';
import { QdrantService } from './qdrant.service.js';
import { enqueueDocumentIngestion } from '../queue/ingestion.queue.js';
import { AuditService } from './audit.service.js';
import { RagCacheService } from './cache/rag-cache.service.js';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors.js';
import logger from '../utils/logger.js';

export class DocumentService {
  /**
   * Uploads, validates, stores, and enqueues a document for processing
   */
  public static async uploadDocument(
    fileBuffer: Buffer,
    originalFilename: string,
    declaredMimeType: string | undefined,
    user: IJwtPayload,
    accessControlInput?: Partial<IAccessControl>,
    customTitle?: string,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<IDocumentUploadResponse> {
    // 1. Strict validation of size, extension, declared MIME, and binary magic bytes
    const validated = FileValidator.validate(fileBuffer, originalFilename, declaredMimeType);

    // 2. Duplicate detection: Check if active document with same content hash already exists for this user
    const existingDoc = await DocumentModel.findOne({
      uploadedBy: user.sub,
      fileHash: validated.fileHash,
      status: { $ne: DocumentStatus.FAILED },
    });

    if (existingDoc) {
      throw new ConflictError(
        `A document with identical content has already been uploaded ('${existingDoc.title}') with status: ${existingDoc.status}.`
      );
    }

    // 3. Save to protected disk storage outside web root with randomized UUID
    const { storagePath } = await StorageService.saveFile(fileBuffer, originalFilename);

    try {
      // 4. Construct Access Control parameters & prevent ACL manipulation by non-admins
      const requestedClearance = accessControlInput?.minimumClearance || ClearanceLevel.INTERNAL;
      const userClearanceRank = CLEARANCE_RANK[user.securityClearance] ?? 0;
      const requestedClearanceRank = CLEARANCE_RANK[requestedClearance] ?? 1;

      if (user.role !== Role.SUPER_ADMIN && user.role !== Role.ADMIN) {
        // Clearance privilege check: user cannot assign clearance higher than their own
        if (requestedClearanceRank > userClearanceRank) {
          throw new ForbiddenError(
            `Cannot assign clearance '${requestedClearance}' exceeding your own clearance level '${user.securityClearance}'.`
          );
        }

        // Department manipulation check: user cannot assign documents to foreign departments
        if (accessControlInput?.allowedDepartments && accessControlInput.allowedDepartments.length > 0) {
          const invalidDept = accessControlInput.allowedDepartments.find((d) => d !== user.department);
          if (invalidDept) {
            throw new ForbiddenError(`Cannot assign document to foreign department '${invalidDept}'.`);
          }
        }

        // Role manipulation check: user cannot assign roles they do not possess
        if (accessControlInput?.allowedRoles && accessControlInput.allowedRoles.length > 0) {
          const invalidRole = accessControlInput.allowedRoles.find((r) => r !== user.role);
          if (invalidRole) {
            throw new ForbiddenError(`Cannot assign document to role '${invalidRole}' you do not possess.`);
          }
        }

        // User ID manipulation check: user cannot restrict access to arbitrary user IDs
        if (accessControlInput?.allowedUserIds && accessControlInput.allowedUserIds.length > 0) {
          throw new ForbiddenError('Only administrators can configure user-specific access restrictions.');
        }
      }

      const accessControl = {
        allowedRoles: accessControlInput?.allowedRoles || [],
        allowedDepartments: accessControlInput?.allowedDepartments || [],
        minimumClearance: requestedClearance,
        allowedUserIds: accessControlInput?.allowedUserIds
          ? accessControlInput.allowedUserIds.map((id) => new mongoose.Types.ObjectId(id))
          : [],
      };

      const title = customTitle?.trim() || validated.sanitizedFilename;

      // 5. Persist Document record in MongoDB with initial revision = 1
      const document = await DocumentModel.create({
        title,
        originalFilename: validated.sanitizedFilename,
        mimeType: validated.mimeType,
        fileSizeBytes: validated.fileSizeBytes,
        storagePath,
        fileHash: validated.fileHash,
        status: DocumentStatus.QUEUED,
        chunkCount: 0,
        tokenCount: 0,
        currentRevision: 1,
        stagedRevision: null,
        jobId: null,
        processingAttempts: 0,
        uploadedBy: user.sub,
        accessControl,
      });

      // 6. Enqueue asynchronous background processing job in BullMQ
      let jobId: string;
      try {
        jobId = await enqueueDocumentIngestion(document._id.toString(), 1);
        await DocumentModel.updateOne({ _id: document._id }, { $set: { jobId } });
      } catch (queueErr) {
        logger.error('Failed to enqueue document ingestion job', { error: queueErr, documentId: document._id });
        jobId = 'enqueue_pending';
      }

      // 7. Audit log
      await AuditService.log({
        userId: user.sub,
        action: AuditAction.DOC_UPLOAD,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: document._id.toString(),
        ipAddress: clientMeta?.ip,
        userAgent: clientMeta?.userAgent,
        status: 'success',
        details: {
          documentId: document._id.toString(),
          title: document.title,
          mimeType: document.mimeType,
          fileSizeBytes: document.fileSizeBytes,
          fileHash: document.fileHash,
          jobId,
        },
      });

      // 8. Invalidate RAG response cache
      await RagCacheService.invalidateAll();

      return {
        documentId: document._id.toString(),
        title: document.title,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
        fileHash: document.fileHash,
        status: DocumentStatus.QUEUED,
        jobId,
        createdAt: document.createdAt.toISOString(),
      };
    } catch (err) {
      // Compensating storage cleanup on any failure path
      await StorageService.deleteFile(storagePath);
      throw err;
    }
  }

  /**
   * Retrieves document metadata if authorized by clearance and ACL
   */
  public static async getDocumentById(id: string, user: IJwtPayload): Promise<IDocumentEntity> {
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new BadRequestError('Invalid document ID format');
    }

    const document = await DocumentModel.findById(id);
    if (!document) {
      throw new NotFoundError('Document not found');
    }

    this.enforceAccessControl(document, user);
    return document;
  }

  /**
   * Lists documents visible to the authenticated user within their authorized clearance and scope
   */
  public static async listDocuments(
    user: IJwtPayload,
    query: IDocumentListQuery
  ): Promise<IDocumentListResponse> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const userRank = CLEARANCE_RANK[user.securityClearance] ?? 0;
    const filter: Record<string, unknown> = {};

    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.ADMIN) {
      if (query.department && query.department !== user.department) {
        throw new ForbiddenError('You are not authorized to filter documents belonging to other departments.');
      }

      // Find all clearance levels with rank <= user's clearance rank
      const accessibleClearances = Object.entries(CLEARANCE_RANK)
        .filter(([_, rank]) => rank <= userRank)
        .map(([level]) => level);

      filter['accessControl.minimumClearance'] = { $in: accessibleClearances };

      // Empty-ACL Semantics:
      // Department match: department is empty OR contains user's department
      filter.$and = [
        {
          $or: [
            { 'accessControl.allowedDepartments': { $size: 0 } },
            { 'accessControl.allowedDepartments': user.department },
          ],
        },
        {
          $or: [
            { 'accessControl.allowedRoles': { $size: 0 } },
            { 'accessControl.allowedRoles': user.role },
          ],
        },
        {
          $or: [
            { 'accessControl.allowedUserIds': { $size: 0 } },
            { 'accessControl.allowedUserIds': new mongoose.Types.ObjectId(user.sub) },
          ],
        },
      ];
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.department) {
      filter['accessControl.allowedDepartments'] = query.department;
    }

    const [documents, total] = await Promise.all([
      DocumentModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DocumentModel.countDocuments(filter),
    ]);

    const formattedDocs = documents.map((doc: any) => ({
      id: doc._id.toString(),
      title: doc.title,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      fileHash: doc.fileHash,
      status: doc.status,
      errorMessage: doc.errorMessage,
      chunkCount: doc.chunkCount,
      tokenCount: doc.tokenCount,
      currentRevision: doc.currentRevision || 1,
      stagedRevision: doc.stagedRevision || null,
      uploadedBy: doc.uploadedBy.toString(),
      accessControl: {
        allowedRoles: doc.accessControl.allowedRoles,
        allowedDepartments: doc.accessControl.allowedDepartments,
        minimumClearance: doc.accessControl.minimumClearance,
        allowedUserIds: doc.accessControl.allowedUserIds.map((u: any) => u.toString()),
      },
      metadata: doc.metadata,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }));

    return {
      documents: formattedDocs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retries ingestion of a failed document
   */
  public static async retryDocument(
    id: string,
    user: IJwtPayload,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<{ message: string; jobId: string }> {
    const document = await this.getDocumentById(id, user);

    // Only uploader, admin, or knowledge manager may retry
    const isOwner = document.uploadedBy.toString() === user.sub;
    const isPrivileged = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenError('You are not authorized to retry processing for this document');
    }

    if (document.status !== DocumentStatus.FAILED) {
      throw new BadRequestError(
        `Document cannot be retried because it is in status '${document.status}'. Only FAILED documents can be retried.`
      );
    }

    // Reset status to QUEUED
    await DocumentModel.updateOne(
      { _id: document._id },
      {
        $set: { status: DocumentStatus.QUEUED, errorMessage: null },
      }
    );

    const jobId = await enqueueDocumentIngestion(document._id.toString());
    await DocumentModel.updateOne({ _id: document._id }, { $set: { jobId } });

    await AuditService.log({
      userId: user.sub,
      action: AuditAction.DOC_REINDEX,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { documentId: document._id.toString(), retryAttempt: document.processingAttempts + 1, jobId },
    });

    // Invalidate RAG response cache
    await RagCacheService.invalidateAll();

    return { message: 'Document re-queued for processing', jobId };
  }

  /**
   * Safely deletes a document, cleaning up MongoDB records, chunks, filesystem storage, and Qdrant vectors
   */
  public static async deleteDocument(
    id: string,
    user: IJwtPayload,
    clientMeta?: { ip?: string; userAgent?: string }
  ): Promise<void> {
    const document = await this.getDocumentById(id, user);

    // Deletion permissions: document owner or admin
    const isOwner = document.uploadedBy.toString() === user.sub;
    const isPrivileged = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenError('You are not authorized to delete this document');
    }

    // 1. Mark status DELETING to prevent concurrent processing by worker
    await DocumentModel.updateOne(
      { _id: document._id },
      { $set: { status: DocumentStatus.DELETING } }
    );

    // 2. Delete vectors from Qdrant
    try {
      await QdrantService.deleteDocumentVectors(document._id.toString());
    } catch (qdrantErr) {
      logger.warn('Failed to delete vectors from Qdrant during document deletion', { error: qdrantErr });
    }

    // 3. Delete chunks from MongoDB
    await DocumentChunkModel.deleteMany({ documentId: document._id });

    // 4. Delete file from local storage
    await StorageService.deleteFile(document.storagePath);

    // 5. Delete document record from MongoDB
    await DocumentModel.findByIdAndDelete(document._id);

    // 6. Audit log
    await AuditService.log({
      userId: user.sub,
      action: AuditAction.DOC_DELETE,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document._id.toString(),
      ipAddress: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      status: 'success',
      details: { documentId: document._id.toString(), title: document.title },
    });

    // Invalidate RAG response cache
    await RagCacheService.invalidateAll();

    logger.info(`Document ${id} and all related chunks and vectors deleted successfully by user ${user.sub}`);
  }

  /**
   * Checks if user has permission to read/access document based on clearance, role, department, and user ID
   */
  private static enforceAccessControl(document: IDocumentEntity, user: IJwtPayload): void {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
      return; // Admins bypass departmental/role filtering
    }

    // 1. Clearance check
    const userRank = CLEARANCE_RANK[user.securityClearance] ?? 0;
    const requiredRank = CLEARANCE_RANK[document.accessControl.minimumClearance] ?? 999;

    if (userRank < requiredRank) {
      throw new ForbiddenError(
        `Insufficient security clearance to access document. Required: ${document.accessControl.minimumClearance}, Current: ${user.securityClearance}`
      );
    }

    // 2. Department check (empty array = wildcard)
    if (
      document.accessControl.allowedDepartments.length > 0 &&
      !document.accessControl.allowedDepartments.includes(user.department)
    ) {
      throw new ForbiddenError(
        `Access denied. Document is restricted to departments: [${document.accessControl.allowedDepartments.join(', ')}]`
      );
    }

    // 3. Role check (empty array = wildcard)
    if (
      document.accessControl.allowedRoles.length > 0 &&
      !document.accessControl.allowedRoles.includes(user.role)
    ) {
      throw new ForbiddenError(
        `Access denied. Document is restricted to roles: [${document.accessControl.allowedRoles.join(', ')}]`
      );
    }

    // 4. User ID check (empty array = wildcard)
    if (
      document.accessControl.allowedUserIds.length > 0 &&
      !document.accessControl.allowedUserIds.some((id) => id.toString() === user.sub)
    ) {
      throw new ForbiddenError('Access denied. Document is restricted to specific users.');
    }
  }
}
