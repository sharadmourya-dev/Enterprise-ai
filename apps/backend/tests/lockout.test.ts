import request from 'supertest';
import { app } from '../src/app.js';
import { UserModel } from '../src/models/User.model.js';
import { SessionModel } from '../src/models/Session.model.js';

describe('Login Enumeration & Lockout Concurrency', () => {
  beforeEach(async () => {
    await UserModel.deleteMany({});
    await SessionModel.deleteMany({});
  });

  const registeredUser = {
    email: 'charlie.finance@enterprise.com',
    password: 'ValidSecretPassword123!',
    name: 'Charlie Finance',
    department: 'Finance',
  };

  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send(registeredUser);
  });

  it('1. Returns identical generic response for unknown user, wrong password, and locked account', async () => {
    // A: Unknown email
    const unknownRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@enterprise.com', password: 'AnyPassword123!' })
      .expect(401);

    expect(unknownRes.body.error.message).toBe('Invalid email or password');

    // B: Wrong password
    const wrongPwRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: registeredUser.email, password: 'WrongPassword123!' })
      .expect(401);

    expect(wrongPwRes.body.error.message).toBe('Invalid email or password');

    // C: Locked account
    await UserModel.updateOne(
      { email: registeredUser.email },
      { lockoutUntil: new Date(Date.now() + 15 * 60 * 1000) }
    );

    const lockedRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: registeredUser.email, password: registeredUser.password })
      .expect(401);

    expect(lockedRes.body.error.message).toBe('Invalid email or password');
  });

  it('2. Five consecutive failed login attempts trigger a 15-minute lockout', async () => {
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: registeredUser.email, password: 'BadPassword' })
        .expect(401);

      const user = await UserModel.findOne({ email: registeredUser.email });
      expect(user?.failedLoginAttempts).toBe(i);
      expect(user?.lockoutUntil).toBeNull();
    }

    // 5th failed attempt
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: registeredUser.email, password: 'BadPassword' })
      .expect(401);

    const lockedUser = await UserModel.findOne({ email: registeredUser.email });
    expect(lockedUser?.failedLoginAttempts).toBe(5);
    expect(lockedUser?.lockoutUntil).not.toBeNull();
    // Verify lockout timestamp is approximately 15 minutes into the future
    const remainingMs = lockedUser!.lockoutUntil!.getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(14 * 60 * 1000);
    expect(remainingMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('3. Successful login resets failed attempts and lockout window to null', async () => {
    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: registeredUser.email, password: 'BadPassword' });
    }

    const preSuccessUser = await UserModel.findOne({ email: registeredUser.email });
    expect(preSuccessUser?.failedLoginAttempts).toBe(3);

    // Successful login
    const successRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: registeredUser.email, password: registeredUser.password })
      .expect(200);

    expect(successRes.body.success).toBe(true);

    const postSuccessUser = await UserModel.findOne({ email: registeredUser.email });
    expect(postSuccessUser?.failedLoginAttempts).toBe(0);
    expect(postSuccessUser?.lockoutUntil).toBeNull();
  });

  it('4. Lockout expiry allows subsequent successful login', async () => {
    // Simulate expired lockout (lockout ended 1 second ago)
    await UserModel.updateOne(
      { email: registeredUser.email },
      {
        failedLoginAttempts: 5,
        lockoutUntil: new Date(Date.now() - 1000),
      }
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: registeredUser.email, password: registeredUser.password })
      .expect(200);

    expect(res.body.success).toBe(true);

    const user = await UserModel.findOne({ email: registeredUser.email });
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockoutUntil).toBeNull();
  });

  it('5. Concurrent failed attempts increment atomically without bypassing lockout threshold', async () => {
    // Fire 10 parallel bad password requests simultaneously
    const attempts = Array.from({ length: 10 }).map(() =>
      request(app).post('/api/v1/auth/login').send({ email: registeredUser.email, password: 'BadPassword' })
    );

    await Promise.all(attempts);

    const user = await UserModel.findOne({ email: registeredUser.email });
    expect(user?.failedLoginAttempts).toBe(10);
    expect(user?.lockoutUntil).not.toBeNull();
    expect(user!.lockoutUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});
