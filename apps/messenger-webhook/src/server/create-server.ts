import helmet from '@fastify/helmet';
import fastifyRateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyTypeProviderDefault,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';

import type { AppConfig } from '../config';
import { registerHealthRoutes } from '../routes/health';
import { registerWebhookRoutes } from '../routes/webhook';
import type { MessengerWebhookService } from '../services/messenger/webhook-service';
import type { AppLogger } from '../telemetry/logger';
import type { GatewayMetrics } from '../telemetry/metrics';

type RawBodyRequest = {
  rawBody?: Buffer;
};

export type GatewayFastifyInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  AppLogger,
  FastifyTypeProviderDefault
>;

export interface ServerOptions {
  config: AppConfig;
  logger: AppLogger;
  metrics: GatewayMetrics;
  webhookService: MessengerWebhookService;
}

/**
 * Build and configure the Fastify HTTP server responsible for exposing
 * Messenger webhook endpoints, health checks, metrics, and the operational
 * middleware (helmet, rate limiting, correlation IDs).
 */
export async function createServer(options: ServerOptions): Promise<GatewayFastifyInstance> {
  const app = Fastify({
    logger: options.logger,
    disableRequestLogging: options.config.env === 'production',
  });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, payload, done) => {
    try {
      const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      (request as RawBodyRequest).rawBody = buffer;
      if (buffer.length === 0) {
        done(null, {});
        return;
      }
      const parsed = JSON.parse(buffer.toString('utf8'));
      done(null, parsed);
    } catch (error) {
      done(error as Error);
    }
  });

  await app.register(helmet, {
    global: true,
  });

  await app.register(fastifyRateLimit as unknown as FastifyPluginAsync<RateLimitPluginOptions>, {
    global: false,
    max: 60,
    timeWindow: '1 minute',
  });

  app.addHook('onRequest', (request, reply, done) => {
    const correlationId =
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-correlation-id'] as string) ||
      request.id;

    void reply.header('x-request-id', correlationId);
    request.headers['x-correlation-id'] = correlationId;
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        requestId: reply.getHeader('x-request-id'),
      },
      'Request completed',
    );
    done();
  });

  await registerHealthRoutes(app);
  await registerWebhookRoutes(app, {
    verifyToken: options.config.facebook.verifyToken,
    service: options.webhookService,
    metrics: options.metrics,
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
    },
  });

  app.get('/metrics', async (_, reply) => {
    const payload = await options.metrics.registry.metrics();
    return reply.type('text/plain').send(payload);
  });

  return app as GatewayFastifyInstance;
}
