/**
 * La liste de courses (daily shopping list across Paris) and learning-time
 * tracking for the weekly report.
 *
 * - Shows today's list on the home panel: one thing to buy in each shop.
 * - When an order is paid, ticks off what it satisfies in that shop; the full
 *   list pays a bonus once (store.questPaid), with a chime and confetti.
 * - Counts time spent (in the headset or with the page visible) per day.
 * The shopkeeper knows what is on the list in their shop (director prompt).
 */

import { createSystem, type UIKit, type UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { PLACES, quantityPhrase } from '../agent/menu.js';
import type { OrderState } from '../agent/tools.js';
import { appState, events } from '../game-state.js';
import { pendingHere, type Quest } from '../state/quest.js';
import { store } from '../state/store.js';

const SAVE_EVERY_S = 30;

/** "2 croissants" for a task, in its shop's words. */
export function taskPhrase(t: Quest['tasks'][number]): string {
  const item = PLACES[t.place].menu.find((m) => m.id === t.itemId);
  return item ? quantityPhrase(item, t.qty) : t.itemId;
}

/** What the shopkeeper should know about the list here, e.g. "2 croissant" (empty when nothing). */
export function shoppingListHere(): string {
  const t = pendingHere(store.profile.quest, appState.place);
  return t ? `${t.qty} ${t.itemId}` : '';
}

export class QuestSystem extends createSystem({}) {
  private el: Record<string, UIKit.Text | undefined> = {};
  private lastPhase = '';
  private pending = 0;

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('lesson-panel');
    if (panel) for (const id of ['quest-title', 'quest-0', 'quest-1', 'quest-2']) this.el[id] = panel.getElementById<UIKit.Text>(id) ?? undefined;
    store.questToday();
    this.render();
    this.cleanupFuncs.push(
      events.order.on((o) => this.onOrder(o)),
      events.place.on(() => this.render()),
      () => this.flush(),
    );
  }

  private onOrder(o: OrderState): void {
    const paidNow = o.phase === 'paid' && this.lastPhase !== 'paid';
    this.lastPhase = o.phase;
    if (!paidNow) return;
    const { fresh, completed } = store.questPaid(appState.place, o.lines);
    if (!fresh.length) return;
    const q = store.questToday();
    const done = q.tasks.filter((t) => t.done).length;
    events.questProgress.emit({ done, total: q.tasks.length, completed, label: taskPhrase(fresh[0]) });
    if (completed) events.celebrate.emit();
    this.render();
  }

  private render(): void {
    const q = store.questToday();
    const done = q.tasks.filter((t) => t.done).length;
    const allDone = done === q.tasks.length;
    this.el['quest-title']?.setProperties({
      text: allDone ? `LISTE DE COURSES · TERMINÉE ! +60 XP` : `LISTE DE COURSES · ${done} / ${q.tasks.length}`,
    });
    q.tasks.forEach((t, i) => {
      const here = t.place === appState.place;
      const mark = t.done ? 'OK' : here ? '>' : '·';
      this.el[`quest-${i}`]?.setProperties({
        text: `${mark}  ${PLACES[t.place].fr} : ${taskPhrase(t)}`,
        color: t.done ? '#2a9d8f' : here ? '#f4a261' : undefined,
      } as never);
    });
  }

  private flush(): void {
    if (this.pending >= 1) store.addTime(Math.round(this.pending));
    this.pending = 0;
  }

  update(delta: number): void {
    // Count learning time while immersed, or while the 2D page is visible.
    const active = this.world.visibilityState.peek() === VisibilityState.Visible || (typeof document !== 'undefined' && document.visibilityState === 'visible');
    if (!active || delta <= 0 || delta > 1) return;
    this.pending += delta;
    if (this.pending >= SAVE_EVERY_S) this.flush();
  }
}
