import { Router } from 'express';
import { Role } from '@enterprise-ai/shared-types';
import { DocumentController } from '../controllers/document.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';

const router = Router();

// Privileged document administration routes require authenticated ADMIN or SUPER_ADMIN
router.use(authenticate);
router.use(requireRole(Role.ADMIN, Role.SUPER_ADMIN));

// DELETE /api/v1/admin/documents/:id -> delegates to canonical DocumentController.delete
router.delete('/:id', DocumentController.delete);

export default router;
