/**
 * Renders the Passeport de Paris panel, the passport strip on the lesson panel
 * and the goal ladder + tomorrow teaser on the weekly report. Text and colors
 * only (setProperties); called on show and when progress changes, never per frame.
 */

import type { UIKit, UIKitMLAsset } from '@iwsdk/core';
import { nextStamp, STAMPS, stampDate, type StampKind } from '../state/passport.js';
import { daysToNextRest, MAX_REST } from '../state/rest-days.js';
import { store } from '../state/store.js';

const KIND_COLOR: Record<StampKind, string> = { shop: '#c8553d', streak: '#e09f3e', skill: '#2a9d8f' };
const NEXT_TRACK_PX = 480;
const GOAL_TRACK_PX = 496;

type Panel = UIKitMLAsset | undefined;

function text(panel: Panel, id: string, value: string): void {
  panel?.getElementById<UIKit.Text>(id)?.setProperties({ text: value });
}

function style(panel: Panel, id: string, props: Record<string, unknown>): void {
  panel?.getElementById(id)?.setProperties(props as never);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "1 jour de repos" / "2 jours de repos". */
export function restLabel(n: number): string {
  return `${plural(n, 'jour')} de repos`;
}

export function renderPassport(panel: Panel): void {
  if (!panel) return;
  const p = store.profile;
  const f = store.stampFacts();
  const earned = STAMPS.filter((s) => p.passport.stamps[s.id]).length;
  text(panel, 'passport-count', `${earned} / ${STAMPS.length} tampons`);
  const who = p.name ? `${p.name} · ` : '';
  const demo = p.demo ? ' · DEMO: simulated week' : '';
  text(panel, 'passport-owner', `${who}Série : ${p.streakDays} j · Niveau ${store.level.id}${demo}`);

  STAMPS.forEach((s, i) => {
    const day = p.passport.stamps[s.id];
    const id = `st-${i}`;
    text(panel, `${id}-name`, s.fr);
    if (day) {
      const fresh = day === store.today;
      style(panel, id, { backgroundColor: KIND_COLOR[s.kind], borderColor: fresh ? '#f5d90a' : KIND_COLOR[s.kind], borderWidth: fresh ? 4 : 2 });
      style(panel, `${id}-name`, { color: '#ffffff' });
      text(panel, `${id}-sub`, fresh ? `${stampDate(day)} · NOUVEAU` : stampDate(day));
      style(panel, `${id}-sub`, { color: '#fff3d6' });
    } else {
      const pr = s.progress(f);
      style(panel, id, { backgroundColor: '#2b2d33', borderColor: '#4a4c55', borderWidth: 2 });
      style(panel, `${id}-name`, { color: '#9a9da6' });
      text(panel, `${id}-sub`, pr.need > 1 ? `${Math.min(pr.have, pr.need)} / ${pr.need}` : 'à gagner');
      style(panel, `${id}-sub`, { color: '#7d818c' });
    }
  });

  const next = nextStamp(f);
  if (next) {
    text(panel, 'passport-next', `${next.stamp.fr} : ${next.stamp.how} (${next.have} / ${next.need})`);
    style(panel, 'passport-next-fill', { width: Math.max(6, Math.round((NEXT_TRACK_PX * next.have) / next.need)) });
  } else {
    text(panel, 'passport-next', 'Passeport complet ! Bravo. (Passport complete!)');
    style(panel, 'passport-next-fill', { width: NEXT_TRACK_PX });
  }

  const d = daysToNextRest(p.streakDays, p.restDays);
  const more = p.restDays < MAX_REST ? ` · +1 in ${plural(d, 'day')} in a row` : ' (full)';
  text(panel, 'passport-rest', `${restLabel(p.restDays)} / ${MAX_REST}: saves your streak on a missed day${more}`);
}

/** The passport strip on the lesson panel: stamps, streak and rest days at a glance. */
export function renderPassportStrip(lesson: Panel): void {
  if (!lesson) return;
  const p = store.profile;
  const earned = STAMPS.filter((s) => p.passport.stamps[s.id]).length;
  text(lesson, 'passport-title', `PASSEPORT ${earned} / ${STAMPS.length}`);
  text(lesson, 'passport-label', `Série ${p.streakDays} j · ${restLabel(p.restDays)}`);
}

/** Goal ladder (A1 > A2), the rest days on the week chart and tomorrow's teaser. */
export function renderGoals(report: Panel, dayRows: { day: string }[]): void {
  if (!report) return;
  const g = store.ladder();
  text(report, 'goal-title', `OBJECTIF · ${g.label}`);
  text(report, 'goal-next', g.next ? `${g.next.xpToNext} XP to ${g.next.id}` : 'Top level. Bravo !');
  style(report, 'goal-fill', { width: Math.max(7, Math.round(GOAL_TRACK_PX * g.progress)) });
  g.rungs.forEach((r, i) => style(report, `rung-${i}`, { color: r.current ? '#f5d90a' : r.reached ? '#2a9d8f' : '#6c757d' }));
  // Days a rest day covered show as a blue "repos" bar instead of an empty day.
  const rest = store.profile.restUsed;
  dayRows.forEach((row, i) => {
    if (!rest.includes(row.day)) return;
    style(report, `bar-${i}`, { height: 18, backgroundColor: '#457b9d' });
    text(report, `bar-${i}-xp`, 'repos');
  });
  const hook = store.tomorrowHook();
  text(report, 'week-hook', hook.fr);
  text(report, 'week-hook-en', store.profile.settings.subtitles ? hook.en : '');
}
