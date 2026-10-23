import http from 'http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { QdrantService } from './services/qdrant.service.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { IngestionWorker } from './queue/ingestion.worker.js';
import { closeIngestionQueue } from './queue/ingestion.queue.js';

export interface IBootstrapOptions {
  skipListen?: boolean;
  workerOverride?: IngestionWorker;
  serverOverride?: http.Server;
}

export interface IBootstrapResult {
  server?: http.Server;
  embeddedWorker: IngestionWorker | null;
  shutdown: (signal: string) => Promise<void>;
}

export const SHUTDOWN_TIMEOUT_MS = 25000;

export async function bootstrap(options: IBootstrapOptions = {}): Promise<IBootstrapResult> {
  let embeddedWorker: IngestionWorker | null = null;
  let server: http.Server | undefined;
  let shutdownPromise: Promise<void> | null = null;

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

    // Conditionally initialize embedded BullMQ document ingestion worker
    if (env.EMBEDDED_WORKER_ENABLED) {
      try {
        logger.info('Initializing embedded document ingestion worker...');
        embeddedWorker = options.workerOverride ?? new IngestionWorker();
        // Await readiness before opening HTTP port to prevent accepting uploads if worker fails to connect
        await embeddedWorker.start(env.INGESTION_WORKER_CONCURRENCY);
        logger.info(
          `Embedded document ingestion worker active and ready (concurrency: ${env.INGESTION_WORKER_CONCURRENCY}).`
        );
      } catch (workerStartErr: unknown) {
        const workerMsg = workerStartErr instanceof Error ? workerStartErr.message : String(workerStartErr);
        logger.error('Failed to start embedded ingestion worker during bootstrap:', { error: workerMsg });
        // Clean up partially started worker resources if any
        if (embeddedWorker) {
          try {
            await embeddedWorker.stop();
          } catch (cleanupErr: unknown) {
            const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            logger.warn('Error during failed embedded worker cleanup:', { error: cleanupMsg });
          }
          embeddedWorker = null;
        }
        // Fail bootstrap cleanly: do not leave API running when worker failed
        throw new Error(`Embedded document ingestion worker startup failed: ${workerMsg}`);
      }
    }

    if (options.serverOverride) {
      server = options.serverOverride;
    } else if (!options.skipListen) {
      server = app.listen(env.PORT, () => {
        logger.info(`Enterprise AI Copilot Backend running on http://localhost:${env.PORT}`);
        logger.info(`Health check: http://localhost:${env.PORT}/health/readiness`);
      });
    }

    const shutdown = (signal: string): Promise<void> => {
      // Single-flight guard: prevent concurrent SIGINT/SIGTERM from executing teardown twice
      if (shutdownPromise) {
        logger.info(`Shutdown already in progress; ignoring duplicate ${signal} signal.`);
        return shutdownPromise;
      }

      shutdownPromise = (async () => {
        logger.info(`Received ${signal}. Gracefully shutting down...`);

        // Force shutdown timeout (25s budget fitting within Render 30s SIGTERM window)
        const forceTimer = setTimeout(() => {
          logger.error(`Forced shutdown due to timeout (${SHUTDOWN_TIMEOUT_MS}ms).`);
          process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceTimer.unref();

        try {
          // 1. Stop HTTP server from accepting new traffic and close idle keep-alive connections
          if (server) {
            try {
              if (typeof (server as any).closeIdleConnections === 'function') {
                (server as any).closeIdleConnections();
              }

              await new Promise<void>((resolve) => {
                server!.close((err) => {
                  if (err) {
                    logger.warn('HTTP server close encountered non-fatal error:', { error: err.message });
                  } else {
                    logger.info('HTTP server closed.');
                  }
                  resolve();
                });
              });
            } catch (httpCloseErr: unknown) {
              const httpMsg = httpCloseErr instanceof Error ? httpCloseErr.message : String(httpCloseErr);
              logger.warn('Error during HTTP server closure:', { error: httpMsg });
            }
          }

          // 2. Stop embedded worker before dependent resources (Redis, DB) are closed
          if (embeddedWorker) {
            try {
              logger.info('Stopping embedded ingestion worker gracefully...');
              await embeddedWorker.stop();
              logger.info('Embedded ingestion worker stopped successfully.');
            } catch (workerStopErr: unknown) {
              const stopMsg = workerStopErr instanceof Error ? workerStopErr.message : String(workerStopErr);
              logger.warn('Error while stopping embedded ingestion worker:', { error: stopMsg });
            }
          }

          // 3. Close BullMQ queue producer and shared Redis connection
          try {
            await closeIngestionQueue();
            logger.info('Ingestion queue connections closed.');
          } catch (queueCloseErr: unknown) {
            const queueMsg = queueCloseErr instanceof Error ? queueCloseErr.message : String(queueCloseErr);
            logger.warn('Error while closing ingestion queue:', { error: queueMsg });
          }

          // 4. Disconnect MongoDB
          try {
            await disconnectDatabase();
            logger.info('Database disconnected.');
          } catch (dbErr: unknown) {
            const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
            logger.warn('Error disconnecting database:', { error: dbMsg });
          }
        } finally {
          clearTimeout(forceTimer);
        }

        if (process.env.NODE_ENV !== 'test') {
          process.exit(0);
        }
      })();

      return shutdownPromise;
    };

    if (process.env.NODE_ENV !== 'test') {
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    }

    return {
      server,
      embeddedWorker,
      shutdown,
    };
  } catch (error) {
    logger.error('Fatal error during backend bootstrap:', error);
    try {
      await disconnectDatabase();
    } catch {
      // Ignore secondary disconnect error
    }
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error;
  }
}

// Only start listening if invoked directly
if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
