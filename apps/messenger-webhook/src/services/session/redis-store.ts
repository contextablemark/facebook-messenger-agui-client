import Redis, { Redis as RedisClient } from 'ioredis';

import {
  DEFAULT_SESSION_TTL_SECONDS,
  SessionData,
  SessionKey,
  SessionStore,
  SessionStoreContext,
} from './store';

/** Options used to configure the Redis-backed session store. */
export interface RedisSessionStoreOptions extends SessionStoreContext {
  url?: string;
  client?: RedisClient;
  defaultTtlSeconds?: number;
}

/** Session store implementation backed by Redis. */
export class RedisSessionStore implements SessionStore {
  private readonly redis: RedisClient;
  private readonly prefix: string;
  private readonly defaultTtlSeconds: number;
  private readonly ownsClient: boolean;

  constructor(options: RedisSessionStoreOptions = {}) {
    if (!options.client && !options.url) {
      throw new Error('RedisSessionStore requires either a client or a url.');
    }

    if (options.client) {
      this.redis = options.client;
      this.ownsClient = false;
    } else {
      // Railway's managed Redis defaults to IPv6-only; forcing `family=0` lets ioredis
      // negotiate IPv4 instead of failing with `ERR This instance has cluster support disabled`.
      const redisUrl = new URL(options.url);
      if (!redisUrl.searchParams.has('family')) {
        redisUrl.searchParams.set('family', '0');
      }

      this.redis = new Redis(redisUrl.toString(), { lazyConnect: true });
      this.ownsClient = true;
    }

    this.prefix = options.prefix ?? 'session:';
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  }

  async read(key: SessionKey): Promise<SessionData | undefined> {
    await this.ensureConnected();
    const raw = await this.redis.get(this.namespaced(key));

    if (!raw) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as SessionData;
    } catch (error) {
      await this.redis.del(this.namespaced(key));
      throw new Error(
        `Failed to parse session payload for key ${key}: ${(error as Error).message}`,
      );
    }
  }

  async write(key: SessionKey, data: SessionData, ttlSeconds?: number): Promise<void> {
    await this.ensureConnected();
    const payload = JSON.stringify(data);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    await this.redis.set(this.namespaced(key), payload, 'EX', ttl);
  }

  async delete(key: SessionKey): Promise<void> {
    await this.ensureConnected();
    await this.redis.del(this.namespaced(key));
  }

  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.redis.quit();
    }
  }

  private namespaced(key: SessionKey): SessionKey {
    return `${this.prefix}${key}`;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.ownsClient) {
      return;
    }

    if (this.redis.status === 'ready' || this.redis.status === 'connecting') {
      return;
    }

    await this.redis.connect();
  }
}
