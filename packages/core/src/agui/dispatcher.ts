import { randomUUID } from 'node:crypto';

import { HttpAgent, type AgentSubscriber, type RunAgentParameters } from '@ag-ui/client';
import type { Message, RunAgentInput, UserMessage } from '@ag-ui/core';
import type { NormalizedMessengerEvent, NormalizedMessengerMessage } from '@agui-gw/fb-messenger';

/**
 * Minimal logging contract used by the AG-UI dispatcher implementations.
 * A console-like logger satisfies this interface out of the box.
 */
export interface LoggerLike {
  debug?(payload?: unknown, message?: string): void;
  info?(payload?: unknown, message?: string): void;
  warn?(payload?: unknown, message?: string): void;
  error?(payload?: unknown, message?: string): void;
}

/** Metadata describing the Messenger session we are relaying AG-UI events for. */
export interface DispatchContext {
  sessionId: string;
  userId: string;
  pageId?: string;
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
  headers?: Record<string, string>;
  debug?: boolean;
}

/** Handlers surfaced to consumers when AG-UI run events are emitted. */
export interface AguiDispatchHandlers {
  onRunStarted?(payload: RunLifecyclePayload): void | Promise<void>;
  onRunFinished?(payload: RunLifecyclePayload): void | Promise<void>;
  onRunError?(payload: RunErrorPayload): void | Promise<void>;
  onAssistantMessage?(payload: AssistantMessagePayload): void | Promise<void>;
}

/** Details emitted when an AG-UI run starts or finishes. */
export interface RunLifecyclePayload {
  runId?: string;
  threadId: string;
  timestamp?: number;
}

/**
 * Error payload surfaced when a run fails during streaming or network
 * dispatch. Consumers can surface the message directly or inspect metadata for
 * richer logging.
 */
export interface RunErrorPayload extends RunLifecyclePayload {
  message: string;
  code?: string | number;
  cause?: unknown;
}

/** Assistant message emitted by AG-UI that should be forwarded to Messenger. */
export interface AssistantMessagePayload {
  messageId?: string;
  content: string;
  runId?: string;
  threadId?: string;
}

/**
 * Dispatcher used when no AG-UI endpoint is configured. It logs and surfaces
 * errors without attempting any HTTP calls.
 */
class LoggingAguiDispatcher implements AguiDispatcher {
  constructor(private readonly logger: LoggerLike) {}

  async dispatch(
    events: NormalizedMessengerEvent[],
    context: DispatchContext,
    handlers?: AguiDispatchHandlers,
  ): Promise<void> {
    this.logger.warn?.(
      {
        sessionId: context.sessionId,
        userId: context.userId,
        eventCount: events.length,
      },
      'AG-UI dispatcher not configured - dropping events',
    );

    await handlers?.onRunError?.({
      message: 'AG-UI dispatcher not configured',
      threadId: context.sessionId,
      runId: undefined,
    });
  }
}

