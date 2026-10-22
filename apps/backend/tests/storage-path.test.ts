import path from 'path';
import fsSync from 'fs';
import { resolveUploadStoragePath, StorageService } from '../src/services/storage.service.js';

describe('Deterministic Upload Storage Path Resolution Unit Tests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Absolute path configuration', () => {
    it('returns normalized absolute path directly without re-anchoring', () => {
      const customAbsolute = path.resolve('/custom/storage/volume/uploads');
      const resolved = resolveUploadStoragePath(customAbsolute);

      expect(resolved).toBe(path.normalize(customAbsolute));
      expect(path.isAbsolute(resolved)).toBe(true);
    });

    it('normalizes redundant traversal dots in absolute paths', () => {
      const unnormalized = path.resolve('/custom/data/./extra/../uploads');
      const expected = path.normalize(unnormalized);
      const resolved = resolveUploadStoragePath(unnormalized);

      expect(resolved).toBe(expected);
      expect(resolved).not.toContain('..');
    });
  });

  describe('2. Relative path resolution from supported launch directories', () => {
    it('anchors relative path to apps/backend when launched from monorepo root', () => {
      const mockRoot = path.resolve('/mock/workspace/enterprise-ai');
      const expectedBackendDir = path.resolve(mockRoot, 'apps', 'backend');

      jest.spyOn(process, 'cwd').mockReturnValue(mockRoot);
      jest.spyOn(fsSync, 'existsSync').mockImplementation((targetPath) => {
        // Return true only for the repo backend dir check: <root>/apps/backend
        return path.normalize(targetPath.toString()) === path.normalize(expectedBackendDir);
      });

      const resolved = resolveUploadStoragePath('./data/uploads');
      const expected = path.normalize(path.resolve(expectedBackendDir, './data/uploads'));

      expect(resolved).toBe(expected);
      expect(resolved.endsWith(path.join('apps', 'backend', 'data', 'uploads'))).toBe(true);
    });

    it('resolves relative path directly when launched from apps/backend working directory', () => {
      const mockBackendDir = path.resolve('/mock/workspace/enterprise-ai/apps/backend');

      jest.spyOn(process, 'cwd').mockReturnValue(mockBackendDir);
      jest.spyOn(fsSync, 'existsSync').mockImplementation(() => {
        // In apps/backend, <cwd>/apps/backend does not exist
        return false;
      });

      const resolved = resolveUploadStoragePath('./data/uploads');
      const expected = path.normalize(path.resolve(mockBackendDir, './data/uploads'));

      expect(resolved).toBe(expected);
      expect(resolved.endsWith(path.join('apps', 'backend', 'data', 'uploads'))).toBe(true);
    });

    it('guarantees identical physical path regardless of root vs backend launch location', () => {
      const mockRoot = path.resolve('/mock/workspace/enterprise-ai');
      const mockBackendDir = path.resolve(mockRoot, 'apps', 'backend');

      // Scenario A: Launched from repo root (e.g. backend server via npm run dev from root)
      jest.spyOn(process, 'cwd').mockReturnValue(mockRoot);
      jest.spyOn(fsSync, 'existsSync').mockImplementation((targetPath) => {
        return path.normalize(targetPath.toString()) === path.normalize(mockBackendDir);
      });
      const resolvedFromRoot = resolveUploadStoragePath('./data/uploads');

      jest.restoreAllMocks();

      // Scenario B: Launched from apps/backend (e.g. background worker via cd apps/backend && npm run worker)
      jest.spyOn(process, 'cwd').mockReturnValue(mockBackendDir);
      jest.spyOn(fsSync, 'existsSync').mockImplementation(() => false);
      const resolvedFromBackend = resolveUploadStoragePath('./data/uploads');

      expect(resolvedFromRoot).toBe(resolvedFromBackend);
      expect(resolvedFromRoot.endsWith(path.join('apps', 'backend', 'data', 'uploads'))).toBe(true);
    });
  });

  describe('3. Normalization and storageDir integration', () => {
    it('cleans redundant segments in relative configurations', () => {
      const mockBackendDir = path.resolve('/mock/workspace/enterprise-ai/apps/backend');
      jest.spyOn(process, 'cwd').mockReturnValue(mockBackendDir);
      jest.spyOn(fsSync, 'existsSync').mockReturnValue(false);

      const resolved = resolveUploadStoragePath('./data/./nested/../uploads');
      const expected = path.normalize(path.resolve(mockBackendDir, './data/uploads'));

      expect(resolved).toBe(expected);
      expect(resolved).not.toContain('nested');
    });

    it('StorageService.getStorageDir() returns an absolute, non-empty normalized path', () => {
      const storageDir = StorageService.getStorageDir();

      expect(typeof storageDir).toBe('string');
      expect(storageDir.length).toBeGreaterThan(0);
      expect(path.isAbsolute(storageDir)).toBe(true);
      expect(storageDir).toBe(path.normalize(storageDir));
    });
  });
});
