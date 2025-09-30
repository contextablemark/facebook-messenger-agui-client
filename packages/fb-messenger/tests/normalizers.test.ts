import { describe, expect, it } from 'vitest';

import {
  buildAttachmentMessagePayload,
  buildMessagePayload,
  buildTextMessagePayload,
  normalizeMessengerMessage,
  normalizeQuickReplyOptions,
  normalizeWebhookPayload,
} from '../src/normalizers';
import type {
  MessengerAttachment,
  MessengerWebhookPayload,
  OutboundMessageInput,
} from '../src/types';

describe('normalizeWebhookPayload', () => {
  it('normalizes text messages', () => {
    const payload: MessengerWebhookPayload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 100,
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              timestamp: 200,
              message: {
                mid: 'mid-1',
                text: 'hello world',
              },
            },
          ],
        },
      ],
    };

    const events = normalizeWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      message: {
        kind: 'text',
        text: 'hello world',
        envelope: {
          senderId: 'user-1',
          recipientId: 'page-1',
          mid: 'mid-1',
          isEcho: false,
        },
      },
    });
  });

  it('normalizes quick reply selections', () => {
    const payload: MessengerWebhookPayload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 100,
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              timestamp: 200,
              message: {
                mid: 'mid-2',
                text: 'Option A',
                quick_reply: {
                  payload: 'PAYLOAD_A',
                },
              },
            },
          ],
        },
      ],
    };

    const events = normalizeWebhookPayload(payload);
    expect(events[0]?.message).toMatchObject({
      kind: 'quick_reply',
      text: 'Option A',
      quickReply: { payload: 'PAYLOAD_A' },
    });
  });

  it('normalizes attachments with shallow copies', () => {
    const attachment: MessengerAttachment = {
      type: 'image',
      payload: { url: 'https://example.com/cat.png' },
    };

    const events = normalizeWebhookPayload({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 100,
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              timestamp: 200,
              message: {
                mid: 'mid-3',
                text: 'photo',
                attachments: [attachment],
              },
            },
          ],
        },
      ],
    });

    const normalizedAttachment = events[0]?.message;
    if (!normalizedAttachment || normalizedAttachment.kind !== 'attachments') {
      throw new Error('Expected attachment message');
    }

    expect(normalizedAttachment.attachments[0]).not.toBe(attachment);
    expect(normalizedAttachment.attachments[0]).toEqual(attachment);
  });
});

describe('normalizeMessengerMessage', () => {
  it('returns undefined when sender IDs are missing', () => {
    expect(
      normalizeMessengerMessage('page-1', {
        sender: { id: '' },
        recipient: { id: '' },
        timestamp: 0,
        message: { text: 'hello' },
      }),
    ).toBeUndefined();
  });
});

describe('quick reply normalization', () => {
  it('normalizes text quick replies with default payloads', () => {
    const quickReplies = normalizeQuickReplyOptions([
      { title: 'A' },
      { title: 'B', payload: 'payload-b' },
    ]);

    expect(quickReplies).toEqual([
      { content_type: 'text', title: 'A', payload: 'A' },
      { content_type: 'text', title: 'B', payload: 'payload-b' },
    ]);
  });

  it('throws when text quick replies omit titles', () => {
    expect(() => normalizeQuickReplyOptions([{ payload: 'noop' }])).toThrow(/title/i);
  });

  it('preserves non-text quick replies', () => {
    const quickReplies = normalizeQuickReplyOptions([{ contentType: 'location' }]);

    expect(quickReplies).toEqual([
      { content_type: 'location', payload: undefined, title: undefined },
    ]);
  });
});

describe('outbound message builders', () => {
  it('builds text payloads with quick replies', () => {
    const payload = buildTextMessagePayload({
      kind: 'text',
      text: 'Hello',
      quickReplies: [{ title: 'QR1' }],
      metadata: 'meta',
    });

    expect(payload).toEqual({
      text: 'Hello',
      metadata: 'meta',
      quick_replies: [{ content_type: 'text', title: 'QR1', payload: 'QR1' }],
    });
  });

  it('builds attachment payloads', () => {
    const payload = buildAttachmentMessagePayload({
      kind: 'attachment',
      attachment: { type: 'image', payload: { url: 'https://example.com' } },
      text: 'See image',
    });

    expect(payload).toEqual({
      text: 'See image',
      attachment: {
        type: 'image',
        payload: { url: 'https://example.com' },
      },
      metadata: undefined,
      quick_replies: undefined,
    });
  });

  it('builds payloads through buildMessagePayload helper', () => {
    const outbound: OutboundMessageInput = {
      kind: 'text',
      text: 'hi',
    };

    expect(buildMessagePayload(outbound)).toEqual({
      text: 'hi',
      metadata: undefined,
      quick_replies: undefined,
    });
  });
});
