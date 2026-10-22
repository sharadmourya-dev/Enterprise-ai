import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import path from 'path';
import crypto from 'crypto';
import {
  IStorageDriver,
  IStorageSaveResult,
  formatCloudinaryStoragePath,
  parseCloudinaryStoragePath,
} from './storage.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export interface ICloudinaryDriverOptions {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
  folder?: string;
  maxSizeBytes?: number;
  downloadTimeoutMs?: number;
  cloudinaryInstance?: typeof cloudinary;
}

export class CloudinaryStorageDriver implements IStorageDriver {
  public readonly driverName = 'cloudinary';
  private cloudinaryClient: typeof cloudinary;
  private folder: string;
  private maxSizeBytes: number;
  private downloadTimeoutMs: number;

  constructor(options?: ICloudinaryDriverOptions) {
    this.folder = options?.folder || env.CLOUDINARY_FOLDER || 'enterprise-ai/documents';
    this.maxSizeBytes = options?.maxSizeBytes || env.MAX_CLOUDINARY_FILE_SIZE_BYTES || 10485760;
    this.downloadTimeoutMs = options?.downloadTimeoutMs || 30000;

    if (options?.cloudinaryInstance) {
      this.cloudinaryClient = options.cloudinaryInstance;
    } else {
      this.cloudinaryClient = cloudinary;
      const cloudName = options?.cloudName || env.CLOUDINARY_CLOUD_NAME;
      const apiKey = options?.apiKey || env.CLOUDINARY_API_KEY;
      const apiSecret = options?.apiSecret || env.CLOUDINARY_API_SECRET;

      if (!cloudName || !apiKey || !apiSecret) {
        throw new Error(
          'CloudinaryStorageDriver requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
        );
      }

      this.cloudinaryClient.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
  }

  public getMaxUploadSizeBytes(): number {
    return this.maxSizeBytes;
  }

  /**
   * Uploads a raw file buffer securely to Cloudinary with authenticated delivery.
   * Strictly enforces upload size limits before initiating any remote request.
   */
  public async saveFile(
    fileBuffer: Buffer,
    originalFilename: string
  ): Promise<IStorageSaveResult> {
    // 1. Mandatory upload limit verification: reject before making remote upload request
    if (fileBuffer.length > this.maxSizeBytes) {
      throw new BadRequestError(
        `File size (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed Cloudinary upload limit of ${(this.maxSizeBytes / 1024 / 1024).toFixed(2)} MB`
      );
    }

    // 2. Generate UUID filename with safe extension
    const rawExt = path.extname(originalFilename).toLowerCase();
    const safeExt = rawExt.replace(/[^a-z0-9.]/g, '');
    const storageFilename = `${crypto.randomUUID()}${safeExt}`;
    const publicId = `${this.folder}/${storageFilename}`;

    // 3. Upload stream with resource_type: 'raw' and type: 'authenticated'
    const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = this.cloudinaryClient.uploader.upload_stream(
        {
          resource_type: 'raw',
          type: 'authenticated',
          public_id: publicId,
        },
        (error, result) => {
          if (error) {
            logger.error('Cloudinary raw-file upload failed', {
              publicId,
              error: error.message,
            });
            return reject(new Error(`Cloudinary upload failed: ${error.message}`));
          }
          if (!result) {
            return reject(new Error('Cloudinary upload returned empty response'));
          }
          resolve(result);
        }
      );

      uploadStream.end(fileBuffer);
    });

    const resourceType = uploadResult.resource_type || 'raw';
    const deliveryType = uploadResult.type || 'authenticated';
    const finalPublicId = uploadResult.public_id || publicId;

    // 4. Construct unambiguous storage URI preserving resource type, delivery type, and public ID
    const storagePath = formatCloudinaryStoragePath(resourceType, deliveryType, finalPublicId);

    return {
      storagePath,
      storageFilename,
    };
  }

  /**
   * Retrieves raw original binary bytes from Cloudinary using an ephemeral signed URL.
   * Safely handles timeouts, non-200 HTTP statuses, and response size ceilings without
   * exposing credentials or signed URLs.
   */
  public async readFile(storagePath: string): Promise<Buffer> {
    const parsed = parseCloudinaryStoragePath(storagePath);
    if (!parsed) {
      throw new BadRequestError(`Invalid Cloudinary storage path: ${storagePath}`);
    }

    // 1. Generate 5-minute ephemeral signed download URL
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const signedUrl = this.cloudinaryClient.utils.private_download_url(
      parsed.publicId,
      '',
      {
        resource_type: parsed.resourceType,
        type: parsed.deliveryType,
        expires_at: expiresAt,
      }
    );

    // 2. Stream download with timeout signal
    let response: Response;
    try {
      response = await fetch(signedUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.downloadTimeoutMs),
      });
    } catch (fetchErr: any) {
      if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
        logger.error('Document download from Cloudinary timed out', { publicId: parsed.publicId });
        throw new Error(`Document download timed out after ${this.downloadTimeoutMs / 1000}s`);
      }
      logger.error('Failed to initiate document download from Cloudinary', {
        publicId: parsed.publicId,
        error: fetchErr.message,
      });
      throw new Error('Failed to download document from remote storage');
    }

    // 3. Status validation
    if (!response.ok) {
      logger.error('Cloudinary download returned non-success HTTP status', {
        status: response.status,
        statusText: response.statusText,
        publicId: parsed.publicId,
      });
      if (response.status === 404) {
        throw new NotFoundError(`Document file not found in remote storage: ${parsed.publicId}`);
      }
      throw new Error(`Remote storage returned HTTP ${response.status}`);
    }

    // 4. Safe size checks
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > this.maxSizeBytes) {
        throw new Error(`Remote document size (${contentLength} bytes) exceeds maximum limit`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > this.maxSizeBytes) {
      throw new Error(`Downloaded document size (${buffer.length} bytes) exceeds maximum limit`);
    }

    return buffer;
  }

  /**
   * Deletes a raw authenticated file from Cloudinary.
   * Treats 'not found' idempotently.
   */
  public async deleteFile(storagePath: string): Promise<void> {
    const parsed = parseCloudinaryStoragePath(storagePath);
    if (!parsed) {
      throw new BadRequestError(`Invalid Cloudinary storage path: ${storagePath}`);
    }

    try {
      const res = await this.cloudinaryClient.uploader.destroy(parsed.publicId, {
        resource_type: parsed.resourceType,
        type: parsed.deliveryType,
        invalidate: true,
      });

      if (res.result !== 'ok' && res.result !== 'not found') {
        logger.warn('Unexpected Cloudinary destroy response', {
          result: res.result,
          publicId: parsed.publicId,
        });
      }
    } catch (err: any) {
      logger.warn('Failed to delete file from Cloudinary', {
        publicId: parsed.publicId,
        error: err.message,
      });
    }
  }

  /**
   * Checks file existence in Cloudinary using ephemeral signed HEAD request.
   */
  public async fileExists(storagePath: string): Promise<boolean> {
    const parsed = parseCloudinaryStoragePath(storagePath);
    if (!parsed) {
      return false;
    }

    try {
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      const signedUrl = this.cloudinaryClient.utils.private_download_url(
        parsed.publicId,
        '',
        {
          resource_type: parsed.resourceType,
          type: parsed.deliveryType,
          expires_at: expiresAt,
        }
      );

      const response = await fetch(signedUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
