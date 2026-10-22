import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

describe('CORS Preflight Middleware', () => {
  it('allows x-request-id in Access-Control-Allow-Headers on OPTIONS preflight', async () => {
    const res = await request(app)
      .options('/health/liveness')
      .set('Origin', env.FRONTEND_URL)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-request-id, Content-Type, Authorization');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(env.FRONTEND_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');

    const allowedHeaders = res.headers['access-control-allow-headers'];
    expect(allowedHeaders).toBeDefined();

    const headersList = allowedHeaders.toLowerCase().split(',').map((h: string) => h.trim());
    expect(headersList).toContain('x-request-id');
    expect(headersList).toContain('content-type');
    expect(headersList).toContain('authorization');
  });
});
