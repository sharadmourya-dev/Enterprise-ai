import {
  ICitation,
  ISSEMessageStartedPayload,
  ISSEMessageProgressPayload,
  ISSEMessageCompletedPayload,
  ISSEMessageErrorPayload,
} from '@enterprise-ai/shared-types';
import { ApiClient, ApiClientError } from './api-client';

export interface RawSseEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Parses a single SSE block (separated by double newlines) into event, data, and id.
 * Adheres strictly to the W3C Server-Sent Events standard:
 * - Lines starting with ':' are comments (e.g. ': heartbeat') and are skipped.
 * - Multiple 'data:' lines are concatenated with newline characters ('\n').
 * - Field values are stripped of any single leading space per SSE specification.
 */
export function parseSseBlock(rawBlock: string): RawSseEvent | null {
  const lines = rawBlock.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];
  let id: string | undefined;

  for (const line of lines) {
    if (line.startsWith(':') || line.trim() === '') {
      continue;
    }

    if (line.startsWith('event:')) {
      const val = line.slice(6);
      event = val.startsWith(' ') ? val.slice(1) : val;
    } else if (line.startsWith('data:')) {
      const val = line.slice(5);
      dataLines.push(val.startsWith(' ') ? val.slice(1) : val);
    } else if (line.startsWith('id:')) {
      const val = line.slice(3);
      id = val.startsWith(' ') ? val.slice(1) : val;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join('\n'),
    id,
  };
}

/**
 * Buffers incoming stream chunks and extracts all complete double-newline-delimited frames.
 * Handles both CRLF ('\r\n\r\n') and LF ('\n\n') boundaries across arbitrary network packet splits.
 */
export function processSseBuffer(
  buffer: string
): { events: RawSseEvent[]; remainingBuffer: string } {
  const events: RawSseEvent[] = [];
  let currentBuffer = buffer;

  while (true) {
    const crlfIndex = currentBuffer.indexOf('\r\n\r\n');
    const lfIndex = currentBuffer.indexOf('\n\n');

    let boundaryIndex = -1;
    let delimiterLength = 2;

    if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex <= lfIndex)) {
      boundaryIndex = crlfIndex;
      delimiterLength = 4;
    } else if (lfIndex !== -1) {
      boundaryIndex = lfIndex;
      delimiterLength = 2;
    }

    if (boundaryIndex === -1) {
      break;
    }

    const block = currentBuffer.slice(0, boundaryIndex);
    currentBuffer = currentBuffer.slice(boundaryIndex + delimiterLength);

    const parsed = parseSseBlock(block);
    if (parsed) {
      events.push(parsed);
    }
  }

  return { events, remainingBuffer: currentBuffer };
}

export interface StreamChatHandlers {
  onStarted?: (data: ISSEMessageStartedPayload) => void;
  onProgress?: (data: ISSEMessageProgressPayload) => void;
  onDelta?: (contentChunk: string) => void;
  onCitations?: (citations: ICitation[]) => void;
  onCompleted?: (data: ISSEMessageCompletedPayload) => void;
  onError?: (error: ISSEMessageErrorPayload) => void;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  handlers: StreamChatHandlers;
}

/**
 * Initiates an authenticated POST request to the message stream endpoint:
 * /api/v1/conversations/:conversationId/messages/stream
 *
 * Handles:
 * - Single-flight token refresh on 401 TOKEN_EXPIRED before stream initiation
 * - Chunk decoding with multiline and split-packet reconstruction
 * - Event dispatching for message.started, message.progress, message.delta,
 *   message.citations, message.completed, and message.error
 * - Graceful client-side cancellation via AbortSignal
 */
export async function streamChatMessage(
  conversationId: string,
  content: string,
  options: StreamChatOptions
): Promise<void> {
  const endpoint = ApiClient.buildUrl(
    `/api/v1/conversations/${conversationId}/messages/stream`
  ).toString();

  const makeRequest = async (token: string | null): Promise<Response> => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    });

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        idempotencyKey: options.idempotencyKey,
      }),
      signal: options.signal,
    });
  };

  let token = ApiClient.getAccessToken();
  let response: Response;

  try {
    response = await makeRequest(token);
  } catch (err: unknown) {
    if (options.signal?.aborted) {
      return;
    }
    const message = err instanceof Error ? err.message : 'Network request failed';
    const errorPayload = { code: 'NETWORK_ERROR', message };
    options.handlers.onError?.(errorPayload);
    throw new ApiClientError(message, 0, 'NETWORK_ERROR');
  }

  // Handle TOKEN_EXPIRED: Single-flight refresh token rotation and retry connection once
  if (response.status === 401) {
    let errorJson: any = null;
    try {
      errorJson = await response.clone().json();
    } catch {
      // not JSON
    }

    if (errorJson?.error?.code === 'TOKEN_EXPIRED') {
      const newToken = await ApiClient.coordinateTokenRefresh();
      if (newToken) {
        response = await makeRequest(newToken);
      } else {
        ApiClient.notifySessionClear();
        const err = { code: 'UNAUTHORIZED', message: 'Session expired. Please log in again.' };
        options.handlers.onError?.(err);
        throw new ApiClientError(err.message, 401, err.code);
      }
    }
  }

  if (!response.ok) {
    let errorData: any = null;
    try {
      errorData = await response.json();
    } catch {
      // ignore
    }

    const code = errorData?.error?.code || `HTTP_${response.status}`;
    const message = errorData?.error?.message || response.statusText || 'Streaming request failed';
    const errPayload = { code, message };
    options.handlers.onError?.(errPayload);
    throw new ApiClientError(message, response.status, code);
  }

  if (!response.body) {
    const errPayload = { code: 'EMPTY_BODY', message: 'Readable response stream not available' };
    options.handlers.onError?.(errPayload);
    throw new ApiClientError('Response body is empty', response.status, 'EMPTY_BODY');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel().catch(() => {});
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const { events, remainingBuffer } = processSseBuffer(buffer);
      buffer = remainingBuffer;

      for (const event of events) {
        let parsedData: any;
        try {
          parsedData = JSON.parse(event.data);
        } catch {
          // If JSON parse fails, skip malformed event
          continue;
        }

        switch (event.event) {
          case 'message.started':
            options.handlers.onStarted?.(parsedData);
            break;
          case 'message.progress':
            options.handlers.onProgress?.(parsedData);
            break;
          case 'message.delta':
            options.handlers.onDelta?.(parsedData.content || '');
            break;
          case 'message.citations':
            options.handlers.onCitations?.(parsedData.citations || []);
            break;
          case 'message.completed':
            options.handlers.onCompleted?.(parsedData);
            break;
          case 'message.error':
            options.handlers.onError?.(parsedData);
            break;
        }
      }
    }
  } catch (readErr: unknown) {
    if (options.signal?.aborted) {
      return;
    }
    const message = readErr instanceof Error ? readErr.message : 'Error reading stream';
    const errPayload = { code: 'STREAM_READ_ERROR', message };
    options.handlers.onError?.(errPayload);
    throw readErr;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
