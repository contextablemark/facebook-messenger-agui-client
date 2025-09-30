import { randomUUID } from 'node:crypto';

import { createRunDispatcher, type RunDispatcher } from '@ag-ui/client';
import type { LoggerLike, RunAgentInput, RunStreamHandlers, UserAgentMessage } from '@ag-ui/core';
import type { NormalizedMessengerEvent, NormalizedMessengerMessage } from '@agui/messaging-sdk';

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
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxConsecutiveParseErrors?: number;
}

/** Handlers surfaced from the AG-UI client. */
export type AguiDispatchHandlers = RunStreamHandlers;

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

    handlers?.onRunError?.({
      message: 'AG-UI dispatcher not configured',
      runId: undefined,
      threadId: context.sessionId,
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
  private readonly client: RunDispatcher;

  constructor(
    private readonly logger: LoggerLike,
    options: AguiDispatcherOptions,
  ) {
    this.client = createRunDispatcher({
      baseUrl: options.baseUrl!,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxConsecutiveParseErrors: options.maxConsecutiveParseErrors,
      logger,
    });
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

    try {
      await this.client.dispatch({ input: payload, handlers });
    } catch (error) {
      this.logger.error?.(
        { error, sessionId: context.sessionId, runId: payload?.runId },
        'Failed to dispatch events to AG-UI',
      );
      handlers.onRunError?.({
        message: (error as Error).message ?? 'Failed to dispatch events to AG-UI',
        runId: payload?.runId,
        threadId: payload?.threadId,
        cause: error,
      });
      throw error;
    }
  }
}

/** Turn Messenger events into an AG-UI RunAgentInput payload. */
export function buildRunInput(
  events: NormalizedMessengerEvent[],
  context: DispatchContext,
): RunAgentInput | undefined {
  const messages: UserAgentMessage[] = [];
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
