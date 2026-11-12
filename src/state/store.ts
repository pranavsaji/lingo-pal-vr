/**
 * Single source of truth: the learner profile (persisted) plus this session's
 * order state. Systems read from here and listen to `events`; only this module
 * and the agent executor mutate it. No World, no DOM rendering.
 */

import { events } from '../game-state.js';
import { emptyOrder, type OrderState } from '../agent/tools.js';
import { localDay, type Day } from './dates.js';
import { browserKV, loadProfile, saveProfile, type KV, type Profile, type Settings } from './profile.js';
import { levelFor, newlyUnlocked, touchStreak, unlockedIds, XP, type XpReason } from './progression.js';
import { dueWords, newCard, review, type Grade } from './srs.js';

export interface SessionStats {
  xp: number;
  words: Set<string>;
  orders: number;
  pronunciation: number[];
}

export class Store {
  profile: Profile;
  order: OrderState = emptyOrder();
  session: SessionStats = { xp: 0, words: new Set(), orders: 0, pronunciation: [] };
  readonly today: Day;

  constructor(
    private kv: KV | null,
    today: Day = localDay(),
  ) {
    this.profile = loadProfile(kv);
    this.today = today;
  }

  private save(): void {
    saveProfile(this.kv, this.profile);
    events.profile.emit(this.profile);
  }

  /** Call once per launch: streak, session count, daily ritual XP, unlocks. */
  startSession(): { isNewDay: boolean; broken: boolean; newUnlocks: string[] } {
    const p = this.profile;
    const before = [...p.unlocks];
    const s = touchStreak(p.lastPlayedDay, p.streakDays, this.today);
    p.streakDays = s.streakDays;
    p.lastPlayedDay = s.lastPlayedDay;
    p.sessions += 1;
    if (s.isNewDay && p.sessions > 1) this.award('dailyRitual');
    this.refreshUnlocks();
    const newUnlocks = newlyUnlocked(before, p.unlocks);
    this.save();
    return { isNewDay: s.isNewDay, broken: s.broken, newUnlocks };
  }

  get level() {
    return levelFor(this.profile.xp);
  }

  award(reason: XpReason, times = 1): number {
    return this.addXp(XP[reason] * times);
  }

  /** XP from any source (AI-awarded points are clamped 0 to 20 upstream). */
  addXp(amount: number): number {
    if (!(amount > 0)) return 0;
    const before = levelFor(this.profile.xp).id;
    this.profile.xp += Math.round(amount);
    this.session.xp += Math.round(amount);
    const after = levelFor(this.profile.xp).id;
    events.xp.emit({ amount, total: this.profile.xp, levelUp: before !== after ? after : null });
    this.refreshUnlocks();
    this.save();
    return amount;
  }

  private refreshUnlocks(): string[] {
    const p = this.profile;
    const ids = unlockedIds({ xp: p.xp, streakDays: p.streakDays, orders: p.stats.orders });
    const fresh = newlyUnlocked(p.unlocks, ids);
    if (fresh.length) {
      p.unlocks = [...p.unlocks, ...fresh];
      for (const id of fresh) events.unlocked.emit(id);
    }
    return fresh;
  }

  /** A word was heard (pinched, spoken by Lune). First time: SRS card + XP. */
  hearWord(id: string): boolean {
    this.session.words.add(id);
    if (this.profile.wordsSeen.includes(id)) return false;
    this.profile.wordsSeen.push(id);
    this.profile.srs[id] = newCard(this.today);
    this.award('wordHeard');
    return true;
  }

  reviewWord(id: string, grade: Grade): void {
    const card = this.profile.srs[id] ?? newCard(this.today);
    this.profile.srs[id] = review(card, grade, this.today);
    if (grade >= 2) this.award('reviewCorrect');
    else this.save();
  }

  dueWords(limit = 3): string[] {
    return dueWords(this.profile.srs, this.today, limit);
  }

  /** Weakest words by ease, for the agent prompt. */
  weakWords(limit = 5): string[] {
    return Object.entries(this.profile.srs)
      .sort(([, a], [, b]) => a.ease - b.ease || b.lapses - a.lapses)
      .slice(0, limit)
      .map(([id]) => id);
  }

  remember(key: string, value: string): void {
    if (key === 'name') this.profile.name = value;
    this.profile.memories[key] = value;
    this.save();
  }

  recordPronunciation(score: number): void {
    this.session.pronunciation.push(score);
    this.profile.stats.pronunciationTotal += score;
    this.profile.stats.pronunciationCount += 1;
    this.profile.stats.phrases += 1;
    if (score >= 70) this.award('phraseSpoken');
    else this.save();
  }

  recordOrderPaid(exact: boolean): void {
    this.session.orders += 1;
    this.profile.stats.orders += 1;
    this.profile.stats.payments += 1;
    this.award('orderCompleted');
    this.award('correctPayment', exact ? 1 : 0.5);
  }

  setOrder(next: OrderState): void {
    this.order = next;
    events.order.emit(next);
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.profile.settings[key] = value;
    this.save();
    events.settings.emit(this.profile.settings);
  }

  markOnboarded(): void {
    this.profile.onboarded = true;
    this.save();
  }

  /** "Aujourd'hui : 6 mots, 2 commandes, 92% prononciation." */
  sessionSummary(): { fr: string; en: string } {
    const w = this.session.words.size;
    const o = this.session.orders;
    const pr = this.session.pronunciation;
    const avg = pr.length ? Math.round(pr.reduce((a, b) => a + b, 0) / pr.length) : null;
    const fr = `Aujourd'hui : ${w} mot${w === 1 ? '' : 's'}, ${o} commande${o === 1 ? '' : 's'}${avg !== null ? `, ${avg}% prononciation` : ''}, +${this.session.xp} XP.`;
    const en = `Today: ${w} word${w === 1 ? '' : 's'}, ${o} order${o === 1 ? '' : 's'}${avg !== null ? `, ${avg}% pronunciation` : ''}, +${this.session.xp} XP.`;
    return { fr, en };
  }

  /** Persist a one-line recap the agent reads next time ("she remembers you"). */
  closeVisit(): void {
    const s = this.sessionSummary();
    const fav = this.profile.memories.favorite_order;
    this.profile.lastVisit = `${this.today}: ${s.en}${fav ? ` Ordered ${fav}.` : ''}`;
    this.save();
  }
}

/** App-wide store (browser storage). Tests construct their own Store. */
export const store = new Store(browserKV());
