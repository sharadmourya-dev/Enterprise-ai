import { ApiClient, ApiClientError } from './api-client';

describe('ApiClient', () => {
  const originalEnv = process.env;
  const mockApiUrl = 'http://localhost:5000/api/v1';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NEXT_PUBLIC_API_URL: mockApiUrl };
    // Clear auth configuration
    ApiClient.configureAuth(
      () => null,
      async () => null,
      () => {}
    );
    // Reset global fetch
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails with a clear error if NEXT_PUBLIC_API_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    await expect(ApiClient.get('/test')).rejects.toThrow(
      /Configuration error: NEXT_PUBLIC_API_URL environment variable is missing/
    );
  });

  it('parses success envelope and returns data payload', async () => {
    const mockData = { id: 'doc-123', title: 'Security Guide' };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: mockData,
        error: null,
        meta: { timestamp: new Date().toISOString(), requestId: 'req-abc' },
      }),
    });

    const result = await ApiClient.get<typeof mockData>('/documents');
    expect(result).toEqual(mockData);

    const [calledUrl, calledOptions] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toBe('http://localhost:5000/api/v1/documents');
    expect(calledOptions.method).toBe('GET');
    expect(calledOptions.headers.get('Accept')).toBe('application/json');
    expect(calledOptions.headers.get('x-request-id')).toBeDefined();
  });

  it('deduplicates /api/v1 prefix when endpoint already includes it', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: [],
        error: null,
      }),
    });

    await ApiClient.get('/api/v1/conversations');
    const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toBe('http://localhost:5000/api/v1/conversations');
  });

  it('correctly builds URLs with query parameters without prefix duplication', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: [],
        error: null,
      }),
    });

    await ApiClient.get('/api/v1/documents', { page: 1, limit: 10 });
    const [calledUrl] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toBe('http://localhost:5000/api/v1/documents?page=1&limit=10');
  });

  it('parses error envelope and throws ApiClientError with code and details', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid payload submitted',
          details: [{ field: 'email', message: 'Invalid email format' }],
        },
        meta: { timestamp: new Date().toISOString(), requestId: 'req-err-1' },
      }),
    });

    try {
      await ApiClient.post('/auth/register', { email: 'bad-email' });
      fail('Expected ApiClientError to be thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.statusCode).toBe(400);
      expect(apiErr.code).toBe('VALIDATION_ERROR');
      expect(apiErr.message).toBe('Invalid payload submitted');
      expect(apiErr.details).toEqual([{ field: 'email', message: 'Invalid email format' }]);
      expect(apiErr.requestId).toBe('req-err-1');
    }
  });

  it('handles network failure and assigns statusCode 0', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(ApiClient.get('/health')).rejects.toMatchObject({
      name: 'ApiClientError',
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: 'Failed to fetch',
    });
  });

  it('attaches Authorization header when accessToken is provided', async () => {
    ApiClient.configureAuth(
      () => 'test-valid-access-token',
      async () => null,
      () => {}
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { status: 'OK' } }),
    });

    await ApiClient.get('/auth/me');
    const calledOptions = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(calledOptions.headers.get('Authorization')).toBe('Bearer test-valid-access-token');
  });

  it('skips Authorization header when skipAuth is true', async () => {
    ApiClient.configureAuth(
      () => 'test-valid-access-token',
      async () => null,
      () => {}
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: {} }),
    });

    await ApiClient.post('/auth/login', { email: 'a@b.com' }, { skipAuth: true });
    const calledOptions = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(calledOptions.headers.get('Authorization')).toBeNull();
  });

  it('does not set Content-Type header on FormData uploads', async () => {
    const formData = new FormData();
    formData.append('title', 'Policy');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 202,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { documentId: 'doc-1' } }),
    });

    await ApiClient.upload('/documents/upload', formData);
    const calledOptions = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(calledOptions.headers.get('Content-Type')).toBeNull();
  });

  describe('Token Refresh & Concurrency Coordination', () => {
    it('catches 401 TOKEN_EXPIRED, refreshes token, and retries original request once', async () => {
      let token = 'initial-expired-token';
      const refreshMock = jest.fn().mockImplementation(async () => {
        token = 'fresh-new-token';
        return token;
      });
      const sessionClearMock = jest.fn();

      ApiClient.configureAuth(() => token, refreshMock, sessionClearMock);

      // First call fails with 401 TOKEN_EXPIRED
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired' },
        }),
      });

      // Second call (retry) succeeds with 200
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: { profile: 'authorized_data' },
        }),
      });

      const result = await ApiClient.get('/auth/me');
      expect(result).toEqual({ profile: 'authorized_data' });
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(sessionClearMock).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Verify the retry request used the refreshed token
      const retryCallHeaders = (global.fetch as jest.Mock).mock.calls[1][1].headers;
      expect(retryCallHeaders.get('Authorization')).toBe('Bearer fresh-new-token');
    });

    it('coordinates concurrent expired requests through a SINGLE refresh operation', async () => {
      let token = 'stale-token';
      const refreshMock = jest.fn().mockImplementation(async () => {
        // Small delay to simulate network latency
        await new Promise((res) => setTimeout(res, 50));
        token = 'coalesced-refreshed-token';
        return token;
      });

      ApiClient.configureAuth(() => token, refreshMock, () => {});

      // Mock 3 simultaneous requests failing with TOKEN_EXPIRED
      for (let i = 0; i < 3; i++) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: false,
            error: { code: 'TOKEN_EXPIRED', message: 'Token expired' },
          }),
        });
      }

      // Mock 3 successful retries
      for (let i = 0; i < 3; i++) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true, data: { item: i } }),
        });
      }

      // Execute 3 requests concurrently
      const [res1, res2, res3] = await Promise.all([
        ApiClient.get('/data/1'),
        ApiClient.get('/data/2'),
        ApiClient.get('/data/3'),
      ]);

      expect(res1).toEqual({ item: 0 });
      expect(res2).toEqual({ item: 1 });
      expect(res3).toEqual({ item: 2 });

      // CRITICAL: refreshMock was called only ONCE despite 3 concurrent 401s
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry arbitrary 401 responses (e.g. TOKEN_INVALID)', async () => {
      const refreshMock = jest.fn();
      ApiClient.configureAuth(() => 'bad-token', refreshMock, () => {});

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { code: 'TOKEN_INVALID', message: 'Invalid token signature' },
        }),
      });

      await expect(ApiClient.get('/secure')).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
      });
      expect(refreshMock).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('clears session when refresh fails and halts retries', async () => {
      const refreshMock = jest.fn().mockResolvedValue(null);
      const sessionClearMock = jest.fn();

      ApiClient.configureAuth(() => 'stale-token', refreshMock, sessionClearMock);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'Expired' },
        }),
      });

      await expect(ApiClient.get('/test')).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
      expect(sessionClearMock).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
