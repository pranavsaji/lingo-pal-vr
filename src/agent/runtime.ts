/**
 * App-wide agent wiring: the browser store + network transport + vocabulary.
 * Systems import `director` to send events and update perception.
 */

import { store } from '../state/store.js';
import { VOCAB } from '../vocab.js';
import { fetchAgentTurn } from './agent-client.js';
import { AgentDirector } from './director.js';

/** Ids the agent may point at or quiz on: the current shop's words (refreshed on a shop change). */
export const vocabIds = new Set(VOCAB.map((v) => v.id));

export function refreshVocabIds(): void {
  vocabIds.clear();
  for (const v of VOCAB) vocabIds.add(v.id);
}

export const director = new AgentDirector(store, (req, onSlow) => fetchAgentTurn(req, { onSlow }), vocabIds);
