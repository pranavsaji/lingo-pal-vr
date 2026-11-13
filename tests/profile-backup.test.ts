import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, backupProfile, PROFILE_KEY, restoreProfile } from '../src/state/profile.js';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('profile backup before ?reset / ?demo', () => {
  it('keeps the real profile and restores it', () => {
    const kv = mem();
    kv.setItem(PROFILE_KEY, JSON.stringify({ name: 'Real', xp: 900, demo: '' }));
    backupProfile(kv);
    kv.setItem(PROFILE_KEY, JSON.stringify({ name: 'Alex', demo: 'week' }));
    expect(restoreProfile(kv)).toBe(true);
    expect(JSON.parse(kv.getItem(PROFILE_KEY)!).name).toBe('Real');
  });
  it('never overwrites the backup with a demo seed', () => {
    const kv = mem();
    kv.setItem(BACKUP_KEY, JSON.stringify({ name: 'Real' }));
    kv.setItem(PROFILE_KEY, JSON.stringify({ name: 'Alex', demo: 'week' }));
    backupProfile(kv);
    expect(JSON.parse(kv.getItem(BACKUP_KEY)!).name).toBe('Real');
  });
  it('restore without a backup is a no-op', () => {
    expect(restoreProfile(mem())).toBe(false);
  });
});
