import { FacebookMessengerAgent } from '@agui/messaging-sdk';
import type { FastifyInstance } from 'fastify';

import { loadConfig, type AppConfig } from './config';
import { createServer } from './server';
import { createAguiDispatcher } from './services/agui/dispatcher';
import { MessengerWebhookService } from './services/messenger/webhook-service';
import { InMemorySessionStore, RedisSessionStore, type SessionStore } from './services/session';
import { createLogger, type AppLogger } from './telemetry/logger';
import { createMetrics, type GatewayMetrics } from './telemetry/metrics';

export interface Application {
  config: AppConfig;
  logger: AppLogger;
  metrics: GatewayMetrics;
  server: FastifyInstance;
  start(): Promise<void>;
  stop(): Promise<void>;
}

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

async function startServer(server: FastifyInstance, config: AppConfig): Promise<void> {
  await server.listen({ port: config.port, host: '0.0.0.0' });
}

async function stopServer(
  server: FastifyInstance,
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

function createSessionStore(config: AppConfig): SessionStore {
  if (config.session.driver === 'redis') {
    if (!config.session.redisUrl) {
      throw new Error('SESSION_STORE_DRIVER=redis requires REDIS_URL environment variable');
    }

    return new RedisSessionStore({ url: config.session.redisUrl, prefix: 'messenger:' });
  }

  return new InMemorySessionStore({ prefix: 'messenger:' });
}
