import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM server module
import { createDailyBudget, createRateLimiter, crossSite } from '../server/limits.mjs';
// @ts-expect-error plain ESM server module
import { rateLimited } from '../server/agent-handler.mjs';

describe('cost guards', () => {
  it('limits each IP in a sliding window', () => {
    const limited = createRateLimiter({ windowMs: 1000, max: 2 });
    expect([limited('a', 0), limited('a', 10), limited('a', 20)]).toEqual([false, false, true]);
    expect(limited('a', 1500)).toBe(false); // the window slid
    expect(limited('b', 20)).toBe(false);
  });
  it('cannot be reset by flooding it with new IPs', () => {
    const limited = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 3 });
    limited('victim', 0);
    limited('attacker', 1);
    expect(limited('attacker', 2)).toBe(true);
    for (let i = 0; i < 2; i++) limited(`ip${i}`, 3); // fills the table, evicts only the oldest
    expect(limited('attacker', 4)).toBe(true); // attacker was recently seen: still limited
  });
  it('caps daily spend and resets the next day', () => {
    const b = createDailyBudget(100);
    expect(b.take(60, new Date('2026-11-13T10:00:00Z'))).toBe(true);
    expect(b.take(60, new Date('2026-11-13T11:00:00Z'))).toBe(false);
    expect(b.take(60, new Date('2026-11-14T00:01:00Z'))).toBe(true);
  });
  it('rejects requests made by other websites', () => {
    expect(crossSite({ 'sec-fetch-site': 'cross-site' })).toBe(true);
    expect(crossSite({ 'sec-fetch-site': 'same-origin' })).toBe(false);
    expect(crossSite({})).toBe(false);
  });
  it('the AI route uses the shared limiter', () => {
    expect(typeof rateLimited).toBe('function');
    expect(rateLimited('test-ip-1')).toBe(false);
  });
});
