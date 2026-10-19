import { connectDatabase } from './config/db.js';
import { IngestionWorker } from './queue/ingestion.worker.js';
import logger from './utils/logger.js';

async function bootstrapWorker() {
  logger.info('Starting Enterprise AI Document Ingestion Worker...');

  // Connect to MongoDB
  await connectDatabase();

  const worker = new IngestionWorker();
  worker.start(5);

  logger.info('Ingestion Worker is active and listening for BullMQ document jobs.');

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down Ingestion Worker gracefully...`);
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrapWorker().catch((err) => {
  logger.error('Worker bootstrap failed', { error: err });
  process.exit(1);
});
