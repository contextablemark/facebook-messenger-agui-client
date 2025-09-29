import { randomUUID } from 'node:crypto';

import type {
  MessengerWebhookPayload,
  NormalizedMessengerEvent,
  NormalizedMessengerMessage,
  OutboundMessageInput,
  SendMessageCommand,
} from '@agui/messaging-sdk';
import { FacebookMessengerAgent } from '@agui/messaging-sdk';

import { DispatchError, SignatureVerificationError } from '../../errors';
import type { AppLogger } from '../../telemetry/logger';
import type { GatewayMetrics } from '../../telemetry/metrics';
import type { AguiDispatcher, AguiDispatchHandlers, DispatchContext } from '../agui';
import { DEFAULT_SESSION_TTL_SECONDS, SessionData, SessionStore } from '../session';

const MAX_MESSENGER_TEXT_LENGTH = 2000;

export interface HandleWebhookInput {
  payload: MessengerWebhookPayload;
  signatureHeader?: string;
  rawBody: Buffer | string;
}

export interface HandleWebhookResult {
  receivedEvents: number;
}

interface Participants {
  userId?: string;
  pageId?: string;
}

interface TypingState {
  sent: boolean;
  keepAlive?: NodeJS.Timeout;
}

const SLASH_HELP_MESSAGE = [
  'Available commands:',
  '/help  – show this message',
  '/reset – clear the current session and start fresh',
].join('\n');

export class MessengerWebhookService {
  constructor(
    private readonly agent: FacebookMessengerAgent,
    private readonly dispatcher: AguiDispatcher,
    private readonly sessions: SessionStore,
    private readonly metrics: GatewayMetrics,
    private readonly logger: AppLogger,
  ) {}

  async handleWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult> {
    const rawBody = toBuffer(input.rawBody);

    const signatureHeader = input.signatureHeader;

    if (!signatureHeader || !this.agent.verifySignature(signatureHeader, rawBody)) {
      this.logger.warn(
        {
          hasSignature: Boolean(signatureHeader),
          signaturePreview: signatureHeader?.slice(0, 12),
        },
        'Rejected Messenger webhook due to invalid signature',
      );
      throw new SignatureVerificationError();
    }

    const events = this.agent.normalizeWebhook(input.payload);

    if (events.length === 0) {
      return { receivedEvents: 0 };
    }

    const grouped = groupEventsBySession(events);

    for (const [sessionId, sessionEvents] of grouped.entries()) {
      await this.processSession(sessionId, sessionEvents);
    }

    return { receivedEvents: events.length };
  }

  private async processSession(
    sessionId: string,
    events: NormalizedMessengerEvent[],
  ): Promise<void> {
    const existing = await this.sessions.read(sessionId);
    const participants = resolveParticipants(events, existing);

    await this.persistSession(sessionId, existing, participants, events);

    const { dispatchable, handledCommand } = await this.filterSlashCommands(
      sessionId,
      participants.userId,
      events,
    );

    if (handledCommand && dispatchable.length === 0) {
      // Commands fully handled locally; nothing to forward.
      return;
    }

    if (dispatchable.length === 0) {
      return;
    }

    if (!participants.userId) {
      this.logger.warn({ sessionId }, 'Missing Messenger user identifier; skipping AG-UI dispatch');
      return;
    }

    const typingState: TypingState = { sent: false };

    await this.sendTypingAction(participants.userId, 'mark_seen', sessionId);

    typingState.sent = await this.sendTypingAction(participants.userId, 'typing_on', sessionId);
    if (typingState.sent && participants.userId) {
      typingState.keepAlive = setInterval(() => {
        void this.sendTypingAction(participants.userId, 'typing_on', sessionId);
      }, 5000);
    }

    const handlers = this.createDispatchHandlers(sessionId, participants, typingState);

    try {
      const context: DispatchContext = {
        sessionId,
        userId: participants.userId,
        pageId: participants.pageId,
      };
      await this.dispatcher.dispatch(dispatchable, context, handlers);
    } catch (error) {
      await this.handleDispatchFailure(participants.userId);
      throw new DispatchError('Failed to dispatch events to AG-UI', error);
    } finally {
      if (typingState.keepAlive) {
        clearInterval(typingState.keepAlive);
        typingState.keepAlive = undefined;
      }
      if (typingState.sent) {
        await this.sendTypingAction(participants.userId, 'typing_off', sessionId);
        typingState.sent = false;
      }
    }
  }

