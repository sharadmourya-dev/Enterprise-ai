import { Router } from 'express';
import { AdminAuditController } from '../controllers/admin-audit.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { Role } from '@enterprise-ai/shared-types';

const router = Router();

// Privileged audit routes require authenticated ADMIN or SUPER_ADMIN
router.use(authenticate);
router.use(requireRole(Role.ADMIN, Role.SUPER_ADMIN));

router.get('/verify', AdminAuditController.verifyAuditChain);
router.get('/logs', AdminAuditController.listAuditLogs);

export default router;
