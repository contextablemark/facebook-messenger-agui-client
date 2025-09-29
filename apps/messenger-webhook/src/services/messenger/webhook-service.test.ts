import { FacebookMessengerAgent, type MessengerWebhookPayload } from '@agui/messaging-sdk';
import { Registry } from 'prom-client';
import type { Counter, Histogram } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';

import { SignatureVerificationError, DispatchError } from '../../errors';
import type { AppLogger } from '../../telemetry/logger';
import type { GatewayMetrics } from '../../telemetry/metrics';
import type { AguiDispatcher } from '../agui';
import { DEFAULT_SESSION_TTL_SECONDS, type SessionStore } from '../session';

import { MessengerWebhookService, type MessengerWebhookServiceOptions } from './webhook-service';

const basePayload: MessengerWebhookPayload = {
  object: 'page',
  entry: [
    {
      id: 'page-1',
      time: Date.now(),
      messaging: [
        {
          sender: { id: 'user-123' },
          recipient: { id: 'page-1' },
          timestamp: Date.now(),
          message: {
            mid: 'mid-1',
            text: 'Hello',
          },
        },
      ],
    },
  ],
};

function createService(
  overrides: Partial<{
    dispatcher: AguiDispatcher;
    sessions: SessionStore;
    metrics: GatewayMetrics;
    options: MessengerWebhookServiceOptions;
  }> = {},
) {
  const agent = new FacebookMessengerAgent({
    appSecret: 'secret',
    pageAccessToken: 'token',
  });

  const sendMessageMock = vi.fn().mockResolvedValue({ recipientId: 'user-123' });
  agent.sendMessage = sendMessageMock;

  const dispatcher: AguiDispatcher =
    overrides.dispatcher ??
    ({ dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as AguiDispatcher);

  const sessions: SessionStore =
    overrides.sessions ??
    ({
      read: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionStore);

  const metrics: GatewayMetrics = overrides.metrics ?? {
    registry: new Registry(),
    requestCounter: { inc: vi.fn() } as unknown as Counter<string>,
    requestDuration: { startTimer: vi.fn(() => () => null) } as unknown as Histogram<string>,
    dispatchFailures: { inc: vi.fn() } as unknown as Counter<string>,
    outboundMessages: { inc: vi.fn() } as unknown as Counter<string>,
    commandCounter: { inc: vi.fn() } as unknown as Counter<string>,
  };

  const logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  } as unknown as AppLogger;

  const service = new MessengerWebhookService(
    agent,
    dispatcher,
    sessions,
    metrics,
    logger,
    overrides.options ?? { maxTextLength: 2000, typingKeepAliveMs: 5000 },
  );

  return { agent, dispatcher, sessions, metrics, service, sendMessageMock };
}

describe('MessengerWebhookService', () => {
  it('throws when the signature is invalid', async () => {
    const { service } = createService();
    const payload = JSON.stringify(basePayload);

    await expect(
      service.handleWebhook({
        payload: basePayload,
        rawBody: payload,
        signatureHeader: 'invalid',
      }),
    ).rejects.toBeInstanceOf(SignatureVerificationError);
  });

  it('handles slash commands without dispatching to AG-UI', async () => {
    const dispatcher = { dispatch: vi.fn() } as unknown as AguiDispatcher;
    const sessions = {
      read: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionStore;

    const { agent, service, sendMessageMock, metrics } = createService({ dispatcher, sessions });

    const payload: MessengerWebhookPayload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'user-123' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
              message: {
                mid: 'mid-1',
                text: '/reset',
              },
            },
          ],
        },
      ],
    };

    const raw = JSON.stringify(payload);
    const signature = agent.signPayload(raw);

    const result = await service.handleWebhook({
      payload,
      rawBody: raw,
      signatureHeader: signature,
    });

    expect(result.receivedEvents).toBe(1);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(sessions.delete).toHaveBeenCalledWith('user-123');
    expect(sendMessageMock).toHaveBeenCalled();
    expect(metrics.commandCounter.inc).toHaveBeenCalledWith({
      command: 'reset',
      status: 'success',
    });
  });

  it('dispatches events to AG-UI and relays assistant messages', async () => {
    const dispatcher = {
      dispatch: vi.fn().mockImplementation(async (_events, _context, handlers) => {
        handlers?.onRunStarted?.({ runId: 'run-1' });
        handlers?.onAssistantMessage?.({ messageId: 'msg-1', content: 'Hello from AG-UI' });
        await handlers?.onRunFinished?.({ runId: 'run-1' });
      }),
    } as unknown as AguiDispatcher;

    const sessions = {
      read: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    } as unknown as SessionStore;

    const { agent, service, sendMessageMock } = createService({ dispatcher, sessions });

    const payload = {
      ...basePayload,
      entry: [
        {
          ...basePayload.entry[0],
          messaging: [
            basePayload.entry[0].messaging[0],
            {
              sender: { id: 'user-123' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
              message: {
                mid: 'mid-2',
                text: 'More input',
              },
            },
          ],
        },
      ],
    } satisfies MessengerWebhookPayload;

    const raw = JSON.stringify(payload);
    const signature = agent.signPayload(raw);

    const result = await service.handleWebhook({
      payload,
      rawBody: raw,
      signatureHeader: signature,
    });

    expect(result.receivedEvents).toBe(2);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.any(Array),
      { sessionId: 'user-123', userId: 'user-123', pageId: 'page-1' },
      expect.objectContaining({
        onAssistantMessage: expect.any(Function),
      }),
    );

    expect(sessions.write).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({ userId: 'user-123', pageId: 'page-1' }),
      DEFAULT_SESSION_TTL_SECONDS,
    );

    expect(sendMessageMock).toHaveBeenCalledTimes(4);
    const [[markSeen], [typingOn], [assistantMessage], [typingOff]] = sendMessageMock.mock.calls;
    expect(markSeen).toEqual({ recipientId: 'user-123', senderAction: 'mark_seen' });
    expect(typingOn).toEqual({ recipientId: 'user-123', senderAction: 'typing_on' });
    expect(assistantMessage).toEqual({
      recipientId: 'user-123',
      message: { kind: 'text', text: 'Hello from AG-UI' },
    });
    expect(typingOff).toEqual({ recipientId: 'user-123', senderAction: 'typing_off' });
  });

  it('wraps dispatcher failures in a DispatchError and notifies the user', async () => {
    const dispatcher = {
      dispatch: vi.fn().mockImplementation(async () => {
        throw new Error('boom');
      }),
    } as unknown as AguiDispatcher;

    const metrics: GatewayMetrics = {
      registry: new Registry(),
      requestCounter: { inc: vi.fn() } as unknown as Counter<string>,
      requestDuration: { startTimer: vi.fn(() => () => null) } as unknown as Histogram<string>,
      dispatchFailures: { inc: vi.fn() } as unknown as Counter<string>,
      outboundMessages: { inc: vi.fn() } as unknown as Counter<string>,
      commandCounter: { inc: vi.fn() } as unknown as Counter<string>,
    };

    const { agent, service, sendMessageMock } = createService({ dispatcher, metrics });

    const raw = JSON.stringify(basePayload);
    const signature = agent.signPayload(raw);

    await expect(
      service.handleWebhook({
        payload: basePayload,
        rawBody: raw,
        signatureHeader: signature,
      }),
    ).rejects.toBeInstanceOf(DispatchError);

    expect(metrics.dispatchFailures.inc).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'user-123',
        message: {
          kind: 'text',
          text: expect.stringContaining('Sorry, something went wrong'),
        },
      }),
    );
  });
});
