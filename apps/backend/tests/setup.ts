import mongoose from 'mongoose';
import {
  connectDatabase,
  disconnectDatabase,
  assertSafeTestDatabaseUri,
  assertSafeTestDatabaseConnection,
} from '../src/config/db.js';
import { RedisService } from '../src/services/redis.service.js';
import { env } from '../src/config/env.js';

beforeAll(async () => {
  // Fail closed: Explicitly verify test URI is isolated and non-cloud before connecting
  assertSafeTestDatabaseUri(env.MONGODB_TEST_URI);
  await connectDatabase(env.MONGODB_TEST_URI);
  assertSafeTestDatabaseConnection(mongoose.connection);
});

afterAll(async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      // Fail closed: Drop test database only after verifying connection is a disposable test DB
      assertSafeTestDatabaseConnection(mongoose.connection);
      await mongoose.connection.dropDatabase();
    }
  } finally {
    await disconnectDatabase();
    await RedisService.closeConnection();
  }
});