  private async persistSession(
    sessionId: string,
    existing: SessionData | undefined,
    participants: Participants,
    events: NormalizedMessengerEvent[],
  ): Promise<void> {
    try {
      const lastEventTimestamp = events[events.length - 1]?.timestamp ?? Date.now();
      const sessionState: SessionData = {
        ...existing,
        userId: participants.userId ?? existing?.userId,
        pageId: participants.pageId ?? existing?.pageId,
        lastEventTimestamp,
      };

      await this.sessions.write(sessionId, sessionState, DEFAULT_SESSION_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ sessionId, error }, 'Failed to update session store');
    }
  }

  private createDispatchHandlers(
    sessionId: string,
    participants: Participants,
    typingState: TypingState,
  ): AguiDispatchHandlers {
    return {
      onRunStarted: (payload) => {
        this.logger.info({ sessionId, runId: payload.runId }, 'AG-UI run started');
      },
      onRunFinished: async (payload) => {
        this.logger.info({ sessionId, runId: payload.runId }, 'AG-UI run finished');
        if (typingState.keepAlive) {
          clearInterval(typingState.keepAlive);
          typingState.keepAlive = undefined;
        }
        if (typingState.sent && participants.userId) {
          await this.sendTypingAction(participants.userId, 'typing_off', sessionId);
          typingState.sent = false;
        }
      },
      onRunError: async (payload) => {
        this.logger.error({ sessionId, payload }, 'AG-UI run error');
        if (participants.userId) {
          await this.sendErrorMessage(participants.userId);
        }
        if (typingState.keepAlive) {
          clearInterval(typingState.keepAlive);
          typingState.keepAlive = undefined;
        }
        if (typingState.sent && participants.userId) {
          await this.sendTypingAction(participants.userId, 'typing_off', sessionId);
          typingState.sent = false;
        }
      },
      onAssistantMessage: async (message) => {
        if (!participants.userId) {
          this.logger.warn({ sessionId }, 'Cannot send AG-UI assistant message without user id');
          return;
        }
        await this.sendTextMessage(participants.userId, message.content, 'assistant');
      },
    };
  }

  private async filterSlashCommands(
    sessionId: string,
    userId: string | undefined,
    events: NormalizedMessengerEvent[],
  ): Promise<{ dispatchable: NormalizedMessengerEvent[]; handledCommand: boolean }> {
    const dispatchable: NormalizedMessengerEvent[] = [];
    let handled = false;

    for (const event of events) {
      if (event.type === 'message' && event.message?.kind === 'text') {
        const wasCommand = await this.tryHandleSlashCommand(sessionId, userId, event.message);
        if (wasCommand) {
          handled = true;
          continue;
        }
      }
      dispatchable.push(event);
    }

    return { dispatchable, handledCommand: handled };
  }

  private async tryHandleSlashCommand(
    sessionId: string,
    userId: string | undefined,
    message: NormalizedMessengerMessage,
  ): Promise<boolean> {
    const text = message.text?.trim();
    if (!text || !text.startsWith('/')) {
      return false;
    }

    const [rawCommand] = text.split(/\s+/, 1);
    const command = rawCommand.toLowerCase();

    switch (command) {
      case '/reset': {
        await this.sessions.delete(sessionId);
        this.metrics.commandCounter.inc({ command: 'reset', status: 'success' });
        if (userId) {
          await this.sendTextMessage(userId, 'Conversation reset. You can start again.', 'command');
        }
        return true;
      }
      case '/help': {
        this.metrics.commandCounter.inc({ command: 'help', status: 'success' });
        if (userId) {
          await this.sendTextMessage(userId, SLASH_HELP_MESSAGE, 'command');
        }
        return true;
      }
      default: {
        this.metrics.commandCounter.inc({ command: 'unknown', status: 'success' });
        if (userId) {
          await this.sendTextMessage(
            userId,
            `Unknown command: ${rawCommand}\n\n${SLASH_HELP_MESSAGE}`,
            'command',
          );
        }
        return true;
      }
    }
  }

  private async handleDispatchFailure(userId: string | undefined): Promise<void> {
    this.metrics.dispatchFailures.inc();
    if (userId) {
      await this.sendErrorMessage(userId);
    }
  }

  private async sendTypingAction(
    recipientId: string | undefined,
    action: 'typing_on' | 'typing_off' | 'mark_seen',
    sessionId: string,
  ): Promise<boolean> {
    if (!recipientId) {
      return false;
    }

    try {
      const command: SendMessageCommand = {
        recipientId,
        senderAction: action,
      };
      await this.executeWithRetry(() => this.agent.sendMessage(command), 2);
      this.metrics.outboundMessages.inc({ kind: action, status: 'success' });
      return true;
    } catch (error) {
      this.metrics.outboundMessages.inc({ kind: action, status: 'error' });
      this.logger.warn({ sessionId, action, error }, 'Failed to send Messenger typing indicator');
      return false;
    }
  }

  private async sendTextMessage(
    recipientId: string | undefined,
    text: string,
    kind: 'assistant' | 'command' | 'error',
  ): Promise<void> {
    if (!recipientId || !text.trim()) {
      return;
    }

    const chunks = chunkText(text, MAX_MESSENGER_TEXT_LENGTH);

    for (const chunk of chunks) {
      const message: OutboundMessageInput = {
        kind: 'text',
        text: chunk,
      };

      const command: SendMessageCommand = {
        recipientId,
        message,
      };

      try {
        await this.executeWithRetry(() => this.agent.sendMessage(command), 3);
        this.metrics.outboundMessages.inc({ kind, status: 'success' });
      } catch (error) {
        this.metrics.outboundMessages.inc({ kind, status: 'error' });
        this.logger.error({ recipientId, error }, 'Failed to send Messenger message');
        break;
      }
    }
  }

  private async sendErrorMessage(recipientId: string): Promise<void> {
    await this.sendTextMessage(
      recipientId,
      'Sorry, something went wrong while processing your request. Please try again.',
      'error',
    );
  }

  private async executeWithRetry<T>(operation: () => Promise<T>, attempts: number): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts) {
          break;
        }
        await delay(100 * attempt);
      }
    }

    throw lastError as Error;
  }
}

