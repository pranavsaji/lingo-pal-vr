/**
 * "Je paie": choose which coins and notes from the dish go on the tray.
 * Exact change when the purse allows it (fewest pieces), otherwise the
 * smallest overpayment. Pure; the purse is at most ~16 pieces, so an
 * exhaustive search over subsets is cheap and exact.
 */

/** The learner's purse for each new order: 22 euros in useful denominations. */
export const WALLET = [1000, 500, 200, 200, 100, 100, 50, 20, 20, 10] as const;

/**
 * Pay by card: at the hotel (a night costs more than any purse of coins), or
 * whenever the bill is more than the coins in the dish can cover.
 */
export function needsCard(place: string, dueCents: number, purseCents: number): boolean {
  return place === 'hotel' || dueCents > purseCents;
}

/** Indexes into `purse` of the pieces to hand over; [] when the purse cannot cover `due`. */
export function pickCoins(purse: readonly number[], due: number): number[] {
  if (due <= 0) return [];
  const n = Math.min(purse.length, 18);
  let best: number[] | null = null;
  let bestOver = Infinity;
  let bestCount = Infinity;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += purse[i];
        count++;
      }
    }
    if (sum < due) continue;
    const over = sum - due;
    if (over < bestOver || (over === bestOver && count < bestCount)) {
      bestOver = over;
      bestCount = count;
      best = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) best.push(i);
    }
  }
  return best ?? [];
}
