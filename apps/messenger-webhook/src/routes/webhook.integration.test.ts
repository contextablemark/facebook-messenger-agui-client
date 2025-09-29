import { Registry, type Counter, type Histogram } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../config';
import { createServer, type GatewayFastifyInstance } from '../server/create-server';
import type { MessengerWebhookService } from '../services/messenger/webhook-service';
import { createLogger } from '../telemetry/logger';
import type { GatewayMetrics } from '../telemetry/metrics';

function createMetricsStub(): GatewayMetrics {
  const stopTimer = vi.fn();
  return {
    registry: new Registry(),
    requestCounter: { inc: vi.fn() } as unknown as Counter<string>,
    requestDuration: { startTimer: vi.fn(() => stopTimer) } as unknown as Histogram<string>,
    dispatchFailures: { inc: vi.fn() } as unknown as Counter<string>,
    outboundMessages: { inc: vi.fn() } as unknown as Counter<string>,
    commandCounter: { inc: vi.fn() } as unknown as Counter<string>,
  };
}

const baseConfig: AppConfig = {
  env: 'test',
  port: 8080,
  facebook: {
    appSecret: 'secret',
    pageAccessToken: 'token',
    verifyToken: 'verify-token',
  },
  agui: {},
  rateLimit: {
    max: 100,
    timeWindow: '1 minute',
  },
  session: {
    driver: 'memory',
  },
  messenger: {
    maxTextLength: 2000,
    typingKeepAliveMs: 5000,
  },
  logLevel: 'silent',
};

describe('registerWebhookRoutes', () => {
  let server: GatewayFastifyInstance | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it('validates payloads and delegates to the webhook service', async () => {
    const handleWebhook = vi.fn().mockResolvedValue({ receivedEvents: 2 });
    const service = { handleWebhook } as unknown as MessengerWebhookService;

    const metrics = createMetricsStub();
    const logger = createLogger({ level: 'silent' });

    server = await createServer({ config: baseConfig, logger, metrics, webhookService: service });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
            },
          ],
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/webhook',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=test-signature',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', receivedEvents: 2 });
    expect(metrics.requestCounter.inc).toHaveBeenCalledWith({ method: 'POST', status: '200' });

    const call = handleWebhook.mock.calls[0][0];
    expect(call.payload).toEqual(payload);
    expect(call.signatureHeader).toBe('sha256=test-signature');
    expect(Buffer.isBuffer(call.rawBody) || typeof call.rawBody === 'string').toBe(true);
  });

  it('rejects malformed payloads with HTTP 400', async () => {
    const handleWebhook = vi.fn();
    const service = { handleWebhook } as unknown as MessengerWebhookService;

    const metrics = createMetricsStub();
    const logger = createLogger({ level: 'silent' });

    server = await createServer({ config: baseConfig, logger, metrics, webhookService: service });

    const response = await server.inject({
      method: 'POST',
      url: '/webhook',
      payload: { object: 'page', entry: [] },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'Bad Request',
      message: 'Invalid Messenger webhook payload',
    });
    expect(metrics.requestCounter.inc).toHaveBeenCalledWith({ method: 'POST', status: '400' });
    expect(handleWebhook).not.toHaveBeenCalled();
  });
});
