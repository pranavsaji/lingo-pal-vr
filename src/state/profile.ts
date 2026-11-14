/**
 * Learner profile persistence. localStorage today; the shape is plain JSON so
 * a server sync can be added later. Storage can throw (private mode, blocked
 * site data), so every access is defensive and the app works without it.
 */

import type { History } from './history.js';
import { emptyPassport, type PassportProgress } from './passport.js';
import type { Mistake } from './mistakes.js';
import type { TomorrowPlan } from './plan.js';
import type { Quest } from './quest.js';
import type { SrsCard } from './srs.js';

export interface Settings {
  highContrast: boolean;
  textSize: 's' | 'm' | 'l';
  slowSpeech: boolean;
  subtitles: boolean;
  leftHanded: boolean;
  gazeDwell: boolean;
  reduceMotion: boolean;
  mixedReality: boolean;
  /** Hands-free voice: Lune listens after each line she speaks (no pinch to talk). */
  voiceFirst: boolean;
  /** "Vraie vie": natural-pace French, no English, no reply chips (src/agent/real-life.ts). */
  realLife: boolean;
  /** Sounds-like lines for English speakers under the reply chips ("duh ka-FAY"). */
  pronunciationHelp: boolean;
}

export interface Profile {
  version: 2;
  name: string;
  xp: number;
  streakDays: number;
  lastPlayedDay: string;
  sessions: number;
  bestScore: number;
  wordsSeen: string[];
  srs: Record<string, SrsCard>;
  memories: Record<string, string>;
  unlocks: string[];
  onboarded: boolean;
  lastVisit: string;
  stats: { orders: number; payments: number; phrases: number; pronunciationTotal: number; pronunciationCount: number };
  settings: Settings;
  /** Daily activity (XP, minutes, words, orders, pronunciation) for the weekly report. */
  history: History;
  /** Today's shopping list across Paris (null until first created). */
  quest: Quest | null;
  /** Passeport de Paris: stamps and the counters they are earned from. */
  passport: PassportProgress;
  /** Jours de repos (streak freezes) in reserve. */
  restDays: number;
  /** Recent days a rest day covered (shown in the weekly report). */
  restUsed: string[];
  /** Set when the profile was seeded by ?demo=week (labelled in the UI). */
  demo: string;
  /** The shopkeepers' notes on this learner: mistakes to reuse, tomorrow's plan, change tests. */
  coach: CoachMemory;
  /** The shopkeeper has invited this learner to "vraie vie" mode (once, after the 5th order). */
  realLifeInvited: boolean;
  /** Pal, the English-speaking companion, has introduced itself (once). */
  palIntroduced: boolean;
}

export interface CoachMemory {
  /** Bounded list of concrete mistakes (state/mistakes.ts). */
  mistakes: Mistake[];
  /** Planned at goodbye for the next day (state/plan.ts). */
  plan: TomorrowPlan | null;
  /** Wrong-change tests given and caught (all time). */
  tricks: number;
  caught: number;
}

export function defaultCoach(): CoachMemory {
  return { mistakes: [], plan: null, tricks: 0, caught: 0 };
}

export const DEFAULT_SETTINGS: Settings = {
  highContrast: false,
  textSize: 'm',
  slowSpeech: false,
  subtitles: true,
  leftHanded: false,
  gazeDwell: false,
  reduceMotion: false,
  mixedReality: false,
  voiceFirst: false,
  realLife: false,
  pronunciationHelp: true,
};

export function defaultProfile(): Profile {
  return {
    version: 2,
    name: '',
    xp: 0,
    streakDays: 0,
    lastPlayedDay: '',
    sessions: 0,
    bestScore: 0,
    wordsSeen: [],
    srs: {},
    memories: {},
    unlocks: [],
    onboarded: false,
    lastVisit: '',
    stats: { orders: 0, payments: 0, phrases: 0, pronunciationTotal: 0, pronunciationCount: 0 },
    settings: { ...DEFAULT_SETTINGS },
    history: {},
    quest: null,
    passport: emptyPassport(),
    restDays: 0,
    restUsed: [],
    demo: '',
    coach: defaultCoach(),
    realLifeInvited: false,
    palIntroduced: false,
  };
}

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PROFILE_KEY = 'lingo-pal-vr.profile.v2';
const LEGACY_KEY = 'lingo-pal-vr.progress.v1';

