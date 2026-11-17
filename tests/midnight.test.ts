import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/state/store';

const kv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('a session left open past midnight', () => {
  afterEach(() => vi.useRealTimers());
  it('logs XP to the new day and counts it for the streak', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 23, 50));
    const store = new Store(kv());
    store.startSession();
    expect(store.today).toBe('2026-11-13');
    const streak = store.profile.streakDays;
    vi.setSystemTime(new Date(2026, 10, 14, 0, 10));
    expect(store.today).toBe('2026-11-14');
    store.addXp(10);
    expect(store.profile.lastPlayedDay).toBe('2026-11-14');
    expect(store.profile.streakDays).toBe(streak + 1);
    expect(store.profile.history['2026-11-14']?.xp).toBeGreaterThan(0);
  });
});
