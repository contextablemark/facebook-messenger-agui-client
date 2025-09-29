import type { NormalizedMessengerEvent, MessengerMessagingEvent } from '@agui/messaging-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../telemetry/logger';

import { createAguiDispatcher } from './dispatcher';

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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi
        .fn()
        .mockResolvedValue(
          'data: {"type":"RUN_STARTED","run_id":"run-1","thread_id":"user-123"}\n\n' +
            'data: {"type":"TEXT_MESSAGE","role":"assistant","message_id":"msg-1","content":"Hi there"}\n\n' +
            'data: {"type":"RUN_FINISHED","run_id":"run-1","thread_id":"user-123"}\n\n',
        ),
    });

    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    } as unknown as AppLogger;

    const dispatcher = createAguiDispatcher(logger, {
      baseUrl: 'https://agui.example.com/agent/test-agent',
      apiKey: 'secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
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

    expect(handlers.onRunStarted).toHaveBeenCalledWith({ runId: 'run-1', threadId: 'user-123' });
    expect(handlers.onAssistantMessage).toHaveBeenCalledWith({
      messageId: 'msg-1',
      content: 'Hi there',
    });
    expect(handlers.onRunFinished).toHaveBeenCalledWith({ runId: 'run-1', threadId: 'user-123' });
  });
});
