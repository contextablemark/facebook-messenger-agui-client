import { z } from 'zod';

/**
 * Zod schema describing the environment contract required for the gateway. It
 * enforces required Messenger/AG-UI secrets, validates URLs, and normalises
 * optional values like the HTTP port and session driver.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default(process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  PORT: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return 8080;
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid PORT value: ${value}`);
      }
      return parsed;
    }),
  FB_APP_SECRET: z.string().min(1, 'FB_APP_SECRET is required'),
  FB_PAGE_ACCESS_TOKEN: z.string().min(1, 'FB_PAGE_ACCESS_TOKEN is required'),
  FB_WEBHOOK_VERIFY_TOKEN: z.string().min(1, 'FB_WEBHOOK_VERIFY_TOKEN is required'),
  AGUI_BASE_URL: z.string().url('AGUI_BASE_URL must be a valid URL').optional(),
  AGUI_API_KEY: z.string().min(1).optional(),
  SESSION_STORE_DRIVER: z
    .string()
    .optional()
    .transform((value) => (value ? value.toLowerCase() : 'memory'))
    .pipe(z.enum(['memory', 'redis'])),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL').optional(),
  LOG_LEVEL: z.string().optional(),
  WEBHOOK_RATE_LIMIT_MAX: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return 60;
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid WEBHOOK_RATE_LIMIT_MAX value: ${value}`);
      }
      return parsed;
    }),
  WEBHOOK_RATE_LIMIT_WINDOW: z
    .string()
    .optional()
    .transform((value) => value ?? '1 minute'),
  MESSENGER_MAX_TEXT_LENGTH: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return 2000;
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid MESSENGER_MAX_TEXT_LENGTH value: ${value}`);
      }
      return parsed;
    }),
  MESSENGER_TYPING_KEEP_ALIVE_MS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return 5000;
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid MESSENGER_TYPING_KEEP_ALIVE_MS value: ${value}`);
      }
      return parsed;
    }),
});

export type SessionStoreDriver = z.infer<typeof envSchema>['SESSION_STORE_DRIVER'];

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  facebook: {
    appSecret: string;
    pageAccessToken: string;
    verifyToken: string;
  };
  agui: {
    baseUrl?: string;
    apiKey?: string;
  };
  rateLimit: {
    max: number;
    timeWindow: string;
  };
  session: {
    driver: SessionStoreDriver;
    redisUrl?: string;
  };
  messenger: {
    maxTextLength: number;
    typingKeepAliveMs: number;
  };
  logLevel?: string;
}

/**
 * Parse and validate configuration from the provided environment source,
 * returning a strongly typed settings object or throwing a descriptive error
 * if any required variable is missing or malformed.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const firstError = result.error.issues[0];
    throw new Error(firstError?.message ?? 'Invalid environment configuration');
  }

  const {
    NODE_ENV,
    PORT,
    FB_APP_SECRET,
    FB_PAGE_ACCESS_TOKEN,
    FB_WEBHOOK_VERIFY_TOKEN,
    AGUI_BASE_URL,
    AGUI_API_KEY,
    SESSION_STORE_DRIVER,
    REDIS_URL,
    LOG_LEVEL,
    WEBHOOK_RATE_LIMIT_MAX,
    WEBHOOK_RATE_LIMIT_WINDOW,
    MESSENGER_MAX_TEXT_LENGTH,
    MESSENGER_TYPING_KEEP_ALIVE_MS,
  } = result.data;

  return {
    env: NODE_ENV,
    port: PORT,
    facebook: {
      appSecret: FB_APP_SECRET,
      pageAccessToken: FB_PAGE_ACCESS_TOKEN,
      verifyToken: FB_WEBHOOK_VERIFY_TOKEN,
    },
    agui: {
      baseUrl: AGUI_BASE_URL,
      apiKey: AGUI_API_KEY,
    },
    rateLimit: {
      max: WEBHOOK_RATE_LIMIT_MAX,
      timeWindow: WEBHOOK_RATE_LIMIT_WINDOW,
    },
    session: {
      driver: SESSION_STORE_DRIVER,
      redisUrl: REDIS_URL,
    },
    messenger: {
      maxTextLength: MESSENGER_MAX_TEXT_LENGTH,
      typingKeepAliveMs: MESSENGER_TYPING_KEEP_ALIVE_MS,
    },
    logLevel: LOG_LEVEL,
  };
}
