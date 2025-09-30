export type MessengerObjectType = 'page';

export interface MessengerWebhookPayload {
  object: MessengerObjectType;
  entry: MessengerWebhookEntry[];
}

export interface MessengerWebhookEntry {
  id: string;
  time: number;
  messaging: MessengerMessagingEvent[];
}

export interface MessengerMessagingParticipant {
  id: string;
}

export interface MessengerQuickReplySelection {
  payload: string;
  title?: string;
}

export type MessengerQuickReplyContentType =
  | 'text'
  | 'location'
  | 'user_phone_number'
  | 'user_email';

export interface MessengerQuickReplyOption {
  contentType?: MessengerQuickReplyContentType;
  title?: string;
  payload?: string;
  imageUrl?: string;
}

export interface MessengerGraphQuickReply {
  content_type: MessengerQuickReplyContentType;
  title?: string;
  payload?: string;
  image_url?: string;
}

export interface MessengerAttachment {
  type: string;
  payload?: {
    url?: string;
    sticker_id?: string;
    template_type?: string;
    is_reusable?: boolean;
    [key: string]: unknown;
  };
}

export interface MessengerMessage {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  metadata?: string;
  attachments?: MessengerAttachment[];
  quick_reply?: MessengerQuickReplySelection;
  quick_replies?: MessengerQuickReplyOption[];
}

export interface MessengerGraphMessagePayload {
  text?: string;
  attachment?: MessengerAttachment;
  quick_replies?: MessengerGraphQuickReply[];
  metadata?: string;
}

export interface MessengerMessagingEvent {
  sender: MessengerMessagingParticipant;
  recipient: MessengerMessagingParticipant;
  timestamp: number;
  message?: MessengerMessage;
  postback?: MessengerPostback;
  prior_message?: {
    source: string;
    identifier?: string;
  };
  [key: string]: unknown;
}

export interface MessengerPostback {
  title?: string;
  payload?: string;
  referral?: MessengerReferral;
}

export interface MessengerReferral {
  ref?: string;
  source?: string;
  type?: string;
}

export interface NormalizedMessageEnvelope {
  objectId: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  mid?: string;
  isEcho: boolean;
  metadata?: string;
}

export type NormalizedMessengerMessage =
  | NormalizedTextMessage
  | NormalizedAttachmentMessage
  | NormalizedQuickReplyMessage;

export interface NormalizedTextMessage {
  kind: 'text';
  envelope: NormalizedMessageEnvelope;
  text: string;
}

export interface NormalizedAttachmentMessage {
  kind: 'attachments';
  envelope: NormalizedMessageEnvelope;
  text?: string;
  attachments: MessengerAttachment[];
}

export interface NormalizedQuickReplyMessage {
  kind: 'quick_reply';
  envelope: NormalizedMessageEnvelope;
  text: string;
  quickReply: MessengerQuickReplySelection;
}

export interface NormalizedMessengerEvent {
  type: 'message' | 'postback' | 'unknown';
  entryId: string;
  timestamp: number;
  message?: NormalizedMessengerMessage;
  postback?: MessengerPostback;
  raw: MessengerMessagingEvent;
}

export interface TextMessageInput {
  kind: 'text';
  text: string;
  quickReplies?: MessengerQuickReplyOption[];
  metadata?: string;
}

export interface AttachmentMessageInput {
  kind: 'attachment';
  attachment: MessengerAttachment;
  text?: string;
  quickReplies?: MessengerQuickReplyOption[];
  metadata?: string;
}

export type OutboundMessageInput = TextMessageInput | AttachmentMessageInput;

export type MessengerMessagingType =
  | 'RESPONSE'
  | 'UPDATE'
  | 'MESSAGE_TAG'
  | 'NON_PROMOTIONAL_SUBSCRIPTION';

export type MessengerSenderAction = 'typing_on' | 'typing_off' | 'mark_seen';

export interface SendMessageCommand {
  recipientId: string;
  message?: OutboundMessageInput;
  messagingType?: MessengerMessagingType;
  tag?: string;
  personaId?: string;
  senderAction?: MessengerSenderAction;
}

export interface MessengerSendApiRequest {
  recipient: MessengerMessagingParticipant;
  messaging_type?: MessengerMessagingType;
  tag?: string;
  persona_id?: string;
  sender_action?: MessengerSenderAction;
  message?: MessengerGraphMessagePayload;
}

export interface MessengerSendApiSuccess {
  recipient_id: string;
  message_id?: string;
  attachment_id?: string;
}

export interface MessengerSendResult {
  recipientId: string;
  messageId?: string;
  attachmentId?: string;
}

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpRequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export type HttpClient = (url: string, init?: HttpRequestInitLike) => Promise<HttpResponseLike>;

export interface FacebookMessengerAgentConfig {
  appSecret: string;
  pageAccessToken: string;
  graphApiVersion?: string;
  graphApiBaseUrl?: string;
  defaultMessagingType?: MessengerMessagingType;
  httpClient?: HttpClient;
}
