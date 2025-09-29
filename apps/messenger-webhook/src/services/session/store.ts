/** Envelope stored per Messenger conversation for session continuity. */
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

/** Interface implemented by session store drivers. */
export interface SessionStore {
  read(key: SessionKey): Promise<SessionData | undefined>;
  write(key: SessionKey, data: SessionData, ttlSeconds?: number): Promise<void>;
  delete(key: SessionKey): Promise<void>;
}

/** Optional configuration for session store instances. */
export interface SessionStoreContext {
  prefix?: string;
}

/** Default expiry for Messenger session entries (24 hours). */
export const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
