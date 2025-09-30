import { buildMessagePayload, buildRecipient, normalizeWebhookPayload } from './normalizers';
import { createSignatureHeader, verifyRequestSignature } from './signature';
import {
  FacebookMessengerAgentConfig,
  HttpClient,
  HttpRequestInitLike,
  HttpResponseLike,
  MessengerGraphMessagePayload,
  MessengerMessagingType,
  MessengerSendApiRequest,
  MessengerSendApiSuccess,
  MessengerSendResult,
  MessengerWebhookPayload,
  NormalizedMessengerEvent,
  OutboundMessageInput,
  SendMessageCommand,
} from './types';

const DEFAULT_GRAPH_API_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_GRAPH_API_VERSION = 'v20.0';
const DEFAULT_MESSAGING_TYPE: MessengerMessagingType = 'RESPONSE';

export class FacebookMessengerAgent {
  private readonly appSecret: string;
  private readonly pageAccessToken: string;
  private readonly graphApiBaseUrl: string;
  private readonly graphApiVersion: string;
  private readonly defaultMessagingType: MessengerMessagingType;
  private readonly httpClient: HttpClient;

  constructor(config: FacebookMessengerAgentConfig) {
    if (!config?.appSecret) {
      throw new Error('FacebookMessengerAgent requires an appSecret.');
    }

    if (!config.pageAccessToken) {
      throw new Error('FacebookMessengerAgent requires a pageAccessToken.');
    }

    this.appSecret = config.appSecret;
    this.pageAccessToken = config.pageAccessToken;
    this.graphApiBaseUrl = config.graphApiBaseUrl ?? DEFAULT_GRAPH_API_BASE_URL;
    this.graphApiVersion = config.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION;
    this.defaultMessagingType = config.defaultMessagingType ?? DEFAULT_MESSAGING_TYPE;
    this.httpClient = config.httpClient ?? defaultHttpClient;
  }

  verifySignature(signatureHeader: string | undefined, payload: string | Buffer): boolean {
    return verifyRequestSignature({
      appSecret: this.appSecret,
      signatureHeader,
      payload,
    });
  }

  signPayload(payload: string | Buffer): string {
    return createSignatureHeader(this.appSecret, payload);
  }

  normalizeWebhook(payload: MessengerWebhookPayload): NormalizedMessengerEvent[] {
    return normalizeWebhookPayload(payload);
  }

  buildOutboundMessage(message: OutboundMessageInput): MessengerGraphMessagePayload {
    return buildMessagePayload(message);
  }

  async sendMessage(command: SendMessageCommand): Promise<MessengerSendResult> {
    const request = this.buildSendApiRequest(command);
    const response = await this.httpClient(this.buildMessagesEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await this.raiseApiError(response);
    }

    const body = (await response.json()) as MessengerSendApiSuccess;
    return normalizeSendResult(body);
  }

  private buildSendApiRequest(command: SendMessageCommand): MessengerSendApiRequest {
    if (!command?.recipientId) {
      throw new Error('SendMessageCommand requires a recipientId.');
    }

    const hasMessage = Boolean(command.message);
    const hasSenderAction = Boolean(command.senderAction);

    if (!hasMessage && !hasSenderAction) {
      throw new Error('SendMessageCommand requires a message or senderAction.');
    }

    if (hasMessage && hasSenderAction) {
      throw new Error('SendMessageCommand must not mix message and senderAction.');
    }

    const request: MessengerSendApiRequest = {
      recipient: buildRecipient(command.recipientId),
    };

    if (hasSenderAction && command.senderAction) {
      request.sender_action = command.senderAction;
      return request;
    }

    // At this point, we must have a message payload.
    const message = command.message as OutboundMessageInput;
    request.message = buildMessagePayload(message);
    request.messaging_type = command.messagingType ?? this.defaultMessagingType;

    if (request.messaging_type === 'MESSAGE_TAG') {
      if (!command.tag) {
        throw new Error('MESSAGE_TAG messaging_type requires a tag.');
      }
      request.tag = command.tag;
    } else if (command.tag) {
      request.tag = command.tag;
    }

    if (command.personaId) {
      request.persona_id = command.personaId;
    }

    return request;
  }

  private buildMessagesEndpoint(): string {
    const baseUrl = this.graphApiBaseUrl.replace(/\/$/, '');
    const version = this.graphApiVersion.replace(/^\//, '');
    const url = `${baseUrl}/${version}/me/messages`;
    const tokenParam = `access_token=${encodeURIComponent(this.pageAccessToken)}`;
    return `${url}?${tokenParam}`;
  }

  private async raiseApiError(response: HttpResponseLike): Promise<never> {
    let body: unknown;
    let message = `Facebook Messenger API request failed with status ${response.status}.`;

    try {
      body = await response.json();
      const errorPayload = extractErrorPayload(body);
      if (errorPayload?.message) {
        message = errorPayload.message;
      }
      throw new FacebookMessengerApiError(message, response.status, body, errorPayload);
    } catch (error) {
      if (body !== undefined) {
        throw error;
      }

      const fallbackText = await safeReadText(response);
      throw new FacebookMessengerApiError(message, response.status, fallbackText);
    }
  }
}

export class FacebookMessengerApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly code?: number;
  readonly type?: string;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;

  constructor(
    message: string,
    status: number,
    details?: unknown,
    graphError?: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
      fbtrace_id?: string;
    } | null,
  ) {
    super(message);
    this.name = 'FacebookMessengerApiError';
    this.status = status;
    this.details = details;

    if (graphError) {
      this.code = graphError.code;
      this.type = graphError.type;
      this.errorSubcode = graphError.error_subcode;
      this.fbtraceId = graphError.fbtrace_id;
    }
  }
}

function extractErrorPayload(body: unknown): {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
} | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const errorCandidate = (body as Record<string, unknown>).error;
  if (!errorCandidate || typeof errorCandidate !== 'object') {
    return null;
  }

  const { message, type, code, error_subcode, fbtrace_id } = errorCandidate as {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
  return { message, type, code, error_subcode, fbtrace_id };
}

function normalizeSendResult(body: MessengerSendApiSuccess): MessengerSendResult {
  return {
    recipientId: body.recipient_id,
    messageId: body.message_id,
    attachmentId: body.attachment_id,
  };
}

async function safeReadText(response: HttpResponseLike): Promise<string> {
  try {
    const value = await response.text();
    return value;
  } catch {
    return '';
  }
}

const defaultHttpClient: HttpClient = async (url, init?: HttpRequestInitLike) => {
  const response = await fetch(url, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
  });

  const textClone = response.clone();

  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => textClone.text(),
  };
};
