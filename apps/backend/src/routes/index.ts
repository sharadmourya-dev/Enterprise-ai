import { Router } from 'express';
import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';
import documentRoutes from './document.routes.js';
import ragRoutes from './rag.routes.js';
import conversationRoutes from './conversation.routes.js';
import adminAnalyticsRoutes from './admin-analytics.routes.js';
import adminAuditRoutes from './admin-audit.routes.js';
import adminUserRoutes from './admin-user.routes.js';
import adminDocumentRoutes from './admin-document.routes.js';
import feedbackRoutes from './feedback.routes.js';
import chatRoutes from './chat.routes.js';
import searchRoutes from './search.routes.js';
import { setupSwagger } from '../docs/swagger.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { requireClearance } from '../middlewares/clearance.middleware.js';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';

const router = Router();

// Swagger API Documentation UI & raw OpenAPI specification
setupSwagger(router);

// Health routes
router.use('/health', healthRoutes);

// Auth v1 routes
router.use('/api/v1/auth', authRoutes);
router.use('/api/v1/health', healthRoutes);

// Document v1 routes
router.use('/api/v1/documents', documentRoutes);

// RAG v1 routes
router.use('/api/v1/rag', ragRoutes);

// Conversation v1 routes
router.use('/api/v1/conversations', conversationRoutes);

// Compatibility alias v1 routes (Phase 2C)
router.use('/api/v1/chat', chatRoutes);
router.use('/api/v1/search', searchRoutes);

// Feedback v1 routes
router.use('/api/v1/feedback', feedbackRoutes);

// Admin v1 routes
router.use('/api/v1/admin/analytics', adminAnalyticsRoutes);
router.use('/api/v1/admin/audit', adminAuditRoutes);
router.use('/api/v1/admin/users', adminUserRoutes);
router.use('/api/v1/admin/documents', adminDocumentRoutes);

// Test endpoints for RBAC & Clearance integration testing
router.get(
  '/api/v1/test/admin-only',
  authenticate,
  requireRole(Role.ADMIN, Role.SUPER_ADMIN),
  (_req, res) => {
    res.status(200).json({ success: true, message: 'Admin access granted' });
  }
);

router.get(
  '/api/v1/test/confidential-clearance',
  authenticate,
  requireClearance(ClearanceLevel.CONFIDENTIAL),
  (_req, res) => {
    res.status(200).json({ success: true, message: 'Confidential access granted' });
  }
);

export default router;
