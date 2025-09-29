import { randomUUID } from 'node:crypto';

import type { NormalizedMessengerEvent, NormalizedMessengerMessage } from '@agui/messaging-sdk';

import type { AppLogger } from '../../telemetry/logger';

/**
 * Metadata describing the Messenger session we are relaying AG-UI events for.
 */
export interface DispatchContext {
  sessionId: string;
  userId: string;
  pageId?: string;
}

export interface AssistantMessagePayload {
  messageId?: string;
  content: string;
}

export interface RunLifecyclePayload {
  runId?: string;
  threadId?: string;
}

export interface RunErrorPayload extends RunLifecyclePayload {
  message: string;
  cause?: unknown;
}

export interface AguiDispatchHandlers {
  onRunStarted?(payload: RunLifecyclePayload): void;
  onRunFinished?(payload: RunLifecyclePayload): void;
  onRunError?(payload: RunErrorPayload): void;
  onAssistantMessage?(payload: AssistantMessagePayload): void;
}

/** Contract implemented by dispatcher strategies used to forward events. */
export interface AguiDispatcher {
  dispatch(
    events: NormalizedMessengerEvent[],
    context: DispatchContext,
    handlers?: AguiDispatchHandlers,
  ): Promise<void>;
}

export interface AguiDispatcherOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxConsecutiveParseErrors?: number;
}

interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: AgentMessage[];
  tools: unknown[];
  context: unknown[];
  forwardedProps: Record<string, unknown>;
  state: Record<string, unknown>;
}

type AgentMessage = UserAgentMessage;

interface UserAgentMessage {
  id?: string;
  role: 'user';
  content: string;
  name?: string;
}

/**
 * Dispatcher used when no AG-UI endpoint is configured. It logs and surfaces
 * errors without attempting any HTTP calls.
 */
class LoggingAguiDispatcher implements AguiDispatcher {
  constructor(private readonly logger: AppLogger) {}

  async dispatch(
    events: NormalizedMessengerEvent[],
    context: DispatchContext,
    handlers?: AguiDispatchHandlers,
  ): Promise<void> {
    this.logger.warn(
      {
        sessionId: context.sessionId,
        userId: context.userId,
        eventCount: events.length,
      },
      'AG-UI dispatcher not configured - dropping events',
    );

    handlers?.onRunError?.({
      message: 'AG-UI dispatcher not configured',
      runId: undefined,
      threadId: context.sessionId,
    });
  }
}

/** Factory that chooses the appropriate dispatcher for the provided options. */
export function createAguiDispatcher(
  logger: AppLogger,
  options: AguiDispatcherOptions = {},
): AguiDispatcher {
  if (!options.baseUrl) {
    return new LoggingAguiDispatcher(logger);
  }

  return new HttpAguiDispatcher(logger, options);
}

/** Dispatcher that posts Messenger events to an AG-UI HTTP agent endpoint. */
class HttpAguiDispatcher implements AguiDispatcher {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxConsecutiveParseErrors: number;

