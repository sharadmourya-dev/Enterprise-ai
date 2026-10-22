import { BadRequestError } from '../../utils/errors.js';

export interface IStorageSaveResult {
  storagePath: string;
  storageFilename: string;
}

export interface ICloudinaryStorageIdentifier {
  resourceType: string;
  deliveryType: string;
  publicId: string;
}

export interface IStorageDriver {
  readonly driverName: string;
  saveFile(fileBuffer: Buffer, originalFilename: string): Promise<IStorageSaveResult>;
  readFile(storagePath: string): Promise<Buffer>;
  deleteFile(storagePath: string): Promise<void>;
  fileExists(storagePath: string): Promise<boolean>;
  getMaxUploadSizeBytes(): number;
}

/**
 * Checks whether a storage path identifier points to a Cloudinary remote asset.
 */
export function isCloudinaryStoragePath(storagePath: string): boolean {
  return typeof storagePath === 'string' && storagePath.startsWith('cloudinary://');
}

/**
 * Parses a Cloudinary URI scheme (cloudinary://<resource_type>/<delivery_type>/<public_id>)
 * into its constituent parts for SDK consumption.
 */
export function parseCloudinaryStoragePath(storagePath: string): ICloudinaryStorageIdentifier | null {
  if (!isCloudinaryStoragePath(storagePath)) {
    return null;
  }

  const withoutScheme = storagePath.slice('cloudinary://'.length);
  const match = withoutScheme.match(/^([^/]+)\/([^/]+)\/(.+)$/);

  if (!match) {
    throw new BadRequestError(`Invalid Cloudinary storage identifier structure: ${storagePath}`);
  }

  return {
    resourceType: match[1],
    deliveryType: match[2],
    publicId: match[3],
  };
}

/**
 * Formats a Cloudinary storage identifier URI preserving resource type, delivery type, and public ID.
 */
export function formatCloudinaryStoragePath(
  resourceType: string,
  deliveryType: string,
  publicId: string
): string {
  return `cloudinary://${resourceType}/${deliveryType}/${publicId}`;
}
