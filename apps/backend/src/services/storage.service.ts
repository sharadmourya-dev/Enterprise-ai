import type {
  IStorageDriver,
  IStorageSaveResult,
} from './storage/storage.interface.js';
import { isCloudinaryStoragePath } from './storage/storage.interface.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import { CloudinaryStorageDriver } from './storage/cloudinary-storage.driver.js';
import { env } from '../config/env.js';

// Re-export deterministic path resolution and interface helpers for consumers & tests
export { resolveUploadStoragePath } from './storage/local-storage.driver.js';
export type {
  IStorageDriver,
  IStorageSaveResult,
} from './storage/storage.interface.js';
export {
  isCloudinaryStoragePath,
  parseCloudinaryStoragePath,
  formatCloudinaryStoragePath,
} from './storage/storage.interface.js';
export { LocalStorageDriver } from './storage/local-storage.driver.js';
export { CloudinaryStorageDriver } from './storage/cloudinary-storage.driver.js';

/**
 * StorageService Facade
 *
 * Routes document storage operations based on configured STORAGE_DRIVER for new uploads
 * and based on storage identifier scheme (cloudinary:// vs local filesystem) for retrieval,
 * verification, and deletion. This guarantees complete backward-compatibility with legacy
 * local documents even when running in Cloudinary mode.
 */
export class StorageService {
  private static localDriverInstance: LocalStorageDriver | null = null;
  private static cloudinaryDriverInstance: CloudinaryStorageDriver | null = null;

  public static getLocalDriver(): LocalStorageDriver {
    if (!this.localDriverInstance) {
      this.localDriverInstance = new LocalStorageDriver();
    }
    return this.localDriverInstance;
  }

  public static getCloudinaryDriver(): CloudinaryStorageDriver {
    if (!this.cloudinaryDriverInstance) {
      this.cloudinaryDriverInstance = new CloudinaryStorageDriver();
    }
    return this.cloudinaryDriverInstance;
  }

  /**
   * For testing purposes: allows overriding or resetting storage driver instances.
   */
  public static setLocalDriver(driver: LocalStorageDriver | null): void {
    this.localDriverInstance = driver;
  }

  public static setCloudinaryDriver(driver: CloudinaryStorageDriver | null): void {
    this.cloudinaryDriverInstance = driver;
  }

  /**
   * Returns the driver responsible for new file uploads according to configuration.
   */
  public static getActiveUploadDriver(): IStorageDriver {
    return env.STORAGE_DRIVER === 'cloudinary'
      ? this.getCloudinaryDriver()
      : this.getLocalDriver();
  }

  /**
   * Returns the maximum upload size in bytes based on the active storage driver.
   */
  public static getMaxUploadSizeBytes(): number {
    return this.getActiveUploadDriver().getMaxUploadSizeBytes();
  }

  /**
   * Returns the resolved local storage directory
   */
  public static getStorageDir(): string {
    return this.getLocalDriver().getStorageDir();
  }

  /**
   * Initializes local storage directory if it does not exist
   */
  public static async ensureStorageDir(): Promise<void> {
    await this.getLocalDriver().ensureStorageDir();
  }

  /**
   * Saves a file buffer securely using the active storage driver (local or Cloudinary).
   */
  public static async saveFile(
    fileBuffer: Buffer,
    originalFilename: string
  ): Promise<IStorageSaveResult> {
    return await this.getActiveUploadDriver().saveFile(fileBuffer, originalFilename);
  }

  /**
   * Reads a file buffer from storage. Routes to CloudinaryStorageDriver if storagePath
   * uses the cloudinary:// URI scheme; otherwise routes to LocalStorageDriver.
   */
  public static async readFile(storagePath: string): Promise<Buffer> {
    if (isCloudinaryStoragePath(storagePath)) {
      return await this.getCloudinaryDriver().readFile(storagePath);
    }
    return await this.getLocalDriver().readFile(storagePath);
  }

  /**
   * Deletes a file safely from storage. Routes according to storage identifier scheme.
   */
  public static async deleteFile(storagePath: string): Promise<void> {
    if (isCloudinaryStoragePath(storagePath)) {
      return await this.getCloudinaryDriver().deleteFile(storagePath);
    }
    return await this.getLocalDriver().deleteFile(storagePath);
  }

  /**
   * Checks if file exists in storage. Routes according to storage identifier scheme.
   */
  public static async fileExists(storagePath: string): Promise<boolean> {
    if (isCloudinaryStoragePath(storagePath)) {
      return await this.getCloudinaryDriver().fileExists(storagePath);
    }
    return await this.getLocalDriver().fileExists(storagePath);
  }
}
