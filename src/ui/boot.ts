/**
 * Cold-start progress for the landing page (index.html). Real milestones only:
 * the app code ran, the world and its panels exist, the cafe set is built, and
 * Madame Lune is behind the counter. The page eases between them and creeps
 * toward the next one so it never looks frozen, but never passes it.
 *
 * Entering is allowed once the cafe is built and Lune is there (or after a short
 * grace period if her avatar is slow), so the first frame in the headset is the
 * shop with its shopkeeper, never an empty room.
 */

export type BootMark = 'code' | 'world' | 'shop' | 'lune';

/** Progress reached at each milestone, and the label shown while waiting for the next. */
const STAGES: { mark: BootMark; at: number; next: string }[] = [
  { mark: 'code', at: 0.3, next: 'Le café ouvre ses portes…' },
  { mark: 'world', at: 0.6, next: 'On dresse le comptoir…' },
  { mark: 'shop', at: 0.85, next: 'Madame Lune arrive…' },
  { mark: 'lune', at: 1, next: 'Prêt !' },
];

/** Enter anyway this long after the shop is built if Lune's avatar is still streaming. */
export const LUNE_GRACE_S = 5;

export interface BootView {
  /** Real progress, 0..1. */
  progress: number;
  /** The page may creep up to here while waiting. */
  cap: number;
  label: string;
  ready: boolean;
}

export function bootView(marks: ReadonlySet<BootMark>, secondsSinceShop: number): BootView {
  let progress = 0.05;
  let label = 'Chargement…';
  let cap = STAGES[0].at - 0.02;
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    if (!marks.has(s.mark)) break;
    progress = s.at;
    label = s.next;
    cap = i + 1 < STAGES.length ? STAGES[i + 1].at - 0.02 : 1;
  }
  const ready = marks.has('shop') && (marks.has('lune') || secondsSinceShop >= LUNE_GRACE_S);
  if (ready) {
    progress = 1;
    cap = 1;
    label = 'Prêt !';
  }
  return { progress, cap, label, ready };
}
