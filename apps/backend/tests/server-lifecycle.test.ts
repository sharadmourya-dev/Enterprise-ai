import http from 'http';
import { bootstrap, SHUTDOWN_TIMEOUT_MS } from '../src/server.js';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { QdrantService } from '../src/services/qdrant.service.js';
import { closeIngestionQueue } from '../src/queue/ingestion.queue.js';
import { IngestionWorker } from '../src/queue/ingestion.worker.js';

jest.mock('../src/config/db.js', () => ({
  connectDatabase: jest.fn().mockResolvedValue(undefined),
  disconnectDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/qdrant.service.js', () => ({
  QdrantService: {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/queue/ingestion.queue.js', () => ({
  closeIngestionQueue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/queue/ingestion.worker.js', () => {
  return {
    IngestionWorker: jest.fn().mockImplementation(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      isRunning: jest.fn().mockReturnValue(true),
    })),
  };
});

describe('Backend Server & Embedded Worker Lifecycle (Unit Tests)', () => {
  const originalWorkerFlag = env.EMBEDDED_WORKER_ENABLED;
  const originalConcurrency = env.INGESTION_WORKER_CONCURRENCY;

  beforeEach(() => {
    jest.clearAllMocks();
    (env as any).EMBEDDED_WORKER_ENABLED = false;
    (env as any).INGESTION_WORKER_CONCURRENCY = 1;
  });

  afterEach(() => {
    (env as any).EMBEDDED_WORKER_ENABLED = originalWorkerFlag;
    (env as any).INGESTION_WORKER_CONCURRENCY = originalConcurrency;
  });

  describe('1. Disabled Embedded Worker Mode', () => {
    it('does not instantiate or start IngestionWorker when EMBEDDED_WORKER_ENABLED is false', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = false;

      const result = await bootstrap({ skipListen: true });

      expect(connectDatabase).toHaveBeenCalledTimes(1);
      expect(QdrantService.ensureCollection).toHaveBeenCalledTimes(1);
      expect(IngestionWorker).not.toHaveBeenCalled();
      expect(result.embeddedWorker).toBeNull();
    });

    it('gracefully shuts down server and database without worker operations when disabled', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = false;

      const result = await bootstrap({ skipListen: true });
      await result.shutdown('SIGTERM');

      expect(closeIngestionQueue).toHaveBeenCalledTimes(1);
      expect(disconnectDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Readiness-Aware Worker Startup & Failure Handling', () => {
    it('awaits worker readiness before proceeding and starts with configured concurrency', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = true;
      (env as any).INGESTION_WORKER_CONCURRENCY = 2;

      let readinessResolved = false;
      const mockWorker = {
        start: jest.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 10));
          readinessResolved = true;
        }),
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockImplementation(() => readinessResolved),
      } as unknown as IngestionWorker;

      const result = await bootstrap({ skipListen: true, workerOverride: mockWorker });

      expect(readinessResolved).toBe(true);
      expect(mockWorker.start).toHaveBeenCalledWith(2);
      expect(result.embeddedWorker).toBe(mockWorker);
    });

    it('asynchronous readiness failure prevents API from operating, cleans up worker, and disconnects database', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = true;

      const mockStop = jest.fn().mockResolvedValue(undefined);
      const mockWorker = {
        start: jest.fn().mockRejectedValue(new Error('Redis connection handshake failed')),
        stop: mockStop,
        isRunning: jest.fn().mockReturnValue(false),
      } as unknown as IngestionWorker;

      await expect(
        bootstrap({ skipListen: true, workerOverride: mockWorker })
      ).rejects.toThrow('Embedded document ingestion worker startup failed: Redis connection handshake failed');

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(disconnectDatabase).toHaveBeenCalled();
    });
  });

  describe('3. Single-Flight Shutdown & Idle Connection Handling', () => {
    it('executes teardown only once when concurrent signals (SIGINT, SIGTERM) arrive', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = true;

      const mockStop = jest.fn().mockResolvedValue(undefined);
      const mockWorker = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: mockStop,
        isRunning: jest.fn().mockReturnValue(true),
      } as unknown as IngestionWorker;

      const result = await bootstrap({ skipListen: true, workerOverride: mockWorker });

      // Trigger concurrent shutdown calls
      const p1 = result.shutdown('SIGTERM');
      const p2 = result.shutdown('SIGINT');

      await Promise.all([p1, p2]);

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(closeIngestionQueue).toHaveBeenCalledTimes(1);
      expect(disconnectDatabase).toHaveBeenCalledTimes(1);
    });

    it('proactively closes idle keep-alive connections on HTTP server during shutdown', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = false;

      const mockCloseIdle = jest.fn();
      const mockClose = jest.fn().mockImplementation((cb: (err?: Error) => void) => cb());

      const mockServer = {
        close: mockClose,
        closeIdleConnections: mockCloseIdle,
      } as unknown as http.Server;

      const result = await bootstrap({ skipListen: true, serverOverride: mockServer });

      await result.shutdown('SIGTERM');

      expect(mockCloseIdle).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('stops worker before closing shared queue/Redis, then disconnects database in strict order', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = true;

      const executionOrder: string[] = [];
      const mockStop = jest.fn().mockImplementation(async () => {
        executionOrder.push('worker.stop');
      });
      (closeIngestionQueue as jest.Mock).mockImplementation(async () => {
        executionOrder.push('closeIngestionQueue');
      });
      (disconnectDatabase as jest.Mock).mockImplementation(async () => {
        executionOrder.push('disconnectDatabase');
      });

      const mockWorker = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: mockStop,
        isRunning: jest.fn().mockReturnValue(true),
      } as unknown as IngestionWorker;

      const result = await bootstrap({ skipListen: true, workerOverride: mockWorker });
      await result.shutdown('SIGINT');

      expect(executionOrder).toEqual(['worker.stop', 'closeIngestionQueue', 'disconnectDatabase']);
    });

    it('defines a 25-second shutdown budget fitting within the platform termination window', () => {
      expect(SHUTDOWN_TIMEOUT_MS).toBe(25000);
    });
  });

  describe('4. Shutdown Error Resilience', () => {
    it('continues teardown of queue and database even if worker.stop() throws an error', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = true;

      const mockFailingStop = jest.fn().mockRejectedValue(new Error('BullMQ worker close timeout'));

      const mockWorker = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: mockFailingStop,
        isRunning: jest.fn().mockReturnValue(true),
      } as unknown as IngestionWorker;

      const result = await bootstrap({ skipListen: true, workerOverride: mockWorker });

      await expect(result.shutdown('SIGTERM')).resolves.not.toThrow();

      expect(mockFailingStop).toHaveBeenCalledTimes(1);
      expect(closeIngestionQueue).toHaveBeenCalledTimes(1);
      expect(disconnectDatabase).toHaveBeenCalledTimes(1);
    });

    it('continues teardown of database even if closeIngestionQueue() throws an error', async () => {
      (env as any).EMBEDDED_WORKER_ENABLED = false;

      (closeIngestionQueue as jest.Mock).mockRejectedValueOnce(new Error('Redis connection drop on quit'));

      const result = await bootstrap({ skipListen: true });

      await expect(result.shutdown('SIGTERM')).resolves.not.toThrow();

      expect(closeIngestionQueue).toHaveBeenCalledTimes(1);
      expect(disconnectDatabase).toHaveBeenCalledTimes(1);
    });
  });
});
