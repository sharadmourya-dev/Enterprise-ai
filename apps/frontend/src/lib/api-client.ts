import { IApiResponse, IApiError } from '@enterprise-ai/shared-types';

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Array<{ field?: string; message: string }>;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    code = 'API_ERROR',
    details?: Array<{ field?: string; message: string }>,
    requestId?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
  skipAuth?: boolean;
  _isRetry?: boolean;
}

export type TokenGetter = () => string | null;
export type RefreshHandler = () => Promise<string | null>;
export type SessionClearHandler = () => void;

export class ApiClient {
  private static tokenGetter: TokenGetter | null = null;
  private static refreshHandler: RefreshHandler | null = null;
  private static sessionClearHandler: SessionClearHandler | null = null;
  private static inFlightRefresh: Promise<string | null> | null = null;

  /**
   * Configures token accessors and refresh lifecycle callbacks
   */
  public static configureAuth(
    tokenGetter: TokenGetter,
    refreshHandler: RefreshHandler,
    sessionClearHandler: SessionClearHandler
  ): void {
    this.tokenGetter = tokenGetter;
    this.refreshHandler = refreshHandler;
    this.sessionClearHandler = sessionClearHandler;
  }

  public static getAccessToken(): string | null {
    return this.tokenGetter ? this.tokenGetter() : null;
  }

  public static notifySessionClear(): void {
    this.sessionClearHandler?.();
  }

  public static getBaseUrl(): string {
    const url = process.env.NEXT_PUBLIC_API_URL;
    if (!url) {
      throw new Error(
        'Configuration error: NEXT_PUBLIC_API_URL environment variable is missing. Set NEXT_PUBLIC_API_URL in your environment configuration.'
      );
    }
    return url.replace(/\/+$/, '');
  }

  /**
   * Constructs a fully-qualified URL for an API endpoint without duplicate path prefixes.
   * If the base URL ends with /api/v1 and the endpoint also starts with /api/v1,
   * the redundant prefix from the endpoint is safely stripped.
   */
  public static buildUrl(endpoint: string): URL {
    const baseUrl = this.getBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    const parsedBase = new URL(baseUrl);
    const basePath = parsedBase.pathname.replace(/\/+$/, '');

    let normalizedPath = cleanEndpoint;
    if (basePath.endsWith('/api/v1')) {
      if (normalizedPath === '/api/v1' || normalizedPath === '/api/v1/') {
        normalizedPath = '/';
      } else if (normalizedPath.startsWith('/api/v1/')) {
        normalizedPath = normalizedPath.slice('/api/v1'.length);
      } else if (normalizedPath.startsWith('/api/v1?')) {
        normalizedPath = normalizedPath.slice('/api/v1'.length);
      }
    }

    return new URL(`${parsedBase.origin}${basePath}${normalizedPath}`);
  }

  /**
   * Generates or retrieves a unique request ID for distributed tracing
   */
  private static createRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  /**
   * Core request dispatcher with envelope parsing and single-flight token rotation
   */
  public static async request<T = unknown>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    // 1. Build URL with query parameters
    const url = this.buildUrl(endpoint);
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // 2. Prepare request headers
    const headers = new Headers(options.headers || {});
    const requestId = headers.get('x-request-id') || this.createRequestId();
    headers.set('x-request-id', requestId);

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    // Attach Authorization header if available and not skipped
    if (!options.skipAuth && this.tokenGetter) {
      const accessToken = this.tokenGetter();
      if (accessToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
    }

    // For non-FormData requests with a body, set Content-Type to application/json
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (!isFormData && options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        ...options,
        headers,
      });
    } catch (networkError: unknown) {
      const message = networkError instanceof Error ? networkError.message : 'Network request failed';
      throw new ApiClientError(message, 0, 'NETWORK_ERROR', undefined, requestId);
    }

    // 3. Parse JSON response body
    let json: IApiResponse<T> | null = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        json = (await response.json()) as IApiResponse<T>;
      } catch {
        throw new ApiClientError(
          'Failed to parse JSON response from server',
          response.status,
          'MALFORMED_RESPONSE',
          undefined,
          requestId
        );
      }
    }

    // 4. Handle TOKEN_EXPIRED: Single-flight refresh token rotation and atomic retry
    if (
      response.status === 401 &&
      json?.error?.code === 'TOKEN_EXPIRED' &&
      !options._isRetry &&
      this.refreshHandler
    ) {
      const newAccessToken = await this.coordinateTokenRefresh();

      if (newAccessToken) {
        // Retry the original request exactly once with the refreshed token
        const retryHeaders = new Headers(options.headers || {});
        retryHeaders.set('Authorization', `Bearer ${newAccessToken}`);
        retryHeaders.set('x-request-id', requestId);

        return this.request<T>(endpoint, {
          ...options,
          headers: retryHeaders,
          _isRetry: true,
        });
      }

      // If refresh returned null, notify session clear and throw original error
      this.sessionClearHandler?.();
    }

    // 5. Evaluate response success
    if (!response.ok || (json && json.success === false)) {
      const errorPayload: IApiError = json?.error || {
        code: `HTTP_${response.status}`,
        message: response.statusText || 'An error occurred during the request',
      };

      const extractedDetails = errorPayload.details?.map((d) => ({
        field: d.field,
        message: d.message,
      }));

      throw new ApiClientError(
        errorPayload.message,
        response.status,
        errorPayload.code,
        extractedDetails,
        json?.meta?.requestId || requestId
      );
    }

    // Return the unpacked data payload
    return (json?.data as T) ?? (null as unknown as T);
  }

  /**
   * Ensures concurrent requests share a single in-flight refresh operation
   */
  public static async coordinateTokenRefresh(): Promise<string | null> {
    if (!this.refreshHandler) {
      return null;
    }

    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.refreshHandler()
        .catch(() => null)
        .finally(() => {
          this.inFlightRefresh = null;
        });
    }

    return this.inFlightRefresh;
  }

  public static get<T = unknown>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined | null>,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET', params });
  }

  public static post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public static put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public static patch<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public static delete<T = unknown>(
    endpoint: string,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Specialized upload helper for multipart/form-data.
   * Does NOT manually set Content-Type header so browser populates boundary string automatically.
   */
  public static upload<T = unknown>(
    endpoint: string,
    formData: FormData,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: formData,
    });
  }
}
