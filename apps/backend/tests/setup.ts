import mongoose from 'mongoose';
import {
  connectDatabase,
  disconnectDatabase,
  assertSafeTestDatabaseUri,
  assertSafeTestDatabaseConnection,
} from '../src/config/db.js';
import { RedisService } from '../src/services/redis.service.js';
import { MailService } from '../src/services/mail.service.js';
import { env } from '../src/config/env.js';

beforeAll(async () => {
  // Fail closed: Explicitly verify test URI is isolated and non-cloud before connecting
  assertSafeTestDatabaseUri(env.MONGODB_TEST_URI);
  await connectDatabase(env.MONGODB_TEST_URI);
  assertSafeTestDatabaseConnection(mongoose.connection);

  // Default safeguard: Prevent automated tests from sending real emails to external SMTP servers
  MailService.setTransporter({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock_test_message_id' }),
  } as any);
});

afterAll(async () => {
  MailService.setTransporter(null);
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
