import request from 'supertest';
import { app } from '../src/app.js';

describe('Health Checks API', () => {
  it('GET /health/liveness should return 200 with status UP', async () => {
    const res = await request(app).get('/health/liveness').expect(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /health/readiness should return 200 with status READY when database is connected', async () => {
    const res = await request(app).get('/health/readiness').expect(200);
    expect(res.body.status).toBe('READY');
    expect(res.body.database).toBe('connected');
  });
});
