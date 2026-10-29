import { Router } from 'express';
import { Role } from '@enterprise-ai/shared-types';
import { AdminUserController } from '../controllers/admin-user.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';

const router = Router();

// Privileged user management routes require authenticated ADMIN or SUPER_ADMIN
router.use(authenticate);
router.use(requireRole(Role.ADMIN, Role.SUPER_ADMIN));

router.get('/', AdminUserController.listUsers);
router.get('/:id', AdminUserController.getUser);
router.patch('/:id/permissions', AdminUserController.updatePermissions);
router.patch('/:id/status', AdminUserController.updateStatus);

export default router;
