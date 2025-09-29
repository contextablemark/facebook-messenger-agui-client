import type {
  FastifyInstance,
  FastifyTypeProviderDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';

import type { AppLogger } from '../telemetry/logger';

type HealthFastifyInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  AppLogger,
  FastifyTypeProviderDefault
>;

/** Register simple health/liveness endpoints (currently `/healthz`). */
export async function registerHealthRoutes(app: HealthFastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));
}
