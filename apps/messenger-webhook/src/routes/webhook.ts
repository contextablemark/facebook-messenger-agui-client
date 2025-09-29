import type { MessengerWebhookPayload } from '@agui/messaging-sdk';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyTypeProviderDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';

import { VerificationTokenError } from '../errors';
import type { MessengerWebhookService } from '../services/messenger/webhook-service';
import type { AppLogger } from '../telemetry/logger';
import type { GatewayMetrics } from '../telemetry/metrics';

interface VerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer | string;
}

export interface WebhookRouteContext {
  verifyToken: string;
  service: MessengerWebhookService;
  metrics: GatewayMetrics;
  rateLimit?: {
    max: number;
    timeWindow: string | number;
  };
}

/**
 * Register the Messenger webhook verification and event intake routes. Handles
 * Facebook’s GET subscription handshake (echoing the challenge when the verify
 * token matches) and the POST handler that performs signature validation,
 * metrics collection, and delegation to the core webhook service.
 */
type WebhookFastifyInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  AppLogger,
  FastifyTypeProviderDefault
>;

export async function registerWebhookRoutes(
  app: WebhookFastifyInstance,
  context: WebhookRouteContext,
): Promise<void> {
  app.get<{ Querystring: VerificationQuery }>(
    '/webhook',
    {
      config: {
        rateLimit: context.rateLimit,
      },
    },
    async (request, reply) => {
      const {
        'hub.mode': mode,
        'hub.verify_token': token,
        'hub.challenge': challenge,
      } = request.query;

      if (mode !== 'subscribe' || !challenge) {
        request.log.warn({ query: request.query }, 'Rejected Messenger verification request');
        throw new VerificationTokenError('Invalid verification request');
      }

      if (token !== context.verifyToken) {
        request.log.warn({ providedToken: token }, 'Messenger verification token mismatch');
        throw new VerificationTokenError();
      }

      return reply.code(200).type('text/plain').send(challenge);
    },
  );

  app.post<{ Body: MessengerWebhookPayload }>(
    '/webhook',
    {
      config: {
        rateLimit: context.rateLimit,
      },
    },
    async (request, reply) => {
      const stopTimer = context.metrics.requestDuration.startTimer();
      let statusCode = 200;

      try {
        const rawRequest = request as RawBodyRequest;
        const signature = (request.headers as Record<string, string>)['x-hub-signature-256'];
        const rawBody = rawRequest.rawBody ?? JSON.stringify(request.body ?? {});

        const result = await context.service.handleWebhook({
          payload: request.body,
          signatureHeader: signature,
          rawBody,
        });

        context.metrics.requestCounter.inc({ method: request.method, status: '200' });
        return reply.code(200).send({ status: 'ok', receivedEvents: result.receivedEvents });
      } catch (error) {
        statusCode = inferStatusCode(error);
        context.metrics.requestCounter.inc({ method: request.method, status: String(statusCode) });
        throw error;
      } finally {
        stopTimer({ method: request.method, status: String(statusCode) });
      }
    },
  );
}

/**
 * Translate known error shapes into HTTP status codes for metric tagging. Any
 * unexpected error falls back to HTTP 500.
 */
function inferStatusCode(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number') {
      return status;
    }
  }

  return 500;
}
