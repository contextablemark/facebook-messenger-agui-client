import {
  DEFAULT_SESSION_TTL_SECONDS,
  SessionData,
  SessionKey,
  SessionStore,
  SessionStoreContext,
} from './store';

interface MemoryEntry {
  value: SessionData;
  expiresAt: number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly store = new Map<SessionKey, MemoryEntry>();
  private readonly prefix: string;

  constructor(context: SessionStoreContext = {}) {
    this.prefix = context.prefix ?? 'session:';
  }

  async read(key: SessionKey): Promise<SessionData | undefined> {
    const namespacedKey = this.namespaced(key);
    const entry = this.store.get(namespacedKey);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(namespacedKey);
      return undefined;
    }

    return { ...entry.value };
  }

  async write(key: SessionKey, data: SessionData, ttlSeconds?: number): Promise<void> {
    const expiresIn = (ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
    const expiresAt = Date.now() + expiresIn;
    const namespacedKey = this.namespaced(key);

    this.store.set(namespacedKey, {
      value: { ...data },
      expiresAt,
    });
  }

  async delete(key: SessionKey): Promise<void> {
    this.store.delete(this.namespaced(key));
  }

  private namespaced(key: SessionKey): SessionKey {
    return `${this.prefix}${key}`;
  }
}
