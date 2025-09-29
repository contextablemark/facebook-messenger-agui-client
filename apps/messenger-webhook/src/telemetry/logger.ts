import pino, { Logger, LoggerOptions } from 'pino';

export type AppLogger = Logger;

export interface LoggerConfig {
  level?: string;
  name?: string;
}

/** Create a Pino logger instance tuned for the gateway defaults. */
export function createLogger(config: LoggerConfig = {}): AppLogger {
  const options: LoggerOptions = {
    name: config.name ?? 'messenger-webhook',
    level: config.level ?? inferDefaultLevel(),
  };

  return pino(options);
}

/** Choose a default log level based on the current environment. */
function inferDefaultLevel(): string {
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}
