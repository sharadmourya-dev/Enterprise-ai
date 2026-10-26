import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { Permission } from '@enterprise-ai/shared-types';
import { DocumentController } from '../controllers/document.controller.js';
import { env } from '../config/env.js';

const router = Router();

// Configure multer for memory storage with explicit file size threshold
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE_BYTES,
    files: 1, // Single file upload per request
  },
});

// All document routes require authentication
router.use(authenticate);

// 1. Upload a document (requires explicit documents:upload permission or admin role)
router.post(
  '/upload',
  requirePermission(Permission.DOCUMENTS_UPLOAD),
  upload.single('file'),
  DocumentController.upload
);

// 2. List visible documents
router.get('/', DocumentController.list);

// 3. Get document metadata & status
router.get('/:id', DocumentController.getById);

// 4. Retry failed document processing
router.post('/:id/retry', DocumentController.retry);

// 5. Delete document and associated vectors
router.delete('/:id', DocumentController.delete);

export default router;
