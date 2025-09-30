import { ReadableStream } from 'node:stream/web';

import type { MessengerMessagingEvent, NormalizedMessengerEvent } from '@agui-gw/fb-messenger';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../telemetry/logger';

import { createAguiDispatcher } from './dispatcher';

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

function createSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createAguiDispatcher', () => {
  it('falls back to logging dispatcher when no base URL is configured', async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;

    const dispatcher = createAguiDispatcher(logger);
    const events: NormalizedMessengerEvent[] = [];

    const handlers = {
      onRunError: vi.fn(),
    };

    await dispatcher.dispatch(events, { sessionId: 'session-1', userId: 'user-1' }, handlers);

    expect(logger.warn).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        userId: 'user-1',
        eventCount: 0,
      },
      'AG-UI dispatcher not configured - dropping events',
    );
    expect(handlers.onRunError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'AG-UI dispatcher not configured',
        threadId: 'session-1',
      }),
    );
  });

  it('posts RunAgentInput payloads to the configured AG-UI endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          'data: {"type":"RUN_STARTED","runId":"run-1","threadId":"user-123"}\n\n',
          'data: {"type":"TEXT_MESSAGE_START","messageId":"msg-1","role":"assistant"}\n\n',
          'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"msg-1","delta":"Hi there"}\n\n',
          'data: {"type":"TEXT_MESSAGE_END","messageId":"msg-1"}\n\n',
          'data: {"type":"RUN_FINISHED","runId":"run-1","threadId":"user-123"}\n\n',
        ]),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;

    const dispatcher = createAguiDispatcher(logger, {
      baseUrl: 'https://agui.example.com/agent/test-agent',
      apiKey: 'secret',
    });

    const events: NormalizedMessengerEvent[] = [
      {
        type: 'message',
        entryId: 'entry-1',
        timestamp: 1730000000000,
        message: {
          kind: 'text',
          text: 'Hello from Messenger',
          envelope: {
            objectId: 'entry-1',
            senderId: 'user-123',
            recipientId: 'page-456',
            timestamp: 1730000000000,
            mid: 'mid-1',
            isEcho: false,
            metadata: undefined,
          },
        },
        raw: {} as unknown as MessengerMessagingEvent,
      },
    ];

    const handlers = {
      onAssistantMessage: vi.fn(),
      onRunStarted: vi.fn(),
      onRunFinished: vi.fn(),
    };

    await dispatcher.dispatch(
      events,
      { sessionId: 'user-123', userId: 'user-123', pageId: 'page-456' },
      handlers,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://agui.example.com/agent/test-agent');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer secret',
    });

    const payload = JSON.parse(init?.body as string);
    expect(payload.threadId).toBe('user-123');
    expect(typeof payload.runId).toBe('string');
    expect(payload.messages).toEqual([
      {
        id: 'mid-1',
        role: 'user',
        content: 'Hello from Messenger',
      },
    ]);
    expect(payload.state).toEqual({
      messenger: {
        lastEventTimestamp: 1730000000000,
      },
    });
    expect(payload.forwardedProps).toMatchObject({
      userId: 'user-123',
      pageId: 'page-456',
      source: 'facebook-messenger',
    });

    expect(handlers.onRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', threadId: 'user-123' }),
    );
    expect(handlers.onAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', content: 'Hi there' }),
    );
    expect(handlers.onRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', threadId: 'user-123' }),
    );
  });

  it('surfaces handler errors when the AG-UI stream cannot be parsed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          'data: {"type":"RUN_STARTED","runId":"run-1","threadId":"user-123"}\n\n',
          'data: {"type": "TEXT_MESSAGE_CONTENT" invalid}\n\n',
        ]),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;

    const dispatcher = createAguiDispatcher(logger, {
      baseUrl: 'https://agui.example.com/agent/test-agent',
    });

    const events: NormalizedMessengerEvent[] = [
      {
        type: 'message',
        entryId: 'entry-1',
        timestamp: 1730000000000,
        message: {
          kind: 'text',
          text: 'Hello from Messenger',
          envelope: {
            objectId: 'entry-1',
            senderId: 'user-123',
            recipientId: 'page-456',
            timestamp: 1730000000000,
            mid: 'mid-1',
            isEcho: false,
            metadata: undefined,
          },
        },
        raw: {} as unknown as MessengerMessagingEvent,
      },
    ];

    const handlers = {
      onRunError: vi.fn(),
    };

    await expect(
      dispatcher.dispatch(events, { sessionId: 'user-123', userId: 'user-123' }, handlers),
    ).rejects.toThrow();

    expect(handlers.onRunError).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'user-123' }),
      'Failed to dispatch events to AG-UI',
    );
  });
});
