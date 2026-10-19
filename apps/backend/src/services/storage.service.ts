import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export class StorageService {
  private static storageDir = path.resolve(process.cwd(), env.UPLOAD_STORAGE_PATH);

  /**
   * Initializes storage directory if it does not exist
   */
  public static async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to create storage directory', { error: err, storageDir: this.storageDir });
      throw err;
    }
  }

  /**
   * Saves a file buffer securely using a server-generated UUID filename.
   * Strictly prevents path traversal and never uses user-supplied filenames directly.
   */
  public static async saveFile(
    fileBuffer: Buffer,
    originalFilename: string
  ): Promise<{ storagePath: string; storageFilename: string }> {
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

  /**
   * Reads a file buffer from storage with path traversal protection
   */
  public static async readFile(storagePath: string): Promise<Buffer> {
    const normalizedPath = path.normalize(storagePath);
    if (!normalizedPath.startsWith(this.storageDir)) {
      throw new BadRequestError('Invalid file access: path traversal detected');
    }

    return await fs.readFile(normalizedPath);
  }

  /**
   * Deletes a file safely from storage
   */
  public static async deleteFile(storagePath: string): Promise<void> {
    try {
      const normalizedPath = path.normalize(storagePath);
      if (!normalizedPath.startsWith(this.storageDir)) {
        throw new BadRequestError('Invalid file deletion: path traversal detected');
      }

      await fs.unlink(normalizedPath);
    } catch (err: unknown) {
      // If file is already gone, treat as idempotent success
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to delete file from storage', { storagePath, error: err });
      }
    }
  }

  /**
   * Checks if file exists in storage
   */
  public static async fileExists(storagePath: string): Promise<boolean> {
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
