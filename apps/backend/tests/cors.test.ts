import request from 'supertest';
import { app, getAllowedOrigins } from '../src/app.js';
import { env } from '../src/config/env.js';

describe('CORS Preflight Middleware & Origin Enforcement', () => {
  it('1. allows x-request-id in Access-Control-Allow-Headers on OPTIONS preflight', async () => {
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

  it('2. allows exact development origin http://localhost:3001 on OPTIONS preflight', async () => {
    const res = await request(app)
      .options('/api/v1/auth/forgot-password')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Accept');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('3. rejects unapproved origins by omitting Access-Control-Allow-Origin header', async () => {
    const res = await request(app)
      .options('/api/v1/auth/forgot-password')
      .set('Origin', 'https://unauthorized-attacker.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');

    // CORS specification: preflight for unapproved origin must omit allow-origin header
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('4. returns correct CORS headers on actual POST /api/v1/auth/forgot-password from http://localhost:3001', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', 'http://localhost:3001')
      .send({ email: 'nonexistent.probe@enterprise.com' });

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('5. strict production isolation: getAllowedOrigins in production permits only configured FRONTEND_URL', () => {
    const prodOrigins = getAllowedOrigins('https://copilot.enterprise.com', 'production');
    expect(prodOrigins.has('https://copilot.enterprise.com')).toBe(true);
    expect(prodOrigins.has('http://localhost:3000')).toBe(false);
    expect(prodOrigins.has('http://localhost:3001')).toBe(false);
    expect(prodOrigins.has('http://127.0.0.1:3001')).toBe(false);

    // Supports comma-separated origins in production
    const multiProdOrigins = getAllowedOrigins('https://copilot.enterprise.com, https://admin.enterprise.com', 'production');
    expect(multiProdOrigins.has('https://copilot.enterprise.com')).toBe(true);
    expect(multiProdOrigins.has('https://admin.enterprise.com')).toBe(true);
    expect(multiProdOrigins.has('http://localhost:3001')).toBe(false);
  });
});
