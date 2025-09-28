import { describe, it, expect } from 'vitest';

import { ping, version } from './index';

describe('messaging-sdk smoke', () => {
  it('responds to ping', () => {
    expect(ping()).toBe('pong');
  });

  it('exposes a version', () => {
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });
});
