import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IStorageDriver, IStorageSaveResult } from './storage.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

/**
 * Resolves the upload storage directory deterministically regardless of whether
 * the backend server, background worker, or test runner is launched from the
 * monorepo root or from the apps/backend directory.
 */
export function resolveUploadStoragePath(configuredPath: string = env.UPLOAD_STORAGE_PATH): string {
  if (path.isAbsolute(configuredPath)) {
    return path.normalize(path.resolve(configuredPath));
  }

  // If launched from the monorepo root, anchor the relative path to apps/backend
  const repoBackendDir = path.resolve(process.cwd(), 'apps', 'backend');
  if (fsSync.existsSync(repoBackendDir)) {
    return path.normalize(path.resolve(repoBackendDir, configuredPath));
  }

  // If launched from apps/backend or other working directory
  return path.normalize(path.resolve(process.cwd(), configuredPath));
}

export class LocalStorageDriver implements IStorageDriver {
  public readonly driverName = 'local';
  private storageDir: string;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir ? path.normalize(path.resolve(customStorageDir)) : resolveUploadStoragePath();
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  public getMaxUploadSizeBytes(): number {
    return env.MAX_FILE_SIZE_BYTES;
  }

  public async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to create local storage directory', { error: err, storageDir: this.storageDir });
      throw err;
    }
  }

  public async saveFile(
    fileBuffer: Buffer,
    originalFilename: string
  ): Promise<IStorageSaveResult> {
    if (fileBuffer.length > this.getMaxUploadSizeBytes()) {
      throw new BadRequestError(
        `File size (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed local storage limit of ${(this.getMaxUploadSizeBytes() / 1024 / 1024).toFixed(2)} MB`
      );
    }

    await this.ensureStorageDir();

    // Extract safe extension (lower case, alphanumeric only)
    const rawExt = path.extname(originalFilename).toLowerCase();
    const safeExt = rawExt.replace(/[^a-z0-9.]/g, '');
    const storageFilename = `${crypto.randomUUID()}${safeExt}`;
    const storagePath = path.join(this.storageDir, storageFilename);

    // Path traversal verification: ensure target is strictly inside storageDir
    const normalizedPath = path.normalize(storagePath);
    if (!normalizedPath.startsWith(this.storageDir)) {
      throw new BadRequestError('Invalid file storage path: path traversal detected');
    }

    await fs.writeFile(normalizedPath, fileBuffer);
    return { storagePath: normalizedPath, storageFilename };
  }

  public async readFile(storagePath: string): Promise<Buffer> {
    const normalizedPath = path.normalize(storagePath);
    if (!normalizedPath.startsWith(this.storageDir)) {
      throw new BadRequestError('Invalid file access: path traversal detected');
    }

    return await fs.readFile(normalizedPath);
  }

  public async deleteFile(storagePath: string): Promise<void> {
    const normalizedPath = path.normalize(storagePath);
    if (!normalizedPath.startsWith(this.storageDir)) {
      throw new BadRequestError('Invalid file deletion: path traversal detected');
    }

    try {
      await fs.unlink(normalizedPath);
    } catch (err: unknown) {
      // If file is already gone, treat as idempotent success
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to delete file from local storage', { storagePath, error: err });
      }
    }
  }

  public async fileExists(storagePath: string): Promise<boolean> {
    try {
      const normalizedPath = path.normalize(storagePath);
      if (!normalizedPath.startsWith(this.storageDir)) {
        return false;
      }
      await fs.access(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }
}
