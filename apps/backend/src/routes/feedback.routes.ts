import { Router } from 'express';
import { FeedbackController } from '../controllers/feedback.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

// Feedback endpoints require authentication
router.use(authenticate);

router.post('/', FeedbackController.submitFeedback);
router.get('/message/:messageId', FeedbackController.getFeedbackByMessageId);

export default router;
