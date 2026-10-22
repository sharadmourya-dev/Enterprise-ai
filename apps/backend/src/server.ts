import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { QdrantService } from './services/qdrant.service.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  try {
    logger.info('Connecting to MongoDB...');
    await connectDatabase();
    logger.info('MongoDB connected successfully.');

    try {
      logger.info('Ensuring Qdrant vector collection exists...');
      await QdrantService.ensureCollection();
      logger.info('Qdrant collection initialized successfully.');
    } catch (qdrantErr: unknown) {
      const qdrantMsg = qdrantErr instanceof Error ? qdrantErr.message : String(qdrantErr);
      logger.warn('Qdrant collection initialization deferred or unreachable on startup', { error: qdrantMsg });
    }

    const server = app.listen(env.PORT, () => {
      logger.info(`Enterprise AI Copilot Backend running on http://localhost:${env.PORT}`);
      logger.info(`Health check: http://localhost:${env.PORT}/health/readiness`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);
      server.close(async () => {
        logger.info('HTTP server closed.');
        await disconnectDatabase();
        logger.info('Database disconnected.');
        process.exit(0);
      });

      // Force shutdown after 10s timeout
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Fatal error during backend bootstrap:', error);
    process.exit(1);
  }
}

// Only start listening if invoked directly
if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
