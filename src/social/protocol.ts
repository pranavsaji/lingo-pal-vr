/**
 * "Café à deux" wire protocol (pure: no World, no DOM, no network).
 *
 *  - Room codes and share links.
 *  - Seats: each learner sits at their own origin; the friend is drawn at a
 *    counter-end seat (host sees the guest on the right, the guest sees the
 *    host on the left), so both stay centered on the counter like solo play.
 *  - Poses: a compact binary packet (head + 25 joints per hand, or a 2D
 *    pointer) sent ~15 times a second.
 *  - Messages: small JSON objects, validated on receipt (the peer is untrusted).
 */

import type { AgentEvent, AgentTurn, ReplyOption } from '../agent/protocol.js';
import { EMOTES, type Effect, type OrderPhase, type OrderState } from '../agent/tools.js';
import type { PlaceId } from '../game-state.js';

// ---- Rooms --------------------------------------------------------------------

/** No I, L, O, Q: easy to read aloud and to type (never confused with 1 or 0). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPRSTUVWXYZ';
export const ROOM_LENGTH = 4;
/** Namespaces signaling topics so other trystero apps never meet ours. */
export const APP_ID = 'lingo-pal-vr/cafe-a-deux/v1';
export const PROTOCOL_VERSION = 1;

export type Role = 'host' | 'guest';

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_LENGTH; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  return s;
}

/** "ab-cd " -> "ABCD"; null when it is not a valid code. */
export function normalizeRoomCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length !== ROOM_LENGTH) return null;
  for (const c of s) if (!ROOM_ALPHABET.includes(c)) return null;
  return s;
}

export function roomFromSearch(search: string): string | null {
  return normalizeRoomCode(new URLSearchParams(search).get('room'));
}

