import pino, { Logger, LoggerOptions } from 'pino';

export type AppLogger = Logger;

export interface LoggerConfig {
  level?: string;
  name?: string;
}

export function createLogger(config: LoggerConfig = {}): AppLogger {
  const options: LoggerOptions = {
    name: config.name ?? 'messenger-webhook',
    level: config.level ?? inferDefaultLevel(),
  };

  return pino(options);
}

function inferDefaultLevel(): string {
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}