/** Factory that chooses the appropriate dispatcher for the provided options. */
export function createAguiDispatcher(
  logger: LoggerLike,
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
  private readonly headers: Record<string, string>;
  private readonly debug: boolean;

  constructor(
    private readonly logger: LoggerLike,
    options: AguiDispatcherOptions,
  ) {
    this.baseUrl = options.baseUrl!;
    this.debug = options.debug ?? false;
    this.headers = { ...(options.headers ?? {}) };
    if (options.apiKey) {
      this.headers.Authorization ??= `Bearer ${options.apiKey}`;
    }
  }

  async dispatch(
    events: NormalizedMessengerEvent[],
    context: DispatchContext,
    handlers: AguiDispatchHandlers = {},
  ): Promise<void> {
    const payload = buildRunInput(events, context);

    if (!payload) {
      this.logger.debug?.(
        { sessionId: context.sessionId },
        'No Messenger events to dispatch to AG-UI',
      );
      return;
    }

    const agent = new HttpAgent({
      url: this.baseUrl,
      headers: this.headers,
      threadId: payload.threadId,
      debug: this.debug,
    });

    agent.setMessages(payload.messages as Message[]);
    agent.setState(payload.state ?? {});

    const runParameters: RunAgentParameters = {
      runId: payload.runId,
      tools: payload.tools,
      context: payload.context,
      forwardedProps: payload.forwardedProps,
    };

    const subscriber = this.createSubscriber(handlers, payload);

    try {
      await agent.runAgent(runParameters, subscriber);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      const lifecycle: RunLifecyclePayload = {
        runId: payload.runId,
        threadId: payload.threadId,
      };

      this.logger.error?.(
        { error: cause, sessionId: context.sessionId, runId: payload.runId },
        'Failed to dispatch events to AG-UI',
      );

      await handlers.onRunError?.({
        ...lifecycle,
        message: cause.message || 'Failed to dispatch events to AG-UI',
        code: (cause as { code?: string | number }).code ?? (cause as { status?: number }).status,
        cause,
      });

      throw cause;
    } finally {
      agent.abortRun();
    }
  }

  private createSubscriber(handlers: AguiDispatchHandlers, input: RunAgentInput): AgentSubscriber {
    const base: RunLifecyclePayload = {
      runId: input.runId,
      threadId: input.threadId,
    };

    const resolveLifecycle = (
      runId: string | undefined,
      threadId: string | undefined,
      timestamp?: number,
    ): RunLifecyclePayload => ({
      runId: runId ?? base.runId,
      threadId: threadId ?? base.threadId,
      timestamp,
    });

    return {
      onRunStartedEvent: async ({ event }) => {
        await handlers.onRunStarted?.(
          resolveLifecycle(event.runId, event.threadId, event.timestamp),
        );
      },
      onRunFinishedEvent: async ({ event }) => {
        await handlers.onRunFinished?.(
          resolveLifecycle(event.runId, event.threadId, event.timestamp),
        );
      },
      onRunErrorEvent: async ({ event }) => {
        const runId = (event as Partial<RunLifecyclePayload>).runId;
        const threadId = (event as Partial<RunLifecyclePayload>).threadId;
        await handlers.onRunError?.({
          ...resolveLifecycle(runId, threadId, event.timestamp),
          message: event.message,
          code: event.code,
        });
      },
      onRunFailed: async ({ error }) => {
        await handlers.onRunError?.({
          ...base,
          message: error.message ?? 'AG-UI run failed before streaming events',
          cause: error,
        });
      },
      // Use onTextMessageEndEvent to capture the full accumulated text buffer.
      // This handles text output that comes before, between, or after tool calls.
      onTextMessageEndEvent: async ({ event, textMessageBuffer }) => {
        if (!textMessageBuffer) {
          return;
        }

        await handlers.onAssistantMessage?.({
          messageId: event.messageId,
          content: textMessageBuffer,
          runId: base.runId,
          threadId: base.threadId,
        });
      },
    } satisfies AgentSubscriber;
  }
}

/** Turn Messenger events into an AG-UI RunAgentInput payload. */
export function buildRunInput(
  events: NormalizedMessengerEvent[],
  context: DispatchContext,
): RunAgentInput | undefined {
  const messages: UserMessage[] = [];
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
        id: randomUUID(),
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

/** Convert a normalised Messenger message into a RunAgentInput user message. */
function buildUserMessage(message: NormalizedMessengerMessage): UserMessage | undefined {
  if (message.envelope.isEcho) {
    return undefined;
  }

  switch (message.kind) {
    case 'text': {
      const textId = message.envelope.mid ?? randomUUID();
      return {
        id: textId,
        role: 'user',
        content: message.text,
      };
    }
    case 'quick_reply': {
      const parts: string[] = [];
      if (message.text) {
        parts.push(message.text);
      }
      parts.push(`Quick reply payload: ${message.quickReply.payload}`);
      if (message.quickReply.title) {
        parts.push(`Quick reply title: ${message.quickReply.title}`);
      }
      const quickReplyId = message.envelope.mid ?? randomUUID();
      return {
        id: quickReplyId,
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

      const attachmentsId = message.envelope.mid ?? randomUUID();
      return {
        id: attachmentsId,
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
