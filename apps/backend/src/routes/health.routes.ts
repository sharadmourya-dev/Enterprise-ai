import { Router, Request, Response } from 'express';
import { isDatabaseConnected } from '../config/db.js';

const router = Router();

router.get('/liveness', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
  });
});

router.get('/readiness', (_req: Request, res: Response) => {
  const dbConnected = isDatabaseConnected();

  if (!dbConnected) {
    res.status(503).json({
      status: 'NOT_READY',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: 'READY',
    database: 'connected',
    timestamp: new Date().toISOString(),
  });
});

export default router;
