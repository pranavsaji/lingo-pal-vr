/**
 * Background customers: two other people in every shop, so the learner is not alone
 * with the shopkeeper. They are ambience only (no interaction, no speech), stand or
 * sit well outside the learner's reach, and are placed beyond the panels' and the
 * counter's sight lines (every one is at least ~45 degrees off the learner's
 * straight-ahead view and 1.8 m away).
 *
 * Avatars: Microsoft Rocketbox (MIT), converted to public/models/characters/*.glb
 * like the shopkeepers, with a lighter texture set (no body normal map).
 */

import type { PlaceId } from '../../game-state.js';

export type Posture = 'seated' | 'standing';
/**
 * What they do while idling: `sip` (seated, coffee in hand), `linger` (seated, looks
 * around, chin on hand now and then), `browse` (standing, studies the goods),
 * `wait` (standing, waits their turn and checks the time).
 */
export type Activity = 'sip' | 'linger' | 'browse' | 'wait';

export interface CustomerSpec {
  /** Manifest id in src/assets.ts. */
  assetId: string;
  /** Scene-graph name. */
  name: string;
  /** Rocketbox source avatar (for credits). */
  source: string;
  /** Feet (standing) or hip joints (seated) on the floor plan, metres. */
  pos: readonly [number, number];
  /** Facing: rotation about +Y; 0 faces +Z (toward the learner), PI faces the counter. */
  yaw: number;
  posture: Posture;
  activity: Activity;
  /** Seat top height (seated only), metres. */
  seat?: number;
  /** Centre of their bistro table (seated only): a coffee sits on it. */
  table?: readonly [number, number];
  /** Behaviour seed, so two customers never move in step. */
  seed: number;
}

/** Height of the cafe chairs' seat (painted_wooden_chair_01). */
export const CHAIR_SEAT = 0.46;

/** Top of the bistro tables (shop-set.ts: 0.03 m top centred at 0.75 m). */
export const TABLE_TOP = 0.765;

/** Eye height used for a customer's gaze maths (m). */
export function customerEyeHeight(posture: Posture): number {
  return posture === 'seated' ? 1.22 : 1.62;
}

/** Hip joints above the seat surface when seated (m). */
export const SEAT_HIP = 0.1;

/** Root height for a customer: 0 standing; seated, lowered so the hips rest on the seat. */
export function customerRootY(spec: Pick<CustomerSpec, 'posture' | 'seat'>, hipHeight: number): number {
  return spec.posture === 'seated' ? (spec.seat ?? CHAIR_SEAT) + SEAT_HIP - hipHeight : 0;
}

