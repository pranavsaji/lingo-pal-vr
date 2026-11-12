/**
 * App-wide agent wiring: the browser store + network transport + vocabulary.
 * Systems import `director` to send events and update perception.
 */

import { store } from '../state/store.js';
import { VOCAB } from '../vocab.js';
import { fetchAgentTurn } from './agent-client.js';
import { AgentDirector } from './director.js';

export const director = new AgentDirector(
  store,
  (req, onSlow) => fetchAgentTurn(req, { onSlow }),
  new Set(VOCAB.map((v) => v.id)),
);