function toBuffer(value: Buffer | string): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

function groupEventsBySession(
  events: NormalizedMessengerEvent[],
): Map<string, NormalizedMessengerEvent[]> {
  const result = new Map<string, NormalizedMessengerEvent[]>();

  for (const event of events) {
    const sessionId = resolveSessionId(event);
    const collection = result.get(sessionId);

    if (collection) {
      collection.push(event);
    } else {
      result.set(sessionId, [event]);
    }
  }

  return result;
}

function resolveSessionId(event: NormalizedMessengerEvent): string {
  const message = event.message;
  if (message?.envelope?.senderId) {
    return message.envelope.senderId;
  }

  if (message?.envelope?.recipientId) {
    return message.envelope.recipientId;
  }

  const rawSender = (event.raw as { sender?: { id?: string } } | undefined)?.sender?.id;
  if (rawSender) {
    return rawSender;
  }

  return `unknown-${randomUUID()}`;
}

function resolveParticipants(
  events: NormalizedMessengerEvent[],
  existing: SessionData | undefined,
): Participants {
  for (const event of events) {
    if (event.type === 'message' && event.message) {
      return {
        userId: event.message.envelope.senderId ?? existing?.userId,
        pageId: event.message.envelope.recipientId ?? existing?.pageId,
      };
    }

    if (event.type === 'postback' && event.raw) {
      const rawEvent = event.raw as { sender?: { id?: string }; recipient?: { id?: string } };
      if (rawEvent?.sender?.id) {
        return {
          userId: rawEvent.sender.id,
          pageId: rawEvent.recipient?.id ?? existing?.pageId,
        };
      }
    }
  }

  return {
    userId: existing?.userId,
    pageId: existing?.pageId,
  };
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(' ', maxLength);
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }
    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length === 0) {
      break;
    }
    chunks.push(chunk);
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
