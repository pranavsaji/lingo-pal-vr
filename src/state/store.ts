/**
 * Single source of truth: the learner profile (persisted) plus this session's
 * order state. Systems read from here and listen to `events`; only this module
 * and the agent executor mutate it. No World, no DOM rendering.
 */

import { logFor, weekReport, type WeekReport } from './history.js';
import { applyPaidOrder, dailyQuest, QUEST_XP, questComplete, type Quest, type QuestTask } from './quest.js';
import type { PlaceId } from '../game-state.js';
import { appState, events } from '../game-state.js';
import { emptyOrder, type OrderState } from '../agent/tools.js';
import { localDay, type Day } from './dates.js';
import { browserKV, loadProfile, saveProfile, type KV, type Profile, type Settings } from './profile.js';
import { levelFor, newlyUnlocked, unlockedIds, XP, type XpReason } from './progression.js';
import { dueWords, newCard, review, type Grade } from './srs.js';
import { collectStamps, notePurchase, type StampFacts } from './passport.js';
import { touchStreakWithRest } from './rest-days.js';
import { withDemoSeed } from './demo.js';
import { goalLadder, returnMoment, tomorrowHook, type GoalLadder, type Line, type ReturnMoment } from './goals.js';

/** What changed at the start of this visit (for the "Bon retour !" moment). */
export interface Arrival {
  isNewDay: boolean;
  broken: boolean;
  newUnlocks: string[];
  newStamps: string[];
  restUsed: string[];
  restEarned: boolean;
  moment: ReturnMoment | null;
}
import { easeMistake, recordMistake, topMistakes, type Mistake, type MistakeKind } from './mistakes.js';
import { planTomorrow, type TomorrowPlan } from './plan.js';

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
  /** Set by startSession: what changed since the last visit. */
  arrival: Arrival | null = null;

  constructor(
    private kv: KV | null,
    today: Day = localDay(),
  ) {
    this.profile = loadProfile(kv);
    this.today = today;
  }

  private save(): void {
    // Any progress can earn a passport stamp: collect them on every save.
    const stamps = collectStamps(this.stampFacts(), this.today);
    if (stamps.length) this.refreshUnlocks(); // stamps can open decor (the stamp board)
    saveProfile(this.kv, this.profile);
    events.profile.emit(this.profile);
    for (const id of stamps) events.stamp.emit(id);
  }

  /** Call once per launch: streak (with rest days), session count, daily ritual XP, unlocks, stamps. */
  startSession(): { isNewDay: boolean; broken: boolean; newUnlocks: string[] } {
    const p = this.profile;
    const before = [...p.unlocks];
    const stampsBefore = Object.keys(p.passport.stamps);
    const s = touchStreakWithRest(p.lastPlayedDay, p.streakDays, p.restDays, this.today);
    p.streakDays = s.streakDays;
    p.lastPlayedDay = s.lastPlayedDay;
    p.restDays = s.restDays;
    if (s.restUsed.length) p.restUsed = [...p.restUsed, ...s.restUsed].slice(-14);
    p.sessions += 1;
    if (s.isNewDay && p.sessions > 1) this.award('dailyRitual');
    this.refreshUnlocks();
    this.save();
    const newUnlocks = newlyUnlocked(before, p.unlocks);
    const newStamps = Object.keys(p.passport.stamps).filter((id) => !stampsBefore.includes(id));
    const moment = returnMoment({
      name: p.name,
      onboarded: p.onboarded,
      sessions: p.sessions,
      isNewDay: s.isNewDay,
      broken: s.broken,
      streakDays: p.streakDays,
      restUsed: s.restUsed,
      restEarned: s.restEarned,
      newStamps,
      newUnlocks,
      due: dueWords(p.srs, this.today, 99).length,
    });
    this.arrival = { isNewDay: s.isNewDay, broken: s.broken, newUnlocks, newStamps, restUsed: s.restUsed, restEarned: s.restEarned, moment };
    return { isNewDay: s.isNewDay, broken: s.broken, newUnlocks };
  }

  /** Inputs for the passport stamps (live view over the profile). */
  stampFacts(): StampFacts {
    const p = this.profile;
    return { passport: p.passport, streakDays: p.streakDays, wordsSeen: p.wordsSeen.length, xp: p.xp };
  }

  /** A1 -> A2 goal ladder. */
  ladder(): GoalLadder {
    return goalLadder(this.profile.xp);
  }

  /** Tomorrow's teaser: an item from tomorrow's list and the nearest unlock. */
  tomorrowHook(): Line {
    const p = this.profile;
    const plan = p.coach.plan;
    const focusWords = plan && plan.day > this.today && plan.focusWords.length ? plan.focusWords : undefined;
    return tomorrowHook({ xp: p.xp, streakDays: p.streakDays, orders: p.stats.orders, unlocks: p.unlocks, passport: p.passport, today: this.today, focusWords });
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
    logFor(this.profile.history, this.today).xp += Math.round(amount);
    this.session.xp += Math.round(amount);
    const after = levelFor(this.profile.xp).id;
    events.xp.emit({ amount, total: this.profile.xp, levelUp: before !== after ? after : null });
    this.refreshUnlocks();
    this.save();
    return amount;
  }

  private refreshUnlocks(): string[] {
    const p = this.profile;
    const ids = unlockedIds({ xp: p.xp, streakDays: p.streakDays, orders: p.stats.orders, stamps: Object.keys(p.passport.stamps).length, placeOrders: p.passport.placeOrders });
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
    logFor(this.profile.history, this.today).newWords += 1;
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
    const log = logFor(this.profile.history, this.today);
    log.pronSum += score;
    log.pronCount += 1;
    this.profile.stats.phrases += 1;
    this.profile.passport.bestPron = Math.max(this.profile.passport.bestPron, Math.round(score));
    if (score >= 70) this.award('phraseSpoken');
    else this.save();
  }

  recordOrderPaid(exact: boolean): void {
    notePurchase(this.profile.passport, appState.place, this.order.lines, exact); // passport counters (shop, croissant, change)
    this.session.orders += 1;
    this.profile.stats.orders += 1;
    this.profile.stats.payments += 1;
    logFor(this.profile.history, this.today).orders += 1;
    this.award('orderCompleted');
    this.award('correctPayment', exact ? 1 : 0.5);
  }

  /** Time spent learning (called every ~30 s, not per frame). */
  addTime(seconds: number): void {
    if (!(seconds > 0)) return;
    logFor(this.profile.history, this.today).seconds += seconds;
    this.save();
  }

  weekReport(): WeekReport {
    return weekReport(this.profile.history, this.today);
  }

  /** Today's shopping list (a new one each day). */
  questToday(): Quest {
    if (!this.profile.quest || this.profile.quest.day !== this.today) {
      this.profile.quest = dailyQuest(this.today, this.plannedFocus());
      this.save();
    }
    return this.profile.quest;
  }

  /** An order was paid in `place`: tick the list; the full list pays a bonus once. */
  questPaid(place: PlaceId, lines: { itemId: string; qty: number }[]): { fresh: QuestTask[]; completed: boolean } {
    const quest = this.questToday();
    const fresh = applyPaidOrder(quest, place, lines);
    let completed = false;
    if (fresh.length && questComplete(quest) && !quest.rewarded) {
      quest.rewarded = true;
      completed = true;
      this.profile.passport.listsDone += 1;
      this.addXp(QUEST_XP);
    } else if (fresh.length) this.save();
    return { fresh, completed };
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

  // ---- Coach memory: mistakes, tomorrow's plan, change tests --------------------

  /** Mistakes recorded this session (the change test waits for a learner doing well). */
  sessionMistakes = 0;

  /** Focus words planned yesterday for today's shopping list (undefined when none). */
  plannedFocus(): string[] | undefined {
    const plan = this.profile.coach.plan;
    return plan && plan.day === this.today && plan.focusWords.length ? plan.focusWords : undefined;
  }

  recordMistake(kind: MistakeKind, want: string, got: string): void {
    this.sessionMistakes += 1;
    recordMistake(this.profile.coach.mistakes, { kind, want, got }, this.today);
    this.save();
  }

  /** The learner got `want` right: its mistakes fade. */
  easeMistake(want: string): void {
    if (!this.profile.coach.mistakes.some((m) => m.want === want)) return;
    easeMistake(this.profile.coach.mistakes, want);
    this.save();
  }

  topMistakes(n = 3): Mistake[] {
    return topMistakes(this.profile.coach.mistakes, n);
  }

  /** Tomorrow's plan from the weakest words and mistakes (pure; saved by savePlan). */
  planTomorrow(idForNoun?: (noun: string) => string | undefined, bought: Iterable<string> = []): TomorrowPlan | null {
    const seenToday = [...this.session.words, ...bought];
    return planTomorrow({ today: this.today, srs: this.profile.srs, mistakes: this.profile.coach.mistakes, seenToday, idForNoun });
  }

  savePlan(plan: TomorrowPlan | null): void {
    if (!plan) return;
    this.profile.coach.plan = plan;
    this.save();
  }

  recordTrick(caught: boolean): void {
    this.profile.coach.tricks += 1;
    if (caught) this.profile.coach.caught += 1;
    this.save();
  }
}

/** App-wide store (browser storage). Tests construct their own Store. */
export const store = new Store(withDemoSeed(browserKV(), localDay())); // ?demo=week seeds a simulated week (src/state/demo.ts)