/** Facing yaw for a person at (x, z) looking at (tx, tz). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

export const CUSTOMERS: Record<PlaceId, CustomerSpec[]> = {
  // Cafe: one at each side table, on the chairs from places.ts (rotY +-1.9), facing their table.
  cafe: [
    {
      assetId: 'customer-m03', name: 'Customer (cafe, right table)', source: 'Male_Adult_03',
      pos: [1.8, -0.41], yaw: -1.9, posture: 'seated', activity: 'sip', seat: CHAIR_SEAT, table: [1.2, -0.6], seed: 31,
    },
    {
      assetId: 'customer-f14', name: 'Customer (cafe, left table)', source: 'Female_Adult_14',
      pos: [-1.84, -0.41], yaw: 1.9, posture: 'seated', activity: 'linger', seat: CHAIR_SEAT, table: [-1.25, -0.62], seed: 57,
    },
  ],
  // Bakery: one browsing the bread at the back-left, one waiting her turn on the right.
  boulangerie: [
    {
      assetId: 'customer-m08', name: 'Customer (bakery, browsing)', source: 'Male_Adult_08',
      pos: [-2.05, -1.85], yaw: yawToward(-2.05, -1.85, -0.9, -2.35), posture: 'standing', activity: 'browse', seed: 73,
    },
    {
      assetId: 'customer-f09', name: 'Customer (bakery, waiting)', source: 'Female_Adult_09',
      pos: [2.0, -1.5], yaw: yawToward(2.0, -1.5, 0.4, -0.9), posture: 'standing', activity: 'wait', seed: 91,
    },
  ],
  // Market: two shoppers at the crates, on the far side of each.
  marche: [
    {
      assetId: 'customer-m12', name: 'Customer (market, left crates)', source: 'Male_Adult_12',
      pos: [-1.75, -1.5], yaw: yawToward(-1.75, -1.5, -1.0, -1.6), posture: 'standing', activity: 'browse', seed: 17,
    },
    {
      assetId: 'customer-f07', name: 'Customer (market, right crates)', source: 'Female_Adult_07',
      pos: [1.85, -1.3], yaw: yawToward(1.85, -1.3, 1.05, -1.6), posture: 'standing', activity: 'browse', seed: 43,
    },
  ],
  // The regulars come along to the newer shops (same six people, never in step).
  // Bistrot: lunch at the two side tables, on the chairs from places.ts.
  bistrot: [
    {
      assetId: 'customer-m12', name: 'Customer (bistro, right table)', source: 'Male_Adult_12',
      pos: [1.8, -0.41], yaw: -1.9, posture: 'seated', activity: 'sip', seat: CHAIR_SEAT, table: [1.2, -0.6], seed: 61,
    },
    {
      assetId: 'customer-f09', name: 'Customer (bistro, left table)', source: 'Female_Adult_09',
      pos: [-1.84, -0.41], yaw: 1.9, posture: 'seated', activity: 'linger', seat: CHAIR_SEAT, table: [-1.25, -0.62], seed: 83,
    },
  ],
  // Metro: one waits for the window, one reads the network poster.
  metro: [
    {
      assetId: 'customer-m08', name: 'Customer (metro, waiting)', source: 'Male_Adult_08',
      pos: [2.0, -1.5], yaw: yawToward(2.0, -1.5, 0.4, -0.9), posture: 'standing', activity: 'wait', seed: 29,
    },
    {
      assetId: 'customer-f07', name: 'Customer (metro, poster)', source: 'Female_Adult_07',
      // Reading the Plan du métro on the pillar left of the window (map-props-system POSTER_PILLAR).
      pos: [-2.05, -0.3], yaw: yawToward(-2.05, -0.3, -1.69, -0.86), posture: 'standing', activity: 'browse', seed: 47,
    },
  ],
  // Pharmacy: one studies the shelves, one waits their turn.
  pharmacie: [
    {
      assetId: 'customer-f14', name: 'Customer (pharmacy, shelves)', source: 'Female_Adult_14',
      pos: [-2.05, -1.85], yaw: yawToward(-2.05, -1.85, -1.0, -2.42), posture: 'standing', activity: 'browse', seed: 53,
    },
    {
      assetId: 'customer-m03', name: 'Customer (pharmacy, waiting)', source: 'Male_Adult_03',
      pos: [2.0, -1.5], yaw: yawToward(2.0, -1.5, 0.4, -0.9), posture: 'standing', activity: 'wait', seed: 37,
    },
  ],
  // Hotel: a guest waits to check in, another reads the key board.
  hotel: [
    {
      assetId: 'customer-f09', name: 'Customer (hotel, waiting)', source: 'Female_Adult_09',
      pos: [2.0, -1.5], yaw: yawToward(2.0, -1.5, 0.4, -0.9), posture: 'standing', activity: 'wait', seed: 19,
    },
    {
      assetId: 'customer-m12', name: 'Customer (hotel, key board)', source: 'Male_Adult_12',
      pos: [-2.05, -1.85], yaw: yawToward(-2.05, -1.85, -0.85, -2.42), posture: 'standing', activity: 'browse', seed: 67,
    },
  ],
};

/** Café à deux seats (src/social/protocol.ts SEAT_LEFT / SEAT_RIGHT: x ±0.95, z -0.62). */
export function nearFriendSeat(x: number, z: number): boolean {
  return Math.hypot(Math.abs(x) - 0.95, z + 0.62) < 1.0;
}

/** Café à deux: who the friend appears as (a person not already among this shop's customers). */
export const FRIEND_MODELS = ['customer-m08', 'customer-f07', 'customer-m03', 'customer-f09'] as const;

export function friendModelFor(place: PlaceId): string {
  const used = new Set(CUSTOMERS[place].map((c) => c.assetId));
  return FRIEND_MODELS.find((id) => !used.has(id)) ?? FRIEND_MODELS[0];
}
