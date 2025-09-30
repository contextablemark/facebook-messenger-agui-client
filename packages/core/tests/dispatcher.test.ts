/**
 * Integration-style exercises for the AG-UI gateway dispatcher contract.
 *
 * These tests verify the fallback logging behaviour, the HttpAgent wiring,
 * and the RunAgentInput builder that translates Messenger events.
 */
import { ReadableStream } from 'node:stream/web';

import type { MessengerMessagingEvent, NormalizedMessengerEvent } from '@agui-gw/fb-messenger';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildRunInput,
  createAguiDispatcher,
  type AguiDispatchHandlers,
  type DispatchContext,
  type LoggerLike,
} from '../src/agui/dispatcher';

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

function createTextMessageEvent(text: string): NormalizedMessengerEvent {
  return {
    type: 'message',
    entryId: 'entry-1',
    timestamp: 1730000000000,
    message: {
      kind: 'text',
      envelope: {
        objectId: 'entry-1',
        senderId: 'user-123',
        recipientId: 'page-456',
        timestamp: 1730000000000,
        mid: 'mid-1',
        isEcho: false,
        metadata: undefined,
      },
      text,
    },
    raw: {} as MessengerMessagingEvent,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createAguiDispatcher', () => {
  it('falls back to logging dispatcher when no base URL is configured', async () => {
    const warn = vi.fn();
    const logger: LoggerLike = { warn };
    const dispatcher = createAguiDispatcher(logger);

    const handlers: AguiDispatchHandlers = {
      onRunError: vi.fn(),
    };

    await dispatcher.dispatch([], { sessionId: 'session-1', userId: 'user-1' }, handlers);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        userId: 'user-1',
        eventCount: 0,
      }),
      'AG-UI dispatcher not configured - dropping events',
    );
    expect(handlers.onRunError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'AG-UI dispatcher not configured',
        threadId: 'session-1',
      }),
    );
  });

  it('posts run payloads to the configured AG-UI endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          'data: {"type":"RUN_STARTED","runId":"run-1","threadId":"session-1"}\n\n',
          'data: {"type":"TEXT_MESSAGE_START","messageId":"assistant-msg","role":"assistant"}\n\n',
          'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"assistant-msg","delta":"Hi there"}\n\n',
          'data: {"type":"TEXT_MESSAGE_END","messageId":"assistant-msg"}\n\n',
          'data: {"type":"RUN_FINISHED","runId":"run-1","threadId":"session-1"}\n\n',
        ]),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const logger: LoggerLike = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const dispatcher = createAguiDispatcher(logger, {
      baseUrl: 'https://agui.example.com/agent/test-agent',
      apiKey: 'secret',
    });

    const events = [createTextMessageEvent('Hello from Messenger')];
    const handlers: AguiDispatchHandlers = {
      onRunStarted: vi.fn(),
      onRunFinished: vi.fn(),
      onRunError: vi.fn(),
      onAssistantMessage: vi.fn(),
    };

    await dispatcher.dispatch(
      events,
      { sessionId: 'session-1', userId: 'user-123', pageId: 'page-456' },
      handlers,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://agui.example.com/agent/test-agent');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });

    const payload = JSON.parse(init?.body as string);
    expect(payload.threadId).toBe('session-1');
    expect(payload.messages).toEqual([
      {
        id: 'mid-1',
        role: 'user',
        content: 'Hello from Messenger',
      },
    ]);

    expect(handlers.onRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', threadId: 'session-1' }),
    );
    expect(handlers.onAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'assistant-msg', content: 'Hi there' }),
    );
    expect(handlers.onRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', threadId: 'session-1' }),
    );
    expect(handlers.onRunError).not.toHaveBeenCalled();
  });

  it('surfaces run errors when the AG-UI stream cannot be parsed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          'data: {"type":"RUN_STARTED","runId":"run-1","threadId":"session-1"}\n\n',
          'data: {"type": "TEXT_MESSAGE_CONTENT" invalid}\n\n',
        ]),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const logger: LoggerLike = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const dispatcher = createAguiDispatcher(logger, {
      baseUrl: 'https://agui.example.com/agent/test-agent',
    });

    const events = [createTextMessageEvent('Hello from Messenger')];
    const handlers: AguiDispatchHandlers = {
      onRunError: vi.fn(),
    };

    await expect(
      dispatcher.dispatch(events, { sessionId: 'session-1', userId: 'user-123' }, handlers),
    ).rejects.toThrow();

    expect(handlers.onRunError).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'Failed to dispatch events to AG-UI',
    );
  });
});

describe('buildRunInput', () => {
  it('translates Messenger events into RunAgentInput payloads', () => {
    const events: NormalizedMessengerEvent[] = [
      createTextMessageEvent('Hello from Messenger'),
      {
        type: 'message',
        entryId: 'entry-1',
        timestamp: 1730000000100,
        message: {
          kind: 'quick_reply',
          envelope: {
            objectId: 'entry-1',
            senderId: 'user-123',
            recipientId: 'page-456',
            timestamp: 1730000000100,
            mid: 'mid-2',
            isEcho: false,
            metadata: undefined,
          },
          text: 'Clicked quick reply',
          quickReply: {
            payload: 'reply::payload',
            title: 'Quick reply title',
          },
        },
        raw: {} as MessengerMessagingEvent,
      },
      {
        type: 'postback',
        entryId: 'entry-1',
        timestamp: 1730000000200,
        postback: {
          title: 'Postback title',
          payload: 'postback::payload',
        },
        raw: {} as MessengerMessagingEvent,
      },
    ];

    const context: DispatchContext = {
      sessionId: 'session-1',
      userId: 'user-123',
      pageId: 'page-456',
    };

    const result = buildRunInput(events, context);

    expect(result).toBeDefined();
    expect(result?.threadId).toBe('session-1');
    expect(result?.runId.startsWith('messenger-session-1-')).toBe(true);
    expect(result?.messages).toHaveLength(3);
    expect(result?.messages?.[0]).toEqual({
      id: 'mid-1',
      role: 'user',
      content: 'Hello from Messenger',
    });
    expect(result?.messages?.[1]).toMatchObject({
      id: 'mid-2',
      role: 'user',
      content: expect.stringContaining('Quick reply payload: reply::payload'),
    });
    expect(result?.messages?.[2]).toMatchObject({
      role: 'user',
      content: 'Postback title: Postback title\nPostback payload: postback::payload',
    });
    expect(result?.forwardedProps).toEqual({
      source: 'facebook-messenger',
      pageId: 'page-456',
      userId: 'user-123',
    });
    expect(result?.state).toEqual({
      messenger: {
        lastEventTimestamp: 1730000000200,
      },
    });
  });

  it('returns undefined when no user messages are present', () => {
    const events: NormalizedMessengerEvent[] = [
      {
        type: 'message',
        entryId: 'entry-1',
        timestamp: 1730000000000,
        message: {
          kind: 'text',
          envelope: {
            objectId: 'entry-1',
            senderId: 'user-123',
            recipientId: 'page-456',
            timestamp: 1730000000000,
            mid: 'mid-echo',
            isEcho: true,
            metadata: undefined,
          },
          text: 'Should be ignored',
        },
        raw: {} as MessengerMessagingEvent,
      },
    ];

    const result = buildRunInput(events, { sessionId: 'session-1', userId: 'user-123' });
    expect(result).toBeUndefined();
  });
});
