/**
 * Madame Lune chat panel. Renders every agent turn, whatever caused it
 * (pinched reply, voice, fingers + gaze, gesture, coins on the tray).
 * Pinch a reply to say it; pinch an object to show it to her. While paying,
 * the replies become money (an accessible alternative to grabbing coins).
 */

import { createSystem, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { aiStatus } from './agent/agent-client.js';
import { menuItem, PLACES, priceToDigits, priceToFrench } from './agent/menu.js';
import type { AgentTurn, ReplyOption } from './agent/protocol.js';
import { director } from './agent/runtime.js';
import { orderTotal } from './agent/tools.js';
import { appState, events } from './game-state.js';
import { applyFrenchFont } from './fonts.js';
import { prefetchFrench, speakFrench } from './speech.js';
import { store } from './state/store.js';
import { onActivate } from './ui/dwell.js';

interface Choice extends ReplyOption {
  /** When set, choosing this pays this many cents instead of speaking. */
  payCents?: number;
}

/** Job title under each shopkeeper's name on the chat panel. */
const KEEPER_ROLE = { cafe: 'la serveuse', boulangerie: 'le boulanger', marche: 'la marchande' } as const;

export class ChatSystem extends createSystem({}) {
  private choices: Choice[] = [];
  private pending = 0; // turns in flight
  private firstTurn = true;
  private el: Record<string, UIKit.Text | undefined> = {};

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('chat-panel');
    if (panel == null) return;
    applyFrenchFont(panel.document.rootElement);
    for (const id of ['keeper-name', 'status', 'npc-line', 'npc-en', 'label', 'opt-0-fr', 'opt-0-en', 'opt-1-fr', 'opt-1-en', 'opt-2-fr', 'opt-2-en']) {
      this.el[id] = panel.getElementById<UIKit.Text>(id) ?? undefined;
    }

    for (let i = 0; i < 3; i++) {
      const option = panel.getElementById(`opt-${i}`);
      if (option) this.cleanupFuncs.push(onActivate(option, () => this.choose(i)));
    }

    director.onSlow = () => {
      this.set('status', 'Alors... (réfléchit)');
      events.effects.emit([{ kind: 'emote', emote: 'think' }]);
    };

    this.cleanupFuncs.push(
      events.turn.on((turn) => this.onTurn(turn)),
      // Showing an object to Madame Lune (not during a lesson, where pinches are answers).
      events.itemPicked.on((id) => {
        if (this.pending === 0 && !appState.lessonActive && menuItem(id)) this.track(director.handle({ kind: 'show', itemId: id }));
      }),
      events.order.on(() => this.renderStatus()),
      events.place.on((place) => {
        const k = PLACES[place].shopkeeper;
        this.set('keeper-name', `${k.name}, ${KEEPER_ROLE[place]}`);
      }),
      events.settings.on(() => this.set('npc-en', store.profile.settings.subtitles ? this.lastEn : '')),
      events.agentNote.on((note) => this.showNote(note)),
      () => {
        if (this.noteTimer) clearTimeout(this.noteTimer);
      },
    );
    this.noteEl = panel.getElementById<UIKit.Text>('agent-note') ?? undefined;

    // First launch: the tutorial speaks first and triggers the greeting when it ends.
    if (store.profile.onboarded) this.track(director.handle({ kind: 'arrive' }));
  }

  private lastEn = '';
  private noteEl: UIKit.Text | undefined;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  /** The shopkeeper's visible reasoning: one short line, gone after a few seconds. */
  private showNote(note: string): void {
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteEl?.setProperties({ text: note, display: note ? 'flex' : 'none' });
    this.noteTimer = note ? setTimeout(() => this.noteEl?.setProperties({ display: 'none' }), 12000) : null;
  }

  private track(p: Promise<unknown> | null): void {
    if (!p) return;
    this.pending++;
    void p.finally(() => {
      this.pending = Math.max(0, this.pending - 1);
    });
  }

  private set(id: string, text: string): void {
    this.el[id]?.setProperties({ text });
  }

  private onTurn(turn: AgentTurn): void {
    this.render(turn);
    appState.lastLuneLine = turn.fr;
    const delay = this.firstTurn ? 0 : 500;
    this.firstTurn = false;
    setTimeout(() => speakFrench(turn.fr, undefined, 'lune'), delay);
  }

  private renderStatus(): void {
    const o = store.order;
    const ai = aiStatus() === 'offline' ? 'hors ligne' : 'IA';
    if (o.lines.length === 0) {
      this.set('status', ai);
      return;
    }
    const total = priceToDigits(orderTotal(o.lines));
    const label = o.phase === 'paid' ? 'payé' : o.phase === 'paying' ? 'à payer' : 'commande';
    this.set('status', `${label} ${total}  ·  ${ai}`);
  }

  /** While paying, offer money as replies too (gaze-only and voice-only learners). */
  private paymentChoices(): Choice[] {
    const due = orderTotal(store.order.lines) - store.order.trayCents;
    const note = due <= 500 ? 500 : 1000;
    return [
      { fr: `Voilà ${priceToFrench(note)}.`, en: `Hand over a ${note / 100} euro note.`, payCents: note },
      { fr: 'Voilà deux euros.', en: 'Hand over a 2 euro coin.', payCents: 200 },
      { fr: "Voilà, c'est juste.", en: `Pay the exact amount (${priceToDigits(due)}).`, payCents: due },
    ];
  }

  private render(turn: AgentTurn): void {
    this.lastEn = turn.en;
    this.set('npc-line', turn.fr);
    this.set('npc-en', store.profile.settings.subtitles ? turn.en : '');
    const paying = store.order.phase === 'paying';
    this.choices = paying ? this.paymentChoices() : turn.replies;
    appState.replies = this.choices;
    this.set('label', paying ? 'PAYEZ : PIÈCES SUR LE PLATEAU, OU PINCEZ' : 'PINCEZ OU DITES UNE RÉPONSE');
    this.choices.forEach((o, i) => {
      this.set(`opt-${i}-fr`, o.fr);
      this.set(`opt-${i}-en`, o.en);
      // Fetch the learner-voice audio of each reply while Madame Lune talks: pinching one plays instantly.
      setTimeout(() => prefetchFrench(o.fr, 'learner'), 1200 + i * 300);
    });
    this.renderStatus();
  }

  private choose(i: number): void {
    const c = this.choices[i];
    if (!c || this.pending > 0) return;
    if (appState.interceptReply?.(c.fr)) return; // e.g. the first-launch input choice
    speakFrench(c.fr, undefined, 'learner'); // the learner's own reply, in the learner's voice
    if (c.payCents !== undefined) {
      this.track(director.pay(c.payCents, true));
      return;
    }
    this.track(director.handle({ kind: 'say', text: c.fr, fingers: 0 }));
  }
}
