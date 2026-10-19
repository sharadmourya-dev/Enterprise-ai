import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { RedisService } from '../src/services/redis.service.js';
import { env } from '../src/config/env.js';

beforeAll(async () => {
  await connectDatabase(env.MONGODB_TEST_URI);
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    // Drop test database to keep tests isolated
    await mongoose.connection.dropDatabase();
  }
  await disconnectDatabase();
  await RedisService.closeConnection();
});
