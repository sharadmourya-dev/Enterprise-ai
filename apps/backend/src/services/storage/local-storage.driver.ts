import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IStorageDriver, IStorageSaveResult } from './storage.interface.js';
import { env } from '../../config/env.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
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

  /**
   * Strictly validates and resolves a portable storage key against the configured storage directory.
   * Rejects:
   * - Empty or non-string keys
   * - Null bytes (\0)
   * - Absolute paths (Unix root '/', Windows drive 'C:\', or UNC '//')
   * - Path traversal ('..')
   * - Directory separators ('/' or '\') in portable filename format
   * - Any resolved path that escapes this.storageDir (path-aware boundary check)
   */
  public resolveAndValidateKey(storageKey: string): string {
    if (!storageKey || typeof storageKey !== 'string' || storageKey.trim().length === 0) {
      throw new BadRequestError('Invalid file storage path: storage key cannot be empty');
    }

    if (storageKey.includes('\0')) {
      throw new BadRequestError('Invalid file storage path: null bytes are prohibited');
    }

    // Reject absolute paths, Windows drive letters (C:\...), UNC paths (\\...), or root-prefixed paths (/...)
    if (
      path.isAbsolute(storageKey) ||
      /^[a-zA-Z]:/.test(storageKey) ||
      /^(\/\/|\\\\)/.test(storageKey) ||
      storageKey.startsWith('/') ||
      storageKey.startsWith('\\')
    ) {
      throw new BadRequestError('Invalid file storage path: absolute paths are prohibited');
    }

    // Reject directory traversal and path separators in portable key format
    if (
      storageKey.includes('..') ||
      storageKey.includes('/') ||
      storageKey.includes('\\')
    ) {
      throw new BadRequestError('Invalid file storage path: directory traversal and path separators are prohibited');
    }

    const resolved = path.resolve(this.storageDir, storageKey);

    // Path-aware containment verification (defends against string-prefix collision)
    const relative = path.relative(this.storageDir, resolved);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestError('Invalid file storage path: path traversal detected');
    }

    return resolved;
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
    const targetPath = this.resolveAndValidateKey(storageFilename);

    // Defend against symlink collisions (defense in depth)
    try {
      const stat = await fs.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        throw new BadRequestError('Invalid file storage path: symlink collision detected');
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await fs.writeFile(targetPath, fileBuffer);
    return { storagePath: storageFilename, storageFilename };
  }

  public async readFile(storageKey: string): Promise<Buffer> {
    const targetPath = this.resolveAndValidateKey(storageKey);

    // Defend against symlink escape
    try {
      const stat = await fs.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        const realStorageDir = await fs.realpath(this.storageDir);
        const realTarget = await fs.realpath(targetPath);
        const relative = path.relative(realStorageDir, realTarget);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new BadRequestError('Invalid file access: symlink traversal detected');
        }
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestError) {
        throw err;
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`File not found in storage: ${storageKey}`);
      }
      throw err;
    }

    try {
      return await fs.readFile(targetPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`File not found in storage: ${storageKey}`);
      }
      throw err;
    }
  }

  public async deleteFile(storageKey: string): Promise<void> {
    const targetPath = this.resolveAndValidateKey(storageKey);

    // Defend against symlink escape before unlinking
    try {
      const stat = await fs.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        const realStorageDir = await fs.realpath(this.storageDir);
        const realTarget = await fs.realpath(targetPath);
        const relative = path.relative(realStorageDir, realTarget);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new BadRequestError('Invalid file deletion: symlink traversal detected');
        }
      }
      await fs.unlink(targetPath);
    } catch (err: unknown) {
      if (err instanceof BadRequestError) {
        throw err;
      }
      // If file is already gone, treat as idempotent success
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to delete file from local storage', { storageKey, error: err });
      }
    }
  }

  public async fileExists(storageKey: string): Promise<boolean> {
    try {
      const targetPath = this.resolveAndValidateKey(storageKey);
      const stat = await fs.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        const realStorageDir = await fs.realpath(this.storageDir);
        const realTarget = await fs.realpath(targetPath);
        const relative = path.relative(realStorageDir, realTarget);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
          return false;
        }
      }
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
