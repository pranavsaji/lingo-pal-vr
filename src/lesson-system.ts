/**
 * Lesson panel: explore mode (pinch anything, hear it) and a 5-step mission
 * ("Trouvez le croissant"). Tracks score, words heard and a daily streak.
 */

import { createSystem, type UIKit, type UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { appState, events } from './game-state.js';
import { UNLOCKS } from './state/progression.js';
import { store } from './state/store.js';
import { applyFrenchFont } from './fonts.js';
import { speakFrench } from './speech.js';
import { MISSIONS, vocabById } from './vocab.js';
import { launchMode } from './world/mixed-reality-system.js';
import { onActivate } from './ui/dwell.js';

type Mode = 'explore' | 'mission' | 'review' | 'done';

export class LessonSystem extends createSystem({}) {
  private mode: Mode = 'explore';
  private missionStep = 0;
  private missionIds: string[] = MISSIONS;
  private stepMistakes = 0;
  private score = 0;
  private lastWord = '';
  private el: Record<string, UIKit.Text | undefined> = {};

  init(): void {
    const session = store.startSession();

    const panel = this.world.getSceneObject<UIKitMLAsset>('lesson-panel');
    if (panel == null) return;
    applyFrenchFont(panel.document.rootElement);
    for (const id of ['score', 'eyebrow', 'word', 'english', 'tip', 'start-label', 'header', 'xr-label']) {
      this.el[id] = panel.getElementById<UIKit.Text>(id) ?? undefined;
    }
    const start = panel.getElementById('start-button');
    const repeat = panel.getElementById('repeat-button');
    const xrButton = panel.getElementById('xr-button');
    const exitButton = panel.getElementById('exit-button');

    const onStart = () => this.startMission();
    const onRepeat = () => {
      if (this.lastWord) speakFrench(this.lastWord, 0.75);
    };
    if (start) this.cleanupFuncs.push(onActivate(start, onStart));
    if (repeat) this.cleanupFuncs.push(onActivate(repeat, onRepeat));
    this.cleanupFuncs.push(
      events.itemPicked.on((id) => this.onItemPicked(id)),
      events.points.on((n) => this.addPoints(n)),
      events.xp.on(({ levelUp }) => {
        this.renderScore();
        if (levelUp) this.celebrate(`NIVEAU ${levelUp} !`, `Level up: ${levelUp}`);
      }),
      events.review.on((ids) => this.startMission(ids, 'review')),
      events.effects.on((fx) => {
        if (fx.some((e) => e.kind === 'goodbye')) this.showSummary();
      }),
      events.unlocked.on((id) => {
        const u = UNLOCKS.find((x) => x.id === id);
        if (u) this.celebrate(`NOUVEAU : ${u.fr}`, `Unlocked: ${u.en}`);
      }),
    );

    // Enter / exit VR buttons only make sense when XR is available.
    if (xrButton && exitButton) {
      if (!this.world.xrEnabled) {
        xrButton.setProperties({ display: 'none' });
        exitButton.setProperties({ display: 'none' });
      } else {
        // "Paris (VR)": the full virtual shop. "Ma pièce (MR)" (MixedRealitySystem) is the passthrough choice.
        const launch = () => launchMode(this.world, false);
        const exit = () => this.world.exitXR();
        xrButton.addEventListener('click', launch);
        exitButton.addEventListener('click', exit);
        this.cleanupFuncs.push(
          () => xrButton.removeEventListener('click', launch),
          () => exitButton.removeEventListener('click', exit),
          this.world.visibilityState.subscribe((state) => {
            const is2D = state === VisibilityState.NonImmersive;
            xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
            exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
          }),
        );
      }
    }

    const streak = store.profile.streakDays;
    const due = store.dueWords().length;
    this.set(
      'tip',
      `Streak: ${streak} day${streak === 1 ? '' : 's'}${session.broken ? ' (new start!)' : ''}.` +
        (due ? ` ${due} word${due === 1 ? '' : 's'} to review today.` : ' Point your hand at an object, then pinch.'),
    );
    this.renderScore();
  }

  private set(id: string, text: string): void {
    this.el[id]?.setProperties({ text });
  }

  /** "A1.2  ·  180 XP  ·  3j" (j = jours, days of streak). */
  private renderScore(): void {
    const lvl = store.level;
    this.set('score', `${lvl.id}  ·  ${store.profile.xp} XP  ·  ${store.profile.streakDays}j`);
  }

  /** Mission points also count as XP; the agent adds its own XP via the director. */
  private addPoints(n: number): void {
    if (n <= 0) return;
    this.score += n;
    if (this.score > store.profile.bestScore) store.profile.bestScore = this.score;
    store.addXp(n);
  }

  private celebrate(fr: string, en: string): void {
    this.set('eyebrow', fr);
    this.set('english', en);
    this.flashHeader('#f4a261');
  }

  private flashHeader(color: string): void {
    this.el.header?.setProperties({ backgroundColor: color });
    setTimeout(() => this.el.header?.setProperties({ backgroundColor: '#1d3557' }), 900);
  }

  private startMission(ids: string[] = MISSIONS, mode: 'mission' | 'review' = 'mission'): void {
    this.mode = mode;
    appState.lessonActive = true;
    this.missionIds = ids;
    this.missionStep = 0;
    this.stepMistakes = 0;
    this.set('start-label', 'Recommencer');
    this.showMissionPrompt();
  }

  private showMissionPrompt(): void {
    const target = vocabById(this.missionIds[this.missionStep]);
    if (!target) return;
    this.stepMistakes = 0;
    const review = this.mode === 'review';
    // Review: no glowing ring at first, so recall is real; the ring appears after a mistake.
    events.missionTarget.emit(review ? '' : target.id);
    this.set('eyebrow', `${review ? 'RÉVISION' : 'MISSION'} ${this.missionStep + 1} / ${this.missionIds.length}`);
    this.set('word', `Trouvez ${target.fr}`);
    this.set('english', review ? 'From memory: which object is it?' : `Find ${target.en}. Look for the glowing ring.`);
    this.set('tip', 'Listen, then pinch the right object.');
    speakFrench(`Trouvez ${target.fr}`);
  }

  /** "A demain" from Madame Lune: show today's recap (Reason to come back). */
  private showSummary(): void {
    const s = store.sessionSummary();
    const hook = store.tomorrowHook(); // "Demain : deux baguettes à la boulangerie ? Encore 40 XP pour la terrasse."
    this.set('eyebrow', 'À DEMAIN !');
    this.set('word', `${store.profile.streakDays} jour${store.profile.streakDays === 1 ? '' : 's'} de suite`);
    this.set('english', `${s.en} ${hook.en}`);
    this.set('tip', hook.fr);
    this.flashHeader('#2a9d8f');
  }

  private onItemPicked(id: string): void {
    const entry = vocabById(id);
    if (!entry) return;
    this.lastWord = entry.fr;
    speakFrench(entry.fr);

    store.hearWord(id); // first time: SRS card + XP

    if (this.mode !== 'mission' && this.mode !== 'review') {
      this.set('eyebrow', `VOCABULAIRE  ${store.profile.wordsSeen.length} / 12 mots`);
      this.set('word', entry.fr);
      this.set('english', entry.en);
      this.set('tip', entry.tip);
      return;
    }

    const targetId = this.missionIds[this.missionStep];
    if (id === targetId) {
      const review = this.mode === 'review';
      if (review) store.reviewWord(id, this.stepMistakes === 0 ? 2 : 1);
      this.addPoints(10);
      this.flashHeader('#2a9d8f');
      this.missionStep += 1;
      if (this.missionStep >= this.missionIds.length) {
        this.mode = 'done';
        appState.lessonActive = false;
        events.missionTarget.emit('');
        this.set('eyebrow', review ? 'RÉVISION TERMINÉE !' : 'MISSION ACCOMPLIE !');
        this.set('word', 'Bravo !');
        this.set('english', 'Now order something from Madame Lune on your right.');
        this.set('tip', `Score: ${this.score}. Best: ${store.profile.bestScore}. Come back tomorrow to grow your streak.`);
        setTimeout(() => speakFrench('Bravo ! Mission accomplie !'), 700);
        return;
      }
      this.set('tip', `Oui ! ${entry.fr} = ${entry.en}.`);
      setTimeout(() => this.showMissionPrompt(), 1200);
    } else {
      this.flashHeader('#e63946');
      this.stepMistakes += 1;
      if (this.mode === 'review') events.missionTarget.emit(targetId); // now show the hint ring
      const target = vocabById(targetId);
      this.set('tip', `Non, ça c'est ${entry.fr}. On cherche ${target?.fr ?? ''}.`);
    }
  }
}
