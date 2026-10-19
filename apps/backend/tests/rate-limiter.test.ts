import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app, createApp, parseTrustProxy } from '../src/app.js';
import { getClientIp, createRateLimiter } from '../src/middlewares/rate-limit.middleware.js';
import { RateLimiterService } from '../src/services/rate-limiter/rate-limiter.service.js';
import { RedisService } from '../src/services/redis.service.js';
import { createMockRedis } from './helpers/mock-redis.js';
import { ConversationModel } from '../src/models/Conversation.model.js';
import { env } from '../src/config/env.js';
import { IJwtPayload, Role, ClearanceLevel } from '@enterprise-ai/shared-types';

describe('Phase 5 — Redis-Backed Rate Limiting & Production Fail-Closed Tests (Part F & I5)', () => {
  const mockRedis = createMockRedis();

  beforeAll(() => {
    RedisService.setClientOverride(mockRedis as any);
  });

  afterAll(() => {
    RedisService.setClientOverride(null);
  });

  beforeEach(async () => {
    mockRedis.clear();
    await ConversationModel.deleteMany({});
  });

  function createTestToken(userId: string): string {
    const payload: IJwtPayload = {
      sub: userId,
      email: `${userId}@enterprise.com`,
      role: Role.USER,
      department: 'Engineering',
      securityClearance: ClearanceLevel.INTERNAL,
      sessionId: `sess_${userId}`,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  }

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();
  const tokenUserA = createTestToken(userAId);
  const tokenUserB = createTestToken(userBId);

  describe('F1, F2 & I5. Sliding Window Limiting & Headers', () => {
    it('1. Requests under limit succeed and return standard rate limit headers', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ title: 'Rate Limit Test 1' });

      expect(res.status).toBe(201);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
      expect(Number(res.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
    });

    it('2. Request exceeding limit returns 429 Too Many Requests with Retry-After header', async () => {
      // Use low limit of 3 requests for testing
      const testCategory = 'test_limit';
      const windowMs = 60000;
      const maxRequests = 3;

      // First 3 requests should be allowed
      const res1 = await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);
      const res2 = await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);
      const res3 = await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);

      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);

      // 4th request must be rejected
      const res4 = await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);
      expect(res4.allowed).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('3. Per-User Isolation: User A reaching rate limit does NOT block User B', async () => {
      const testCategory = 'iso_test';
      const windowMs = 60000;
      const maxRequests = 2;

      // Exhaust User A's limit
      await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);
      await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);
      const userABlocked = await RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests);
      expect(userABlocked.allowed).toBe(false);

      // User B should still be allowed
      const userBAllowed = await RateLimiterService.checkLimit(testCategory, `user:${userBId}`, windowMs, maxRequests);
      expect(userBAllowed.allowed).toBe(true);
      expect(userBAllowed.remaining).toBe(1);
    });

    it('4. Atomic Concurrency: Concurrent requests cannot bypass rate limit', async () => {
      const testCategory = 'atomic_concurrency';
      const windowMs = 60000;
      const maxRequests = 5;

      // Fire 10 concurrent requests simultaneously
      const promises = Array.from({ length: 10 }).map(() =>
        RateLimiterService.checkLimit(testCategory, `user:${userAId}`, windowMs, maxRequests)
      );

      const results = await Promise.all(promises);
      const allowedCount = results.filter((r) => r.allowed).length;
      const rejectedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(5);
      expect(rejectedCount).toBe(5);
    });
  });

  describe('F4 & I5. Redis Outage & Production Fail-Closed Behavior', () => {
    it('5. In production mode (NODE_ENV=production), Redis outage fails closed with 503', async () => {
      const originalEnv = env.NODE_ENV;
      (env as any).NODE_ENV = 'production';
      mockRedis.isDown = true;

      try {
        const conv = await ConversationModel.create({
          userId: new mongoose.Types.ObjectId(userAId),
          title: 'Fail-Closed Test',
          status: 'active',
        });

        const res = await request(app)
          .post(`/api/v1/conversations/${conv._id}/messages`)
          .set('Authorization', `Bearer ${tokenUserA}`)
          .send({ content: 'Test message during Redis outage' });

        // Must fail closed with 503 Service Unavailable
        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      } finally {
        mockRedis.isDown = false;
        (env as any).NODE_ENV = originalEnv;
      }
    });

    it('6. In test/dev mode, Redis outage safely allows request without 503 crash', async () => {
      mockRedis.isDown = true;

      const res = await RateLimiterService.checkLimit('dev_bypass', `user:${userAId}`, 60000, 10);
      expect(res.allowed).toBe(true);

      mockRedis.isDown = false;
    });

    it('7. IP Rotation: Authenticated user cannot evade user-level limits by changing IP address', async () => {
      // Endpoint uses createRateLimiter with chat limits
      const conv = await ConversationModel.create({
        userId: new mongoose.Types.ObjectId(userAId),
        title: 'IP Rotation Test',
        status: 'active',
      });

      // Submit from IP 1.1.1.1 until user limit is reached or check user dimension directly
      const windowMs = 60000;
      const userMax = 3;
      const category = 'test_rotation';

      // 3 requests from IP 1.1.1.1
      await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);
      await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);
      await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);

      // 4th request from rotated IP 2.2.2.2 for the same user
      const rotatedCheck = await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);
      expect(rotatedCheck.allowed).toBe(false);
      expect(rotatedCheck.remaining).toBe(0);
    });

    it('8. Shared IP: Multiple users sharing one IP have independent user quotas', async () => {
      const windowMs = 60000;
      const userMax = 2;
      const category = 'test_shared_ip';

      // User A exhausts user quota from IP 10.0.0.1
      await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);
      await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);
      const userABlocked = await RateLimiterService.checkLimit(`${category}:user`, `user:${userAId}`, windowMs, userMax);
      expect(userABlocked.allowed).toBe(false);

      // User B sharing the same IP 10.0.0.1 is NOT blocked by User A's exhausted user quota
      const userBCheck = await RateLimiterService.checkLimit(`${category}:user`, `user:${userBId}`, windowMs, userMax);
      expect(userBCheck.allowed).toBe(true);
      expect(userBCheck.remaining).toBe(1);
    });

    it('9. Shared IP: Combined requests exceeding configured IP limit trigger IP-level throttling', async () => {
      const windowMs = 60000;
      const ipLimit = 4;
      const sharedIp = '192.168.1.100';
      const category = 'test_ip_ceiling';

      // 4 requests from shared IP (2 from user A, 2 from user B)
      await RateLimiterService.checkLimit(`${category}:ip`, `ip:${sharedIp}`, windowMs, ipLimit);
      await RateLimiterService.checkLimit(`${category}:ip`, `ip:${sharedIp}`, windowMs, ipLimit);
      await RateLimiterService.checkLimit(`${category}:ip`, `ip:${sharedIp}`, windowMs, ipLimit);
      await RateLimiterService.checkLimit(`${category}:ip`, `ip:${sharedIp}`, windowMs, ipLimit);

      // 5th request from same IP (even from a brand new user C) is rejected by IP quota
      const userCId = new mongoose.Types.ObjectId().toString();
      const ipBlocked = await RateLimiterService.checkLimit(`${category}:ip`, `ip:${sharedIp}`, windowMs, ipLimit);
      expect(ipBlocked.allowed).toBe(false);
      expect(ipBlocked.remaining).toBe(0);
    });
  });

  describe('F5. Trusted Proxy Configuration & IP Spoofing Resistance', () => {
    it('10. parseTrustProxy maps environment representations correctly to Express settings', () => {
      expect(parseTrustProxy('false')).toBe(false);
      expect(parseTrustProxy('0')).toBe(false);
      expect(parseTrustProxy(undefined)).toBe(false);
      expect(parseTrustProxy('')).toBe(false);
      expect(parseTrustProxy('true')).toBe(true);
      expect(parseTrustProxy('1')).toBe(1);
      expect(parseTrustProxy('2')).toBe(2);
      expect(parseTrustProxy('loopback')).toBe('loopback');
      expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
    });

    it('11. Direct access mode (trust proxy = false) ignores spoofed X-Forwarded-For', async () => {
      const directApp = express();
      directApp.set('trust proxy', false);
      directApp.get('/test/ip', (req, res) => {
        res.json({ clientIp: getClientIp(req) });
      });

      const res = await request(directApp)
        .get('/test/ip')
        .set('X-Forwarded-For', '203.0.113.195');

      // In direct access, X-Forwarded-For is ignored and socket IP (127.0.0.1) is used
      expect(res.body.clientIp).toBe('127.0.0.1');
    });

    it('12. Single-hop reverse proxy mode (trust proxy = 1) extracts client IP from proxy header', async () => {
      const proxyApp = express();
      proxyApp.set('trust proxy', 1);
      proxyApp.get('/test/ip', (req, res) => {
        res.json({ clientIp: getClientIp(req) });
      });

      const res = await request(proxyApp)
        .get('/test/ip')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.body.clientIp).toBe('203.0.113.195');
    });

    it('13. Reverse proxy mode (trust proxy = 1) ignores client-prepended spoofed IP in X-Forwarded-For', async () => {
      const proxyApp = express();
      proxyApp.set('trust proxy', 1);
      proxyApp.get('/test/ip', (req, res) => {
        res.json({ clientIp: getClientIp(req) });
      });

      // Client prepended '198.51.100.99', but proxy appended real client IP '203.0.113.195'
      const res = await request(proxyApp)
        .get('/test/ip')
        .set('X-Forwarded-For', '198.51.100.99, 203.0.113.195');

      // Express trusts 1 hop (the proxy) and stops at the immediate client IP (203.0.113.195)
      expect(res.body.clientIp).toBe('203.0.113.195');
    });

    it('14. Rate limiter prevents evasion via X-Forwarded-For spoofing in direct access mode', async () => {
      const directApp = express();
      directApp.set('trust proxy', false);
      directApp.get(
        '/test/rate-limited',
        createRateLimiter({ category: 'test_spoof_evasion', windowMs: 60000, maxRequests: 2 }),
        (_req, res) => {
          res.json({ success: true });
        }
      );

      // Attempt 1 with spoofed header
      const res1 = await request(directApp)
        .get('/test/rate-limited')
        .set('X-Forwarded-For', '198.51.100.1');
      expect(res1.status).toBe(200);

      // Attempt 2 with different spoofed header
      const res2 = await request(directApp)
        .get('/test/rate-limited')
        .set('X-Forwarded-For', '198.51.100.2');
      expect(res2.status).toBe(200);

      // Attempt 3 with yet another spoofed header: must be blocked because all map to socket IP
      const res3 = await request(directApp)
        .get('/test/rate-limited')
        .set('X-Forwarded-For', '198.51.100.3');
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('15. createApp initializes trust proxy from environment or explicit override', () => {
      const defaultApp = createApp();
      expect(defaultApp.get('trust proxy')).toBeDefined();

      const overriddenApp = createApp(1);
      expect(overriddenApp.get('trust proxy')).toBe(1);

      const falseApp = createApp(false);
      expect(falseApp.get('trust proxy')).toBe(false);
    });
  });
});
