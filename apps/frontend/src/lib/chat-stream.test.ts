import { TextEncoder, TextDecoder } from 'util';
import { ReadableStream } from 'stream/web';
import {
  parseSseBlock,
  processSseBuffer,
  streamChatMessage,
} from './chat-stream';
import { ApiClient } from './api-client';

if (typeof global.TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}
if (typeof global.ReadableStream === 'undefined') {
  (global as any).ReadableStream = ReadableStream;
}

describe('SSE Stream Parser & Chat Client', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000';
    jest.clearAllMocks();
  });

  describe('parseSseBlock', () => {
    it('parses standard event and data lines', () => {
      const block = 'event: message.delta\ndata: {"content": "Hello World"}';
      const parsed = parseSseBlock(block);

      expect(parsed).toEqual({
        event: 'message.delta',
        data: '{"content": "Hello World"}',
        id: undefined,
      });
    });

    it('ignores comment lines starting with :', () => {
      const block = ': heartbeat\n: another comment';
      const parsed = parseSseBlock(block);
      expect(parsed).toBeNull();
    });

    it('concatenates multiple data lines with newlines per SSE standard', () => {
      const block = 'event: multiline\ndata: Line 1\ndata: Line 2\ndata: Line 3';
      const parsed = parseSseBlock(block);

      expect(parsed).toEqual({
        event: 'multiline',
        data: 'Line 1\nLine 2\nLine 3',
        id: undefined,
      });
    });

    it('handles CRLF line endings', () => {
      const block = 'event: message.progress\r\ndata: {"stage": "generating", "progress": 50}';
      const parsed = parseSseBlock(block);

      expect(parsed).toEqual({
        event: 'message.progress',
        data: '{"stage": "generating", "progress": 50}',
        id: undefined,
      });
    });

    it('extracts optional id field', () => {
      const block = 'id: 42\nevent: message.started\ndata: {"messageId": "msg-123"}';
      const parsed = parseSseBlock(block);

      expect(parsed).toEqual({
        id: '42',
        event: 'message.started',
        data: '{"messageId": "msg-123"}',
      });
    });
  });

  describe('processSseBuffer', () => {
    it('parses multiple complete events in a single buffer', () => {
      const buffer =
        ': heartbeat\n\n' +
        'event: message.started\ndata: {"conversationId": "c1"}\n\n' +
        'event: message.delta\ndata: {"content": "chunk1"}\n\n';

      const { events, remainingBuffer } = processSseBuffer(buffer);

      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('message.started');
      expect(events[1].event).toBe('message.delta');
      expect(remainingBuffer).toBe('');
    });

    it('reconstructs events split across multiple network packets', () => {
      // Packet 1: incomplete data
      const packet1 = 'event: message.delta\ndata: {"con';
      const res1 = processSseBuffer(packet1);
      expect(res1.events).toHaveLength(0);
      expect(res1.remainingBuffer).toBe('event: message.delta\ndata: {"con');

      // Packet 2: completion of packet 1 and start of packet 3
      const packet2 = res1.remainingBuffer + 'tent": "reconstructed"}\n\nevent: message.com';
      const res2 = processSseBuffer(packet2);
      expect(res2.events).toHaveLength(1);
      expect(res2.events[0].event).toBe('message.delta');
      expect(JSON.parse(res2.events[0].data)).toEqual({ content: 'reconstructed' });
      expect(res2.remainingBuffer).toBe('event: message.com');
    });

    it('handles mixed CRLF and LF boundaries', () => {
      const buffer =
        'event: e1\r\ndata: {"val":1}\r\n\r\n' +
        'event: e2\ndata: {"val":2}\n\n';

      const { events } = processSseBuffer(buffer);
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('e1');
      expect(events[1].event).toBe('e2');
    });
  });

  describe('streamChatMessage streaming client', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      ApiClient.configureAuth(
        () => 'valid-access-token',
        jest.fn().mockResolvedValue('refreshed-token'),
        jest.fn()
      );
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
    }

    it('streams full lifecycle events: started, progress, delta, citations, completed', async () => {
      const streamChunks = [
        'event: message.started\ndata: {"conversationId":"c-1","messageId":"m-1"}\n\n',
        ': heartbeat\n\n',
        'event: message.progress\ndata: {"stage":"retrieving","progress":25}\n\n',
        'event: message.delta\ndata: {"content":"Here is "}\n\n',
        'event: message.delta\ndata: {"content":"the answer"}\n\n',
        'event: message.citations\ndata: {"citations":[{"evidenceId":"S1","documentId":"doc-1","source":"Policy","chunkId":"chk-1","revision":1}]}\n\n',
        'event: message.completed\ndata: {"messageId":"m-1","tokensUsed":{"totalTokens":150},"latencyMs":450}\n\n',
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: createMockStream(streamChunks),
      });

      const onStarted = jest.fn();
      const onProgress = jest.fn();
      const onDelta = jest.fn();
      const onCitations = jest.fn();
      const onCompleted = jest.fn();
      const onError = jest.fn();

      await streamChatMessage('c-1', 'What is the policy?', {
        handlers: {
          onStarted,
          onProgress,
          onDelta,
          onCitations,
          onCompleted,
          onError,
        },
      });

      expect(onStarted).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: 'm-1' });
      expect(onProgress).toHaveBeenCalledWith({ stage: 'retrieving', progress: 25 });
      expect(onDelta).toHaveBeenCalledWith('Here is ');
      expect(onDelta).toHaveBeenCalledWith('the answer');
      expect(onCitations).toHaveBeenCalledWith([
        expect.objectContaining({ evidenceId: 'S1', source: 'Policy' }),
      ]);
      expect(onCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'm-1', latencyMs: 450 })
      );
      expect(onError).not.toHaveBeenCalled();
    });

    it('handles message.error terminal event correctly', async () => {
      const streamChunks = [
        'event: message.started\ndata: {"conversationId":"c-1","messageId":"m-1"}\n\n',
        'event: message.error\ndata: {"code":"LLM_GENERATION_FAILED","message":"Model capacity exceeded"}\n\n',
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: createMockStream(streamChunks),
      });

      const onError = jest.fn();
      await streamChatMessage('c-1', 'Trigger error', {
        handlers: { onError },
      });

      expect(onError).toHaveBeenCalledWith({
        code: 'LLM_GENERATION_FAILED',
        message: 'Model capacity exceeded',
      });
    });

    it('refreshes token on 401 TOKEN_EXPIRED and retries request once', async () => {
      const mockRefresh = jest.fn().mockResolvedValue('new-token-456');
      ApiClient.configureAuth(
        () => 'expired-token',
        mockRefresh,
        jest.fn()
      );

      const streamChunks = [
        'event: message.completed\ndata: {"messageId":"m-retry"}\n\n',
      ];

      // First call returns 401 TOKEN_EXPIRED, second call returns stream
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          clone: () => ({
            json: async () => ({ error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: createMockStream(streamChunks),
        });

      const onCompleted = jest.fn();
      await streamChatMessage('c-1', 'Query with expired token', {
        handlers: { onCompleted },
      });

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(onCompleted).toHaveBeenCalledWith({ messageId: 'm-retry' });
    });

    it('respects AbortSignal cancellation and terminates stream without throwing', async () => {
      const controller = new AbortController();
      controller.abort();

      const onDelta = jest.fn();
      await streamChatMessage('c-1', 'Cancelled message', {
        signal: controller.signal,
        handlers: { onDelta },
      });

      expect(onDelta).not.toHaveBeenCalled();
    });
  });
});
