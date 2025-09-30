import { describe, expect, it } from 'vitest';

import { FacebookMessengerAgent } from '../src/agent';
import type { HttpResponseLike, SendMessageCommand } from '../src/types';

const APP_SECRET = 'secret';
const PAGE_TOKEN = 'page-token';

describe('FacebookMessengerAgent', () => {
  it('sends messages via the Graph API', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];

    const agent = new FacebookMessengerAgent({
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
      httpClient: async (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
        return createOkResponse({
          recipient_id: 'user-123',
          message_id: 'mid.456',
        });
      },
      graphApiVersion: 'v18.0',
    });

    const result = await agent.sendMessage({
      recipientId: 'user-123',
      message: {
        kind: 'text',
        text: 'Hello!',
        quickReplies: [{ title: 'Reply' }],
      },
    });

    expect(result).toEqual({
      recipientId: 'user-123',
      messageId: 'mid.456',
      attachmentId: undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://graph.facebook.com/v18.0/me/messages?access_token=page-token',
    );
    expect(calls[0]?.body).toEqual({
      recipient: { id: 'user-123' },
      message: {
        text: 'Hello!',
        metadata: undefined,
        quick_replies: [{ content_type: 'text', title: 'Reply', payload: 'Reply' }],
      },
      messaging_type: 'RESPONSE',
    });
  });

  it('supports sender actions without message payloads', async () => {
    const agent = new FacebookMessengerAgent({
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
      httpClient: async () =>
        createOkResponse({
          recipient_id: 'user-123',
        }),
    });

    const command: SendMessageCommand = {
      recipientId: 'user-123',
      senderAction: 'typing_on',
    };

    const result = await agent.sendMessage(command);
    expect(result).toEqual({
      recipientId: 'user-123',
      messageId: undefined,
      attachmentId: undefined,
    });
  });

  it('enforces message or sender action', async () => {
    const agent = new FacebookMessengerAgent({
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
    });

    await expect(agent.sendMessage({ recipientId: 'user-1' })).rejects.toThrow(
      /message or senderAction/i,
    );
  });

  it('throws for MESSAGE_TAG without tag', async () => {
    const agent = new FacebookMessengerAgent({
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
    });

    await expect(
      agent.sendMessage({
        recipientId: 'user-123',
        messagingType: 'MESSAGE_TAG',
        message: { kind: 'text', text: 'Hello' },
      }),
    ).rejects.toThrow(/tag/i);
  });

  it('surfaces Graph API errors with metadata', async () => {
    const agent = new FacebookMessengerAgent({
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
      httpClient: async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Invalid OAuth access token.',
            type: 'OAuthException',
            code: 190,
            error_subcode: 123,
            fbtrace_id: 'abc123',
          },
        }),
        text: async () => 'Invalid OAuth access token.',
      }),
    });

    await expect(
      agent.sendMessage({
        recipientId: 'user-123',
        message: { kind: 'text', text: 'Hello' },
      }),
    ).rejects.toMatchObject({
      name: 'FacebookMessengerApiError',
      status: 400,
      code: 190,
      type: 'OAuthException',
      errorSubcode: 123,
      fbtraceId: 'abc123',
    });
  });

  it('validates webhook signatures', () => {
    const agent = new FacebookMessengerAgent({
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
    });

    const payload = JSON.stringify({ foo: 'bar' });
    const header = agent.signPayload(payload);

    expect(agent.verifySignature(header, payload)).toBe(true);
    expect(agent.verifySignature(header, payload + '!')).toBe(false);
  });
});

function createOkResponse(body: unknown): HttpResponseLike {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
