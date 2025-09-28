import {
  AttachmentMessageInput,
  MessengerAttachment,
  MessengerGraphMessagePayload,
  MessengerGraphQuickReply,
  MessengerMessagingEvent,
  MessengerMessagingParticipant,
  MessengerQuickReplyOption,
  MessengerQuickReplySelection,
  MessengerWebhookPayload,
  NormalizedAttachmentMessage,
  NormalizedMessageEnvelope,
  NormalizedMessengerEvent,
  NormalizedMessengerMessage,
  NormalizedQuickReplyMessage,
  NormalizedTextMessage,
  OutboundMessageInput,
  TextMessageInput,
} from './types';

export function normalizeWebhookPayload(
  payload: MessengerWebhookPayload,
): NormalizedMessengerEvent[] {
  if (!payload || payload.object !== 'page' || !Array.isArray(payload.entry)) {
    return [];
  }

  const results: NormalizedMessengerEvent[] = [];

  for (const entry of payload.entry) {
    if (!entry || !Array.isArray(entry.messaging)) {
      continue;
    }

    for (const event of entry.messaging) {
      if (!event) {
        continue;
      }

      const normalizedMessage = normalizeMessengerMessage(entry.id, event);

      if (normalizedMessage) {
        results.push({
          type: 'message',
          entryId: entry.id,
          timestamp: event.timestamp,
          message: normalizedMessage,
          raw: event,
        });
        continue;
      }

      if (event.postback) {
        results.push({
          type: 'postback',
          entryId: entry.id,
          timestamp: event.timestamp,
          postback: event.postback,
          raw: event,
        });
        continue;
      }

      results.push({
        type: 'unknown',
        entryId: entry.id,
        timestamp: event.timestamp,
        raw: event,
      });
    }
  }

  return results;
}

export function normalizeMessengerMessage(
  entryId: string,
  event: MessengerMessagingEvent,
): NormalizedMessengerMessage | undefined {
  if (!event.message) {
    return undefined;
  }

  const { message } = event;
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;

  if (!senderId || !recipientId) {
    return undefined;
  }

  const envelope: NormalizedMessageEnvelope = {
    objectId: entryId,
    senderId,
    recipientId,
    timestamp: event.timestamp,
    mid: message.mid,
    isEcho: Boolean(message.is_echo),
    metadata: message.metadata,
  };

  if (message.quick_reply) {
    return normalizeQuickReplyMessage(envelope, message.text ?? '', message.quick_reply);
  }

  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    return normalizeAttachmentMessage(envelope, message.text, message.attachments);
  }

  if (typeof message.text === 'string' && message.text.length > 0) {
    return normalizeTextMessage(envelope, message.text);
  }

  return undefined;
}

function normalizeTextMessage(
  envelope: NormalizedMessageEnvelope,
  text: string,
): NormalizedTextMessage {
  return {
    kind: 'text',
    envelope,
    text,
  };
}

function normalizeAttachmentMessage(
  envelope: NormalizedMessageEnvelope,
  text: string | undefined,
  attachments: MessengerAttachment[],
): NormalizedAttachmentMessage {
  return {
    kind: 'attachments',
    envelope,
    text,
    attachments: attachments.map((attachment) => ({ ...attachment })),
  };
}

function normalizeQuickReplyMessage(
  envelope: NormalizedMessageEnvelope,
  text: string,
  quickReply: MessengerQuickReplySelection,
): NormalizedQuickReplyMessage {
  return {
    kind: 'quick_reply',
    envelope,
    text,
    quickReply,
  };
}

export function buildMessagePayload(input: OutboundMessageInput): MessengerGraphMessagePayload {
  switch (input.kind) {
    case 'text':
      return buildTextMessagePayload(input);
    case 'attachment':
      return buildAttachmentMessagePayload(input);
    default: {
      const exhaustiveCheck: never = input;
      throw new TypeError(`Unsupported outbound message kind: ${String(exhaustiveCheck)}`);
    }
  }
}

export function buildTextMessagePayload(input: TextMessageInput): MessengerGraphMessagePayload {
  const quickReplies = normalizeQuickReplyOptions(input.quickReplies);

  return {
    text: input.text,
    metadata: input.metadata,
    quick_replies: quickReplies,
  };
}

export function buildAttachmentMessagePayload(
  input: AttachmentMessageInput,
): MessengerGraphMessagePayload {
  const quickReplies = normalizeQuickReplyOptions(input.quickReplies);

  return {
    text: input.text,
    attachment: cloneAttachment(input.attachment),
    metadata: input.metadata,
    quick_replies: quickReplies,
  };
}

export function normalizeQuickReplyOptions(
  options?: MessengerQuickReplyOption[],
): MessengerGraphQuickReply[] | undefined {
  if (!options || options.length === 0) {
    return undefined;
  }

  const normalized: MessengerGraphQuickReply[] = [];

  for (const option of options) {
    if (!option) {
      continue;
    }

    const contentType = option.contentType ?? 'text';

    if (contentType === 'text') {
      if (!option.title || option.title.length === 0) {
        throw new Error('Text quick replies must specify a title.');
      }

      const payload = option.payload ?? option.title;
      normalized.push({
        content_type: contentType,
        title: option.title,
        payload,
        image_url: option.imageUrl,
      });
      continue;
    }

    normalized.push({
      content_type: contentType,
      title: option.title,
      payload: option.payload,
      image_url: option.imageUrl,
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function cloneAttachment(attachment: MessengerAttachment): MessengerAttachment {
  return {
    type: attachment.type,
    payload: attachment.payload ? { ...attachment.payload } : undefined,
  };
}

export function buildRecipient(id: string): MessengerMessagingParticipant {
  return { id };
}
