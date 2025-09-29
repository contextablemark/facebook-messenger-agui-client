export interface SessionData {
  runId?: string;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
  expiresAt?: number;
  userId?: string;
  pageId?: string;
  lastEventTimestamp?: number;
  [key: string]: unknown;
}

export type SessionKey = string;

export interface SessionStore {
  read(key: SessionKey): Promise<SessionData | undefined>;
  write(key: SessionKey, data: SessionData, ttlSeconds?: number): Promise<void>;
  delete(key: SessionKey): Promise<void>;
}

export interface SessionStoreContext {
  prefix?: string;
}

export const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
