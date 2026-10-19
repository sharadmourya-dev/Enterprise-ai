import { Router } from 'express';
import { AdminAnalyticsController } from '../controllers/admin-analytics.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { Role } from '@enterprise-ai/shared-types';

const router = Router();

// All analytics endpoints require authenticated ADMIN or SUPER_ADMIN privileges
router.use(authenticate);
router.use(requireRole(Role.ADMIN, Role.SUPER_ADMIN));

router.get('/overview', AdminAnalyticsController.getOverview);
router.get('/trends', AdminAnalyticsController.getTrends);
router.get('/ingestion', AdminAnalyticsController.getIngestionStats);

export default router;
