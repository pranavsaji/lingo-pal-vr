/**
 * Turn-taking at the counter (pure). The host's game owns it.
 *
 * The shopkeeper serves one learner at a time: the turn holder may order;
 * the other waits ("Un instant !"). When the holder's order is served, the
 * turn passes ("À vous, Sam !"). If the holder goes quiet for a while, the
 * other learner may take the turn by speaking, so nobody gets stuck.
 * Paying is never gated: both can drop coins on the shared tray.
 */

import type { Role } from './protocol.js';

export const TURN_IDLE_MS = 15_000;

export interface TurnRequest {
  ok: boolean;
  /** The turn moved to the requester (the other learner was idle). */
  took: boolean;
}

export class TurnTaker {
  holder: Role = 'host';
  private lastActive = -Infinity;

  constructor(private idleMs = TURN_IDLE_MS) {}

  static other(r: Role): Role {
    return r === 'host' ? 'guest' : 'host';
  }

  /** Start (or restart) with the host's turn. */
  reset(now: number, holder: Role = 'host'): void {
    this.holder = holder;
    this.lastActive = now;
  }

  /** `who` wants to order (speak to the shopkeeper) at `now` (ms). */
  request(who: Role, now: number): TurnRequest {
    if (who === this.holder) {
      this.lastActive = now;
      return { ok: true, took: false };
    }
    if (now - this.lastActive >= this.idleMs) {
      this.holder = who;
      this.lastActive = now;
      return { ok: true, took: true };
    }
    return { ok: false, took: false };
  }

  /** `who`'s order was served. Returns the new holder when the turn passed, else null. */
  served(who: Role, now: number): Role | null {
    if (who !== this.holder) return null;
    this.holder = TurnTaker.other(who);
    this.lastActive = now;
    return this.holder;
  }
}

/** The shopkeeper's line when the turn passes (French + English). */
export function yourTurnLine(name: string): { fr: string; en: string } {
  return { fr: `À vous, ${name} ! Qu'est-ce que je vous sers ?`, en: `Your turn, ${name}! What can I get you?` };
}

export function waitLine(waiting: string, holder: string): { fr: string; en: string } {
  return { fr: `Un instant, ${waiting} ! Je sers ${holder} d'abord.`, en: `One moment, ${waiting}! I'm serving ${holder} first.` };
}

export function welcomeLine(guest: string, host: string): { fr: string; en: string } {
  return {
    fr: `Oh, bonjour ${guest} ! Installez-vous à côté de ${host}. ${host}, vous commencez ?`,
    en: `Oh, hello ${guest}! Sit down next to ${host}. ${host}, will you go first?`,
  };
}
