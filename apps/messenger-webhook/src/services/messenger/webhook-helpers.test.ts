import type { NormalizedMessengerEvent } from '@agui/messaging-sdk';
import { describe, expect, it } from 'vitest';

import { chunkText, resolveSessionId } from './webhook-service';

describe('Messenger webhook helpers', () => {
  it('chunks messages without exceeding the configured limit', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    const chunks = chunkText(text, 20);

    expect(chunks).toEqual(['Lorem ipsum dolor', 'sit amet,', 'consectetur', 'adipiscing elit.']);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
  });

  it('falls back to hard splits when no whitespace exists within the limit', () => {
    const text = 'abcdefghijABCDEFGHIJ';
    const chunks = chunkText(text, 5);

    expect(chunks).toEqual(['abcde', 'fghij', 'ABCDE', 'FGHIJ']);
  });

  it('derives the session id from sender, recipient, or raw payload', () => {
    const baseRaw = {
      sender: { id: 'raw-sender' },
      recipient: { id: 'page-1' },
      timestamp: Date.now(),
    };

    const baseEvent = {
      type: 'message',
      entryId: 'entry-1',
      timestamp: Date.now(),
      message: {
        kind: 'text',
        text: 'Hello',
        envelope: {
          objectId: 'entry-1',
          senderId: 'sender-1',
          recipientId: 'recipient-1',
          timestamp: Date.now(),
          mid: 'mid-1',
          isEcho: false,
        },
      },
      raw: baseRaw,
    } as unknown as NormalizedMessengerEvent;

    expect(resolveSessionId(baseEvent)).toBe('sender-1');

    const recipientOnly = {
      ...baseEvent,
      message: {
        ...baseEvent.message!,
        envelope: {
          ...baseEvent.message!.envelope,
          senderId: undefined as unknown as string,
        },
      },
    } as unknown as NormalizedMessengerEvent;
    expect(resolveSessionId(recipientOnly)).toBe('recipient-1');

    const rawFallback = {
      ...baseEvent,
      message: undefined,
    } as unknown as NormalizedMessengerEvent;
    expect(resolveSessionId(rawFallback)).toBe('raw-sender');

    const unknownEvent = {
      ...baseEvent,
      message: undefined,
      raw: {},
    } as unknown as NormalizedMessengerEvent;
    expect(resolveSessionId(unknownEvent)).toMatch(/^unknown-/);
  });
});
