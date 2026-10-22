import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
  StorageService,
  LocalStorageDriver,
  CloudinaryStorageDriver,
  formatCloudinaryStoragePath,
  parseCloudinaryStoragePath,
  isCloudinaryStoragePath,
} from '../src/services/storage.service.js';
import { env } from '../src/config/env.js';
import { BadRequestError, NotFoundError } from '../src/utils/errors.js';

describe('Document Storage Abstraction & Drivers (Unit Tests)', () => {
  describe('1. Cloudinary Storage Path Formatting and Parsing', () => {
    it('correctly identifies Cloudinary URIs vs local file paths', () => {
      expect(isCloudinaryStoragePath('cloudinary://raw/authenticated/enterprise-ai/documents/abc.pdf')).toBe(true);
      expect(isCloudinaryStoragePath('./data/uploads/abc.pdf')).toBe(false);
      expect(isCloudinaryStoragePath('C:\\app\\data\\uploads\\abc.pdf')).toBe(false);
      expect(isCloudinaryStoragePath('/var/data/uploads/abc.pdf')).toBe(false);
    });

    it('formats unambiguous Cloudinary storage URI', () => {
      const uri = formatCloudinaryStoragePath('raw', 'authenticated', 'enterprise-ai/documents/file.pdf');
      expect(uri).toBe('cloudinary://raw/authenticated/enterprise-ai/documents/file.pdf');
    });

    it('parses constituent parts from Cloudinary URI', () => {
      const parsed = parseCloudinaryStoragePath('cloudinary://raw/authenticated/enterprise-ai/documents/file.pdf');
      expect(parsed).toEqual({
        resourceType: 'raw',
        deliveryType: 'authenticated',
        publicId: 'enterprise-ai/documents/file.pdf',
      });
    });

    it('returns null when parsing local storage path', () => {
      expect(parseCloudinaryStoragePath('./data/uploads/file.pdf')).toBeNull();
      expect(parseCloudinaryStoragePath('C:\\uploads\\file.pdf')).toBeNull();
    });

    it('throws BadRequestError on malformed cloudinary:// scheme', () => {
      expect(() => parseCloudinaryStoragePath('cloudinary://incomplete-uri')).toThrow(BadRequestError);
    });
  });

  describe('2. LocalStorageDriver Operations & Safeguards', () => {
    let tempDir: string;
    let localDriver: LocalStorageDriver;

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
      localDriver = new LocalStorageDriver(tempDir);
    });

    afterAll(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    });

    it('saves a file and returns normalized storage path inside storage dir', async () => {
      const sampleBytes = Buffer.from('Original document contents for local storage test');
      const { storagePath, storageFilename } = await localDriver.saveFile(sampleBytes, 'test-doc.pdf');

      expect(storagePath.startsWith(tempDir)).toBe(true);
      expect(storageFilename.endsWith('.pdf')).toBe(true);
      expect(await localDriver.fileExists(storagePath)).toBe(true);

      const readBytes = await localDriver.readFile(storagePath);
      expect(readBytes.equals(sampleBytes)).toBe(true);
    });

    it('rejects path traversal attempts on save, read, and delete', async () => {
      const sampleBytes = Buffer.from('attack');
      const traversalPath = path.resolve(tempDir, '../outside-file.txt');

      await expect(localDriver.readFile(traversalPath)).rejects.toThrow(/path traversal/);
      await expect(localDriver.deleteFile(traversalPath)).rejects.toThrow(/path traversal/);
      expect(await localDriver.fileExists(traversalPath)).toBe(false);
    });

    it('idempotently deletes files without throwing when file does not exist', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.pdf');
      await expect(localDriver.deleteFile(nonExistentPath)).resolves.not.toThrow();
    });

    it('enforces maximum file size limit (50 MB default)', async () => {
      const smallDriver = new LocalStorageDriver(tempDir);
      jest.spyOn(smallDriver, 'getMaxUploadSizeBytes').mockReturnValue(100);

      const oversized = Buffer.alloc(150, 'a');
      await expect(smallDriver.saveFile(oversized, 'oversized.txt')).rejects.toThrow(BadRequestError);
      await expect(smallDriver.saveFile(oversized, 'oversized.txt')).rejects.toThrow(/exceeds maximum allowed local storage limit/);
    });
  });

  describe('3. CloudinaryStorageDriver Operations & Remote Safeguards', () => {
    let mockCloudinary: any;
    let driver: CloudinaryStorageDriver;

    beforeEach(() => {
      mockCloudinary = {
        uploader: {
          upload_stream: jest.fn(),
          destroy: jest.fn(),
        },
        utils: {
          private_download_url: jest.fn(),
        },
        config: jest.fn(),
      };

      driver = new CloudinaryStorageDriver({
        cloudName: 'test-cloud',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
        folder: 'enterprise-ai/documents',
        maxSizeBytes: 10485760, // 10 MB
        downloadTimeoutMs: 5000,
        cloudinaryInstance: mockCloudinary as unknown as typeof cloudinary,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('Upload & Size Enforcement', () => {
      it('rejects oversized files > 10 MB BEFORE making any remote upload request', async () => {
        const oversized = Buffer.alloc(10485761); // 10 MB + 1 byte

        await expect(driver.saveFile(oversized, 'large.pdf')).rejects.toThrow(BadRequestError);
        await expect(driver.saveFile(oversized, 'large.pdf')).rejects.toThrow(/exceeds maximum allowed Cloudinary upload limit/);

        // Crucial verification: zero calls to remote SDK
        expect(mockCloudinary.uploader.upload_stream).not.toHaveBeenCalled();
      });

      it('successfully uploads raw authenticated file and returns unambiguous storage path', async () => {
        const fileContent = Buffer.from('Mock PDF Content for Cloudinary');

        mockCloudinary.uploader.upload_stream.mockImplementation(
          (options: any, callback: (err: any, result: UploadApiResponse | null) => void) => {
            expect(options.resource_type).toBe('raw');
            expect(options.type).toBe('authenticated');
            expect(options.public_id).toMatch(/^enterprise-ai\/documents\/[0-9a-f-]+\.pdf$/);

            // Return fake writable stream
            const { Writable } = require('stream');
            const stream = new Writable({
              write(chunk: any, encoding: any, next: any) {
                next();
              },
            });
            stream.on('finish', () => {
              callback(null, {
                public_id: options.public_id,
                resource_type: 'raw',
                type: 'authenticated',
                bytes: fileContent.length,
              } as UploadApiResponse);
            });
            return stream;
          }
        );

        const result = await driver.saveFile(fileContent, 'sample-policy.pdf');

        expect(result.storagePath).toMatch(/^cloudinary:\/\/raw\/authenticated\/enterprise-ai\/documents\/[0-9a-f-]+\.pdf$/);
        expect(result.storageFilename).toMatch(/^[0-9a-f-]+\.pdf$/);
      });

      it('handles upload stream errors cleanly without leaking sensitive details', async () => {
        mockCloudinary.uploader.upload_stream.mockImplementation(
          (options: any, callback: (err: any, result: any) => void) => {
            const { Writable } = require('stream');
            const stream = new Writable({
              write(chunk: any, encoding: any, next: any) {
                next();
              },
            });
            stream.on('finish', () => {
              callback(new Error('Cloudinary rate limit exceeded'), null);
            });
            return stream;
          }
        );

        const fileContent = Buffer.from('Sample Content');
        await expect(driver.saveFile(fileContent, 'policy.txt')).rejects.toThrow(/Cloudinary upload failed/);
      });
    });

    describe('Private Download & Worker Retrieval', () => {
      const storagePath = 'cloudinary://raw/authenticated/enterprise-ai/documents/test-doc.pdf';

      it('generates ephemeral signed URL and fetches original binary bytes safely', async () => {
        const expectedBytes = Buffer.from('Raw binary document content retrieved from Cloudinary');
        const fakeSignedUrl = 'https://api.cloudinary.com/v1_1/test-cloud/raw/download?signed=true';

        mockCloudinary.utils.private_download_url.mockReturnValue(fakeSignedUrl);

        // Mock global fetch
        const mockFetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(expectedBytes.length),
          }),
          arrayBuffer: async () => expectedBytes.buffer.slice(expectedBytes.byteOffset, expectedBytes.byteOffset + expectedBytes.byteLength),
        });
        global.fetch = mockFetch;

        const retrieved = await driver.readFile(storagePath);

        expect(mockCloudinary.utils.private_download_url).toHaveBeenCalledWith(
          'enterprise-ai/documents/test-doc.pdf',
          '',
          expect.objectContaining({
            resource_type: 'raw',
            type: 'authenticated',
          })
        );
        expect(mockFetch).toHaveBeenCalledWith(fakeSignedUrl, expect.objectContaining({ method: 'GET' }));
        expect(retrieved.equals(expectedBytes)).toBe(true);
      });

      it('throws NotFoundError when remote storage returns HTTP 404', async () => {
        mockCloudinary.utils.private_download_url.mockReturnValue('https://api.cloudinary.com/test-404');

        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers(),
        });

        await expect(driver.readFile(storagePath)).rejects.toThrow(NotFoundError);
      });

      it('handles download timeout safely', async () => {
        mockCloudinary.utils.private_download_url.mockReturnValue('https://api.cloudinary.com/test-timeout');

        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        global.fetch = jest.fn().mockRejectedValue(timeoutErr);

        await expect(driver.readFile(storagePath)).rejects.toThrow(/timed out/);
      });

      it('rejects remote document if downloaded size exceeds max limit', async () => {
        mockCloudinary.utils.private_download_url.mockReturnValue('https://api.cloudinary.com/test-oversized');

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': '20000000', // 20 MB > 10 MB limit
          }),
        });

        await expect(driver.readFile(storagePath)).rejects.toThrow(/exceeds maximum limit/);
      });
    });

    describe('Deletion & Idempotency', () => {
      it('calls destroy with raw and authenticated parameters', async () => {
        mockCloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' });

        const storagePath = 'cloudinary://raw/authenticated/enterprise-ai/documents/delete-me.pdf';
        await expect(driver.deleteFile(storagePath)).resolves.not.toThrow();

        expect(mockCloudinary.uploader.destroy).toHaveBeenCalledWith(
          'enterprise-ai/documents/delete-me.pdf',
          {
            resource_type: 'raw',
            type: 'authenticated',
            invalidate: true,
          }
        );
      });

      it('treats "not found" response idempotently during deletion', async () => {
        mockCloudinary.uploader.destroy.mockResolvedValue({ result: 'not found' });

        const storagePath = 'cloudinary://raw/authenticated/enterprise-ai/documents/already-deleted.pdf';
        await expect(driver.deleteFile(storagePath)).resolves.not.toThrow();
      });
    });
  });

  describe('4. StorageService Facade Routing & Backward Compatibility', () => {
    let mockLocal: any;
    let mockCloudinary: any;

    beforeEach(() => {
      mockLocal = {
        driverName: 'local',
        saveFile: jest.fn().mockResolvedValue({ storagePath: './data/uploads/local.pdf', storageFilename: 'local.pdf' }),
        readFile: jest.fn().mockResolvedValue(Buffer.from('Local file content')),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        fileExists: jest.fn().mockResolvedValue(true),
        getMaxUploadSizeBytes: jest.fn().mockReturnValue(52428800),
        getStorageDir: jest.fn().mockReturnValue('C:\\mock\\uploads'),
      };

      mockCloudinary = {
        driverName: 'cloudinary',
        saveFile: jest.fn().mockResolvedValue({
          storagePath: 'cloudinary://raw/authenticated/enterprise-ai/documents/cloud.pdf',
          storageFilename: 'cloud.pdf',
        }),
        readFile: jest.fn().mockResolvedValue(Buffer.from('Cloudinary file content')),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        fileExists: jest.fn().mockResolvedValue(true),
        getMaxUploadSizeBytes: jest.fn().mockReturnValue(10485760),
      };

      StorageService.setLocalDriver(mockLocal);
      StorageService.setCloudinaryDriver(mockCloudinary);
    });

    const originalDriver = env.STORAGE_DRIVER;

    afterEach(() => {
      (env as any).STORAGE_DRIVER = originalDriver;
      StorageService.setLocalDriver(null);
      StorageService.setCloudinaryDriver(null);
      jest.restoreAllMocks();
    });

    it('routes uploads according to STORAGE_DRIVER environment setting', async () => {
      // Explicit Local mode
      (env as any).STORAGE_DRIVER = 'local';
      await StorageService.saveFile(Buffer.from('test'), 'doc.pdf');
      expect(mockLocal.saveFile).toHaveBeenCalled();
      expect(mockCloudinary.saveFile).not.toHaveBeenCalled();

      // Explicit Cloudinary mode
      mockLocal.saveFile.mockClear();
      mockCloudinary.saveFile.mockClear();
      (env as any).STORAGE_DRIVER = 'cloudinary';

      await StorageService.saveFile(Buffer.from('test'), 'doc.pdf');
      expect(mockCloudinary.saveFile).toHaveBeenCalled();
      expect(mockLocal.saveFile).not.toHaveBeenCalled();
    });

    it('routes reads and deletes based on URI scheme regardless of active STORAGE_DRIVER', async () => {
      // Even in local mode, a Cloudinary URI must route to Cloudinary driver
      (env as any).STORAGE_DRIVER = 'local';
      const cloudUri = 'cloudinary://raw/authenticated/enterprise-ai/documents/cloud.pdf';

      await StorageService.readFile(cloudUri);
      expect(mockCloudinary.readFile).toHaveBeenCalledWith(cloudUri);
      expect(mockLocal.readFile).not.toHaveBeenCalled();

      await StorageService.deleteFile(cloudUri);
      expect(mockCloudinary.deleteFile).toHaveBeenCalledWith(cloudUri);
      expect(mockLocal.deleteFile).not.toHaveBeenCalled();

      // Even in Cloudinary mode, a legacy local path must route to Local driver
      mockCloudinary.readFile.mockClear();
      mockLocal.readFile.mockClear();
      mockCloudinary.deleteFile.mockClear();
      mockLocal.deleteFile.mockClear();

      (env as any).STORAGE_DRIVER = 'cloudinary';
      const legacyPath = './data/uploads/legacy-doc.pdf';

      await StorageService.readFile(legacyPath);
      expect(mockLocal.readFile).toHaveBeenCalledWith(legacyPath);
      expect(mockCloudinary.readFile).not.toHaveBeenCalled();

      await StorageService.deleteFile(legacyPath);
      expect(mockLocal.deleteFile).toHaveBeenCalledWith(legacyPath);
      expect(mockCloudinary.deleteFile).not.toHaveBeenCalled();

      (env as any).STORAGE_DRIVER = 'local'; // Reset
    });
  });
});
