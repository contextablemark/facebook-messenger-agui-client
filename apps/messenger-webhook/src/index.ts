import process from 'node:process';

import { createApplication } from './application';

export { createApplication } from './application';

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error) => {
    console.error('Failed to start Messenger webhook gateway', error);
    process.exitCode = 1;
  });
}

async function bootstrap(): Promise<void> {
  const app = await createApplication();

  await app.start();
  app.logger.info({ port: app.config.port }, 'Messenger webhook gateway started');

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.logger.info({ signal }, 'Shutting down Messenger webhook gateway');
    try {
      await app.stop();
      app.logger.info('Shutdown complete');
    } catch (error) {
      app.logger.error({ error }, 'Error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