export function shareUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?room=${code}`;
}

/** The link without "https://", for reading off a panel. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** A friendly default name when the learner never told us theirs. */
export function displayName(name: string | undefined, role: Role): string {
  const n = (name ?? '').trim().slice(0, 16);
  return n || (role === 'host' ? 'Camille' : 'Sam');
}

// ---- Seats --------------------------------------------------------------------

export interface Seat {
  x: number;
  z: number;
  /** Rotation about +Y (radians): local forward (-Z) becomes (-sin, -cos). */
  yaw: number;
  sin: number;
  cos: number;
}

function seat(x: number, z: number, yawDeg: number): Seat {
  const yaw = (yawDeg * Math.PI) / 180;
  return { x, z, yaw, sin: Math.sin(yaw), cos: Math.cos(yaw) };
}

/** Counter-end seats, turned toward the shopkeeper. Clear of both side panels. */
export const SEAT_RIGHT = seat(0.95, -0.62, 45);
export const SEAT_LEFT = seat(-0.95, -0.62, -45);

/** Where I draw my friend. */
export function friendSeat(myRole: Role): Seat {
  return myRole === 'host' ? SEAT_RIGHT : SEAT_LEFT;
}

/** Friend-local point -> my player space. Writes out[o..o+2]. */
export function seatPoint(s: Seat, x: number, y: number, z: number, out: Float32Array | number[], o = 0): void {
  out[o] = s.x + x * s.cos + z * s.sin;
  out[o + 1] = y;
  out[o + 2] = s.z - x * s.sin + z * s.cos;
}

/** Friend-local orientation -> mine: q' = yaw(s) * q. Writes out[o..o+3] (x, y, z, w). */
export function seatQuat(s: Seat, qx: number, qy: number, qz: number, qw: number, out: Float32Array | number[], o = 0): void {
  const hy = Math.sin(s.yaw / 2);
  const hw = Math.cos(s.yaw / 2);
  // (0, hy, 0, hw) * (qx, qy, qz, qw)
  out[o] = hw * qx + hy * qz;
  out[o + 1] = hw * qy + hy * qw;
  out[o + 2] = hw * qz - hy * qx;
  out[o + 3] = hw * qw - hy * qy;
}

// ---- Pose packets -------------------------------------------------------------

export const JOINTS = 25;
/** Layout of a pose in one Float32Array. */
export const P_HEAD = 0; // px py pz qx qy qz qw
export const P_LEFT = 7; // 25 x (x y z)
export const P_RIGHT = P_LEFT + JOINTS * 3;
export const P_POINTER = P_RIGHT + JOINTS * 3; // x y z
export const POSE_FLOATS = P_POINTER + 3;

export const F_XR = 1;
export const F_LEFT = 2;
export const F_RIGHT = 4;
export const F_POINTER = 8;
export const F_TALKING = 16;

export interface Pose {
  flags: number;
  seq: number;
  data: Float32Array;
}

export function newPose(): Pose {
  return { flags: 0, seq: 0, data: new Float32Array(POSE_FLOATS) };
}

const KIND_POSE = 1;
const HEADER = 4; // kind u8, flags u8, seq u16
const MM = 1000;
const Q = 32767;
const LIMIT = 30; // meters: anything further is noise

const toMm = (v: number) => Math.round(Math.max(-LIMIT, Math.min(LIMIT, Number.isFinite(v) ? v : 0)) * MM);
const toQ = (v: number) => Math.round(Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0)) * Q);

export function poseByteLength(flags: number): number {
  let n = HEADER + 7 * 2;
  if (flags & F_LEFT) n += JOINTS * 6;
  if (flags & F_RIGHT) n += JOINTS * 6;
  if (flags & F_POINTER) n += 6;
  return n;
}

/** Positions in millimeters (int16), quaternion in 1/32767 units. ~18 to 324 bytes. */
export function encodePose(p: Pose): ArrayBuffer {
  const flags = p.flags & 0x1f;
  const buf = new ArrayBuffer(poseByteLength(flags));
  const v = new DataView(buf);
  v.setUint8(0, KIND_POSE);
  v.setUint8(1, flags);
  v.setUint16(2, p.seq & 0xffff);
  let o = HEADER;
  const d = p.data;
  for (let i = 0; i < 3; i++, o += 2) v.setInt16(o, toMm(d[P_HEAD + i]));
  for (let i = 3; i < 7; i++, o += 2) v.setInt16(o, toQ(d[P_HEAD + i]));
  const block = (start: number, count: number) => {
    for (let i = 0; i < count; i++, o += 2) v.setInt16(o, toMm(d[start + i]));
  };
  if (flags & F_LEFT) block(P_LEFT, JOINTS * 3);
  if (flags & F_RIGHT) block(P_RIGHT, JOINTS * 3);
  if (flags & F_POINTER) block(P_POINTER, 3);
  return buf;
}

/** Decode into `out` (no allocation). False for anything malformed. */
export function decodePose(raw: unknown, out: Pose): boolean {
  let bytes: Uint8Array;
  if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
  else if (ArrayBuffer.isView(raw)) bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  else return false;
  if (bytes.byteLength < HEADER + 14) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== KIND_POSE) return false;
  const flags = v.getUint8(1);
  if (flags > 0x1f || bytes.byteLength !== poseByteLength(flags)) return false;
  out.flags = flags;
  out.seq = v.getUint16(2);
  const d = out.data;
  let o = HEADER;
  for (let i = 0; i < 3; i++, o += 2) d[P_HEAD + i] = v.getInt16(o) / MM;
  for (let i = 3; i < 7; i++, o += 2) d[P_HEAD + i] = v.getInt16(o) / Q;
  // Re-normalize the quaternion after quantization.
  const n = Math.hypot(d[3], d[4], d[5], d[6]) || 1;
  for (let i = 3; i < 7; i++) d[P_HEAD + i] /= n;
  const block = (start: number, count: number) => {
    for (let i = 0; i < count; i++, o += 2) d[start + i] = v.getInt16(o) / MM;
  };
  if (flags & F_LEFT) block(P_LEFT, JOINTS * 3);
  if (flags & F_RIGHT) block(P_RIGHT, JOINTS * 3);
  if (flags & F_POINTER) block(P_POINTER, 3);
  return true;
}

/** Newer sequence number, with 16-bit wraparound. */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

// ---- Messages -------------------------------------------------------------------

/** What the shopkeeper said: everything the friend's chat panel needs. */
export type TurnLite = Pick<AgentTurn, 'fr' | 'en' | 'replies' | 'points' | 'source'>;

export type Msg =
  | { t: 'hello'; v: number; role: Role; name: string; xr: boolean }
  | { t: 'full' }
  | { t: 'ack' }
  | { t: 'sync'; place: PlaceId; order: OrderState; holder: Role; turn: TurnLite | null }
  | { t: 'turn'; turn: TurnLite; holder: Role }
  | { t: 'order'; order: OrderState }
  | { t: 'fx'; fx: Effect[] }
  | { t: 'act'; ev: AgentEvent }
  | { t: 'pay'; cents: number }
  | { t: 'busy'; holder: Role }
  | { t: 'said'; text: string }
  | { t: 'place'; place: PlaceId }
  | { t: 'travel'; place: PlaceId }
  | { t: 'bye' };

const PLACES: readonly PlaceId[] = ['cafe', 'boulangerie', 'marche'];
const PHASES: readonly OrderPhase[] = ['browsing', 'ordering', 'paying', 'paid'];
const GESTURES = ['thumbs_up', 'thumbs_down', 'wave', 'count'] as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length <= max ? x : null);
const int = (x: unknown, min: number, max: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : null);
const role = (x: unknown): Role | null => (x === 'host' || x === 'guest' ? x : null);
const place = (x: unknown): PlaceId | null => (PLACES.includes(x as PlaceId) ? (x as PlaceId) : null);
const MAX_CENTS = 100_000;

function replies(x: unknown): ReplyOption[] | null {
  if (!Array.isArray(x) || x.length > 3) return null;
  const out: ReplyOption[] = [];
  for (const r of x) {
    if (!isObj(r)) return null;
    const fr = str(r.fr, 200);
    const en = str(r.en, 200);
    if (fr === null || en === null) return null;
    out.push({ fr, en });
  }
  return out;
}

export function validTurn(x: unknown): TurnLite | null {
  if (!isObj(x)) return null;
  const fr = str(x.fr, 400);
  const en = str(x.en, 400);
  const r = replies(x.replies);
  const points = int(x.points, 0, 100);
  const source = x.source === 'ai' || x.source === 'script' ? x.source : null;
  if (fr === null || en === null || !r || points === null || !source) return null;
  return { fr, en, replies: r, points, source };
}

export function validOrder(x: unknown): OrderState | null {
  if (!isObj(x)) return null;
  const phase = PHASES.includes(x.phase as OrderPhase) ? (x.phase as OrderPhase) : null;
  if (!phase || !Array.isArray(x.lines) || x.lines.length > 12) return null;
  const lines = [];
  for (const l of x.lines) {
    if (!isObj(l)) return null;
    const itemId = str(l.itemId, 40);
    const qty = int(l.qty, 1, 9);
    if (!itemId || qty === null) return null;
    lines.push({ itemId, qty });
  }
  const trayCents = int(x.trayCents, 0, MAX_CENTS);
  const changeCents = int(x.changeCents, 0, MAX_CENTS);
  if (trayCents === null || changeCents === null || typeof x.changeGiven !== 'boolean') return null;
  return { phase, lines, trayCents, changeCents, changeGiven: x.changeGiven };
}

/**
 * Effects the friend's game plays: scene effects, plus memories the shopkeeper
 * made about that friend (no quizzes, corrections or goodbyes).
 */
export function validEffects(x: unknown): Effect[] | null {
  if (!Array.isArray(x) || x.length > 16) return null;
  const out: Effect[] = [];
  for (const e of x) {
    if (!isObj(e)) continue;
    switch (e.kind) {
      case 'spawn': {
        const itemId = str(e.itemId, 40);
        const quantity = int(e.quantity, 1, 5);
        if (itemId && quantity !== null) out.push({ kind: 'spawn', itemId, quantity });
        break;
      }
      case 'despawn':
      case 'point': {
        const itemId = str(e.itemId, 40);
        if (itemId) out.push({ kind: e.kind, itemId });
        break;
      }
      case 'show_total': {
        const totalCents = int(e.totalCents, 0, MAX_CENTS);
        if (totalCents !== null) out.push({ kind: 'show_total', totalCents });
        break;
      }
      case 'return_change': {
        const cents = int(e.cents, 0, MAX_CENTS);
        const coins = Array.isArray(e.coins) && e.coins.length <= 20 && e.coins.every((c) => int(c, 1, 50_000) !== null) ? e.coins : null;
        if (cents !== null && coins) out.push({ kind: 'return_change', cents, coins: coins as never });
        break;
      }
      case 'emote':
        if ((EMOTES as readonly string[]).includes(e.emote as string)) out.push({ kind: 'emote', emote: e.emote as (typeof EMOTES)[number] });
        break;
      case 'memory': {
        const key = str(e.key, 20);
        const value = str(e.value, 40);
        if (key && value && ['name', 'favorite_order', 'goal', 'hometown', 'mood', 'last_topic'].includes(key)) out.push({ kind: 'memory', key: key as never, value });
        break;
      }
    }
  }
  return out;
}

/** Events a guest may ask the host's shopkeeper to handle. */
export function validEvent(x: unknown): AgentEvent | null {
  if (!isObj(x)) return null;
  switch (x.kind) {
    case 'say': {
      const text = str(x.text, 200);
      const fingers = int(x.fingers, 0, 10);
      if (!text || !text.trim() || fingers === null) return null;
      const pr = x.pronunciation;
      const pronunciation = typeof pr === 'number' && pr >= 0 && pr <= 100 ? pr : undefined;
      return pronunciation === undefined ? { kind: 'say', text, fingers } : { kind: 'say', text, fingers, pronunciation };
    }
    case 'show': {
      const itemId = str(x.itemId, 40);
      return itemId ? { kind: 'show', itemId } : null;
    }
    case 'gesture': {
      const gesture = GESTURES.includes(x.gesture as (typeof GESTURES)[number]) ? (x.gesture as (typeof GESTURES)[number]) : null;
      const fingers = int(x.fingers, 0, 10);
      return gesture && fingers !== null ? { kind: 'gesture', gesture, fingers } : null;
    }
    case 'idle':
      return { kind: 'idle' };
    default:
      return null; // arrive / paid / short are the host's own
  }
}

/** Parse and validate one message from the peer. Never throws. */
export function decodeMsg(x: unknown): Msg | null {
  if (!isObj(x) || typeof x.t !== 'string') return null;
  switch (x.t) {
    case 'hello': {
      const r = role(x.role);
      const name = str(x.name, 40);
      const v = int(x.v, 0, 1000);
      if (!r || name === null || v === null || typeof x.xr !== 'boolean') return null;
      return { t: 'hello', v, role: r, name: displayName(name, r), xr: x.xr };
    }
    case 'full':
    case 'ack':
    case 'bye':
      return { t: x.t };
    case 'sync': {
      const p = place(x.place);
      const order = validOrder(x.order);
      const holder = role(x.holder);
      const turn = x.turn === null ? null : validTurn(x.turn);
      if (!p || !order || !holder || (x.turn !== null && !turn)) return null;
      return { t: 'sync', place: p, order, holder, turn };
    }
    case 'turn': {
      const turn = validTurn(x.turn);
      const holder = role(x.holder);
      return turn && holder ? { t: 'turn', turn, holder } : null;
    }
    case 'order': {
      const order = validOrder(x.order);
      return order ? { t: 'order', order } : null;
    }
    case 'fx': {
      const fx = validEffects(x.fx);
      return fx ? { t: 'fx', fx } : null;
    }
    case 'act': {
      const ev = validEvent(x.ev);
      return ev ? { t: 'act', ev } : null;
    }
    case 'pay': {
      const cents = int(x.cents, 1, 10_000);
      return cents !== null ? { t: 'pay', cents } : null;
    }
    case 'busy': {
      const holder = role(x.holder);
      return holder ? { t: 'busy', holder } : null;
    }
    case 'said': {
      const text = str(x.text, 200);
      return text ? { t: 'said', text } : null;
    }
    case 'place':
    case 'travel': {
      const p = place(x.place);
      return p ? { t: x.t, place: p } : null;
    }
    default:
      return null;
  }
}

/** Strip a full agent turn to what the friend needs (no tool actions). */
export function liteTurn(t: AgentTurn | TurnLite): TurnLite {
  return { fr: t.fr, en: t.en, replies: t.replies.slice(0, 3).map((r) => ({ fr: r.fr, en: r.en })), points: t.points, source: t.source };
}
