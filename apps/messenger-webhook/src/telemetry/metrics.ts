import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface GatewayMetrics {
  registry: Registry;
  requestCounter: Counter<string>;
  requestDuration: Histogram<string>;
  dispatchFailures: Counter<string>;
  outboundMessages: Counter<string>;
  commandCounter: Counter<string>;
}

export interface MetricsOptions {
  prefix?: string;
  registry?: Registry;
}

export function createMetrics(options: MetricsOptions = {}): GatewayMetrics {
  const registry = options.registry ?? new Registry();
  const prefix = options.prefix ?? 'messenger_gateway_';

  collectDefaultMetrics({ register: registry, prefix });

  const requestCounter = new Counter({
    name: `${prefix}requests_total`,
    help: 'Total number of webhook requests processed',
    labelNames: ['method', 'status'],
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: `${prefix}request_duration_seconds`,
    help: 'Webhook request duration in seconds',
    labelNames: ['method', 'status'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const dispatchFailures = new Counter({
    name: `${prefix}dispatch_failures_total`,
    help: 'Total number of failures when dispatching events to AG-UI',
    registers: [registry],
  });

  const outboundMessages = new Counter({
    name: `${prefix}outbound_messages_total`,
    help: 'Total Messenger messages sent by the gateway',
    labelNames: ['kind', 'status'],
    registers: [registry],
  });

  const commandCounter = new Counter({
    name: `${prefix}slash_commands_total`,
    help: 'Slash commands handled by the gateway',
    labelNames: ['command', 'status'],
    registers: [registry],
  });

  return {
    registry,
    requestCounter,
    requestDuration,
    dispatchFailures,
    outboundMessages,
    commandCounter,
  };
}