/**
 * Browser storage. `?reset` in the URL starts a brand-new learner (first-launch
 * tutorial again): handy for demos and judging a fresh first five minutes.
 */
export function browserKV(): KV | null {
  try {
    if (typeof window === 'undefined') return null;
    const kv = window.localStorage;
    const params = new URLSearchParams(window.location.search);
    if (params.has('restore')) restoreProfile(kv);
    if (params.has('reset')) {
      backupProfile(kv);
      kv.removeItem(PROFILE_KEY);
      kv.removeItem(LEGACY_KEY);
    }
    return kv;
  } catch {
    return null;
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Merge stored JSON over defaults so new fields always exist. */
export function loadProfile(kv: KV | null): Profile {
  const base = defaultProfile();
  if (!kv) return base;
  try {
    const stored = safeParse(kv.getItem(PROFILE_KEY)) as Partial<Profile> | null;
    if (stored && typeof stored === 'object') {
      return {
        ...base,
        ...stored,
        version: 2,
        stats: { ...base.stats, ...(stored.stats ?? {}) },
        settings: { ...base.settings, ...(stored.settings ?? {}) },
        srs: { ...(stored.srs ?? {}) },
        memories: { ...(stored.memories ?? {}) },
        history: { ...(stored.history ?? {}) },
        quest: stored.quest ?? null,
        passport: {
          ...base.passport,
          ...(stored.passport ?? {}),
          stamps: { ...(stored.passport?.stamps ?? {}) },
          placeOrders: { ...(stored.passport?.placeOrders ?? {}) },
        },
        restDays: Number(stored.restDays) || 0,
        restUsed: Array.isArray(stored.restUsed) ? stored.restUsed.filter((d): d is string => typeof d === 'string') : [],
        demo: typeof stored.demo === 'string' ? stored.demo : '',
        coach: { ...defaultCoach(), ...(stored.coach ?? {}) },
        realLifeInvited: stored.realLifeInvited === true,
        palIntroduced: stored.palIntroduced === true,
      };
    }
    // Migrate v1 progress (bestScore, wordsHeard, lastPlayedDay, streakDays).
    const legacy = safeParse(kv.getItem(LEGACY_KEY)) as Record<string, unknown> | null;
    if (legacy && typeof legacy === 'object') {
      return {
        ...base,
        bestScore: Number(legacy.bestScore) || 0,
        wordsSeen: Array.isArray(legacy.wordsHeard) ? (legacy.wordsHeard as unknown[]).filter((w): w is string => typeof w === 'string') : [],
        lastPlayedDay: typeof legacy.lastPlayedDay === 'string' ? legacy.lastPlayedDay : '',
        streakDays: Number(legacy.streakDays) || 0,
      };
    }
  } catch {
    // fall through to defaults
  }
  return base;
}

export function saveProfile(kv: KV | null, p: Profile): void {
  if (!kv) return;
  try {
    kv.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Progress is a convenience; never break the session over it.
  }
}

export const BACKUP_KEY = `${PROFILE_KEY}.backup`;

/**
 * Before `?reset` or a `?demo=` seed replaces the profile, keep the learner's real
 * one (never a demo seed) so a shared link cannot wipe real progress.
 */
export function backupProfile(kv: Pick<KV, 'getItem' | 'setItem'>): void {
  try {
    const raw = kv.getItem(PROFILE_KEY);
    const parsed = safeParse(raw) as Partial<Profile> | null;
    if (raw && parsed && typeof parsed === 'object' && !parsed.demo) kv.setItem(BACKUP_KEY, raw);
  } catch {
    // best effort
  }
}

/** `?restore`: put the backed-up real profile back. */
export function restoreProfile(kv: Pick<KV, 'getItem' | 'setItem'>): boolean {
  try {
    const raw = kv.getItem(BACKUP_KEY);
    if (!raw) return false;
    kv.setItem(PROFILE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
