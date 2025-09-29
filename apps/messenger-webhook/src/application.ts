import { FacebookMessengerAgent } from '@agui/messaging-sdk';

import { loadConfig, type AppConfig } from './config';
import { createServer, type GatewayFastifyInstance } from './server';
import { createAguiDispatcher } from './services/agui/dispatcher';
import { MessengerWebhookService } from './services/messenger/webhook-service';
import { InMemorySessionStore, RedisSessionStore, type SessionStore } from './services/session';
import { createLogger, type AppLogger } from './telemetry/logger';
import { createMetrics, type GatewayMetrics } from './telemetry/metrics';

export interface Application {
  config: AppConfig;
  logger: AppLogger;
  metrics: GatewayMetrics;
  server: GatewayFastifyInstance;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Compose the Messenger webhook gateway by wiring configuration loading,
 * logging/metrics, session storage, the AG-UI dispatcher, and the Fastify
 * server. The returned object exposes lifecycle helpers used by the CLI
 * entrypoint and integration tests so they can start/stop the full stack.
 */
export async function createApplication(): Promise<Application> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const metrics = createMetrics();

  const agent = new FacebookMessengerAgent({
    appSecret: config.facebook.appSecret,
    pageAccessToken: config.facebook.pageAccessToken,
  });

  const sessionStore = createSessionStore(config);
  const dispatcher = createAguiDispatcher(logger, {
    baseUrl: config.agui.baseUrl,
    apiKey: config.agui.apiKey,
  });

  const webhookService = new MessengerWebhookService(
    agent,
    dispatcher,
    sessionStore,
    metrics,
    logger,
  );

  const server = await createServer({
    config,
    logger,
    metrics,
    webhookService,
  });

  return {
    config,
    logger,
    metrics,
    server,
    start: () => startServer(server, config),
    stop: () => stopServer(server, sessionStore, logger),
  };
}

/**
 * Start the Fastify server on the configured port/host, exposing the webhook
 * routes and health/metrics endpoints on all interfaces for Docker/Railway.
 */
async function startServer(server: GatewayFastifyInstance, config: AppConfig): Promise<void> {
  await server.listen({ port: config.port, host: '0.0.0.0' });
}

/**
 * Shut down the HTTP server and close any Redis client connections. Failures
 * are logged but ignored so shutdowns triggered by process signals do not crash.
 */
async function stopServer(
  server: GatewayFastifyInstance,
  sessionStore: SessionStore,
  logger: AppLogger,
): Promise<void> {
  await server.close();

  if (sessionStore instanceof RedisSessionStore) {
    try {
      await sessionStore.close();
    } catch (error) {
      logger.warn({ error }, 'Failed to gracefully close Redis session store');
    }
  }
}

/**
 * Create the configured session store, using in-memory storage for local
 * development and Redis when the driver/env variables instruct us to.
 */
function createSessionStore(config: AppConfig): SessionStore {
  if (config.session.driver === 'redis') {
    if (!config.session.redisUrl) {
      throw new Error('SESSION_STORE_DRIVER=redis requires REDIS_URL environment variable');
    }

    return new RedisSessionStore({ url: config.session.redisUrl, prefix: 'messenger:' });
  }

  return new InMemorySessionStore({ prefix: 'messenger:' });
}