  constructor(
    private readonly logger: AppLogger,
    options: AguiDispatcherOptions,
  ) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxConsecutiveParseErrors = options.maxConsecutiveParseErrors ?? 3;
  }

  async dispatch(
    events: NormalizedMessengerEvent[],
    context: DispatchContext,
    handlers?: AguiDispatchHandlers,
  ): Promise<void> {
    const payload = this.buildRunInput(events, context);

    if (!payload) {
      this.logger.debug(
        { sessionId: context.sessionId },
        'No Messenger events to dispatch to AG-UI',
      );
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await safeRead(response);
        throw new Error(`AG-UI dispatch failed with status ${response.status}: ${body}`);
      }

      const body = await response.text();
      this.processEventStream(body, handlers ?? {});
    } catch (error) {
      this.logger.error(
        { error, sessionId: context.sessionId, runId: payload?.runId },
        'Failed to dispatch events to AG-UI',
      );
      handlers?.onRunError?.({
        message: (error as Error).message ?? 'Failed to dispatch events to AG-UI',
        runId: payload?.runId,
        threadId: payload?.threadId,
        cause: error,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Turn Messenger events into an AG-UI RunAgentInput payload. */
  private buildRunInput(
    events: NormalizedMessengerEvent[],
    context: DispatchContext,
  ): RunAgentInput | undefined {
    const messages: AgentMessage[] = [];
    let lastTimestamp = 0;

    for (const event of events) {
      if (event.timestamp > lastTimestamp) {
        lastTimestamp = event.timestamp;
      }

      if (event.type === 'message' && event.message) {
        const userMessage = buildUserMessage(event.message);
        if (userMessage) {
          messages.push(userMessage);
        }
      } else if (event.type === 'postback' && event.postback) {
        messages.push({
          role: 'user',
          content: buildPostbackContent(event.postback),
        });
      }
    }

    if (messages.length === 0) {
      return undefined;
    }

    return {
      threadId: context.sessionId,
      runId: `messenger-${context.sessionId}-${randomUUID()}`,
      messages,
      tools: [],
      context: [],
      forwardedProps: {
        source: 'facebook-messenger',
        pageId: context.pageId,
        userId: context.userId,
      },
      state: {
        messenger: {
          lastEventTimestamp: lastTimestamp || Date.now(),
        },
      },
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Parse the SSE event stream produced by AG-UI and invoke handler callbacks
   * for run lifecycle and assistant message content.
   */
  private processEventStream(stream: string, handlers: AguiDispatchHandlers): void {
    if (!stream) {
      return;
    }

    const normalized = stream.replace(/\r\n/g, '\n');
    const blocks = normalized.split('\n\n');
    const activeMessages = new Map<string, string>();
    const dispatchedMessages = new Set<string>();

    const emitMessage = (messageId: string | undefined, content: string | undefined) => {
      const trimmed = content?.trim();
      if (!trimmed) {
        return;
      }
      if (messageId) {
        if (dispatchedMessages.has(messageId)) {
          return;
        }
        dispatchedMessages.add(messageId);
      }
      handlers.onAssistantMessage?.({ messageId, content: trimmed });
    };

    let consecutiveParseErrors = 0;

    for (const block of blocks) {
      if (!block) {
        continue;
      }

      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) {
        continue;
      }

      const payloadString = dataLines.join('\n');
      if (!payloadString) {
        continue;
      }

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payloadString);
        consecutiveParseErrors = 0;
      } catch (error) {
        consecutiveParseErrors += 1;
        this.logger.warn(
          { error, attempt: consecutiveParseErrors },
          'Failed to parse AG-UI SSE event payload',
        );
        if (consecutiveParseErrors >= this.maxConsecutiveParseErrors) {
          const parseError = new Error('Exceeded consecutive AG-UI SSE parse errors');
          (parseError as { cause?: unknown }).cause = error;
          throw parseError;
        }
        continue;
      }

      const type = String(event.type ?? '').toUpperCase();

      switch (type) {
        case 'RUN_STARTED': {
          activeMessages.clear();
          dispatchedMessages.clear();
          handlers.onRunStarted?.({
            runId: asString(event.run_id ?? event.runId),
            threadId: asString(event.thread_id ?? event.threadId),
          });
          break;
        }
        case 'RUN_FINISHED': {
          for (const [messageId, content] of activeMessages.entries()) {
            emitMessage(messageId, content);
            activeMessages.delete(messageId);
          }

          handlers.onRunFinished?.({
            runId: asString(event.run_id ?? event.runId),
            threadId: asString(event.thread_id ?? event.threadId),
          });
          activeMessages.clear();
          dispatchedMessages.clear();
          break;
        }
        case 'RUN_ERROR': {
          handlers.onRunError?.({
            runId: asString(event.run_id ?? event.runId),
            threadId: asString(event.thread_id ?? event.threadId),
            message: asString(event.message) ?? 'Unknown AG-UI error',
            cause: event,
          });
          break;
        }
        case 'TEXT_MESSAGE_START': {
          if (!isAssistant(event.role)) {
            break;
          }
          const messageId = asString(event.message_id ?? event.messageId) ?? randomUUID();
          if (!activeMessages.has(messageId)) {
            activeMessages.set(messageId, '');
          }
          break;
        }
        case 'TEXT_MESSAGE_CONTENT':
        case 'TEXT_MESSAGE_CHUNK': {
          const messageId = asString(event.message_id ?? event.messageId);
          if (!messageId) {
            break;
          }
          if (!isAssistant(event.role) && activeMessages.size === 0) {
            break;
          }
          const current = activeMessages.get(messageId) ?? '';
          const delta = extractDelta(event.delta ?? event.text ?? '');
          activeMessages.set(messageId, `${current}${delta}`);
          break;
        }
        case 'TEXT_MESSAGE_END': {
          const messageId = asString(event.message_id ?? event.messageId);
          if (!messageId) {
            break;
          }
          const content = activeMessages.get(messageId);
          activeMessages.delete(messageId);
          emitMessage(messageId, content);
          break;
        }
        case 'TEXT_MESSAGE': {
          if (!isAssistant(event.role)) {
            break;
          }
          const messageId = asString(event.message_id ?? event.messageId);
          const content = asString(event.content); // snapshot-style single message
          if (messageId && dispatchedMessages.has(messageId)) {
            break;
          }
          emitMessage(messageId, content);
          break;
        }
        case 'MESSAGES_SNAPSHOT': {
          if (dispatchedMessages.size > 0) {
            this.logger.debug(
              'Skipping messages snapshot because assistant output already dispatched',
            );
            break;
          }
          const messages = Array.isArray(event.messages)
            ? (event.messages as Record<string, unknown>[])
            : [];
          for (const message of messages) {
            if (!isAssistant(message.role)) {
              continue;
            }
            const messageId = asString(message.id ?? message.message_id ?? message.messageId);
            const content = asString(message.content);
            if (messageId && dispatchedMessages.has(messageId)) {
              continue;
            }
            emitMessage(messageId, content);
          }
          activeMessages.clear();
          break;
        }
        default:
          break;
      }
    }

    for (const [messageId, content] of activeMessages.entries()) {
      emitMessage(messageId, content);
    }
  }
}

/** Convert a normalised Messenger message into a RunAgentInput user message. */
function buildUserMessage(message: NormalizedMessengerMessage): UserAgentMessage | undefined {
  if (message.envelope.isEcho) {
    return undefined;
  }

  switch (message.kind) {
    case 'text':
      return {
        id: message.envelope.mid,
        role: 'user',
        content: message.text,
      };
    case 'quick_reply': {
      const parts: string[] = [];
      if (message.text) {
        parts.push(message.text);
      }
      parts.push(`Quick reply payload: ${message.quickReply.payload}`);
      if (message.quickReply.title) {
        parts.push(`Quick reply title: ${message.quickReply.title}`);
      }
      return {
        id: message.envelope.mid,
        role: 'user',
        content: parts.join('\n'),
      };
    }
    case 'attachments': {
      const details = message.attachments.map((attachment, index) => {
        const attachmentLabel = attachment.type ?? `attachment-${index + 1}`;
        const payloadSummary = attachment.payload ? JSON.stringify(attachment.payload) : '{}';
        return `${attachmentLabel}: ${payloadSummary}`;
      });

      const sections: string[] = [];
      if (message.text) {
        sections.push(message.text);
      }
      sections.push('Attachments:');
      sections.push(...details);

      return {
        id: message.envelope.mid,
        role: 'user',
        content: sections.join('\n'),
      };
    }
    default:
      return undefined;
  }
}

/** Convert Messenger postback data into a human-readable user message. */
function buildPostbackContent(postback: { title?: string; payload?: string }): string {
  const parts: string[] = [];
  if (postback.title) {
    parts.push(`Postback title: ${postback.title}`);
  }
  if (postback.payload) {
    parts.push(`Postback payload: ${postback.payload}`);
  }
  return parts.join('\n') || 'Postback received';
}

/** Safely attempt to read the response body for error reporting. */
async function safeRead(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return (error as Error).message;
  }
}

/** Normalise URLs by removing any trailing slash. */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

/** Helper that returns the string value or `undefined` for non-strings. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Determine whether an event role indicates an assistant speaker. */
function isAssistant(role: unknown): boolean {
  return typeof role === 'string' && role.toLowerCase() === 'assistant';
}

/** Extract text content from AG-UI text delta payloads. */
function extractDelta(delta: unknown): string {
  if (delta === undefined || delta === null) {
    return '';
  }
  if (typeof delta === 'string') {
    return delta;
  }
  return JSON.stringify(delta);
}
