/**
 * Room secrets (WebCrypto only, no DOM; unit-tested in Node).
 *
 * The 4-letter code is for people (easy to read and say); it is NOT the
 * secret. The share link carries a random 80-bit key in the URL fragment
 * (#k=..., never sent to any server):
 *     https://<host>/?room=ABCD#k=7Q2M4XK9DA3WRB6T
 * The signaling topic, the offer encryption password and the HMAC key for the
 * peer handshake are all derived from code + key, so someone who only knows
 * (or guesses) the code cannot find the room, read its offers, or pass the
 * handshake. Before any game message or microphone audio flows, both peers
 * prove they hold the key: each sends a random nonce and answers the other's
 * with HMAC-SHA256(key, nonce | role); the role binding stops a peer from
 * reflecting our own proof back to us.
 */

import { normalizeRoomCode } from './protocol.js';

/** RFC 4648 base32 alphabet: easy to copy, safe in a URL fragment. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SECRET_LENGTH = 16; // 16 x 5 bits = 80 bits

export function makeSecret(): string {
  const bytes = new Uint8Array(SECRET_LENGTH);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += B32[b & 31];
  return s;
}

export function validSecret(s: string | null | undefined): s is string {
  if (typeof s !== 'string' || s.length !== SECRET_LENGTH) return false;
  for (const c of s) if (!B32.includes(c)) return false;
  return true;
}

export interface Invite {
  code: string;
  secret: string;
}

/** Read ?room=ABCD and #k=SECRET. Null when either is missing or malformed. */
export function parseInvite(search: string, hash: string): Invite | null {
  const code = normalizeRoomCode(new URLSearchParams(search).get('room'));
  const secret = new URLSearchParams(hash.replace(/^#/, '')).get('k')?.toUpperCase() ?? null;
  if (!code || !validSecret(secret)) return null;
  return { code, secret };
}

/** True when the URL has ?room= at all (valid or not). */
export function hasRoomParam(search: string): boolean {
  return new URLSearchParams(search).has('room');
}

export function inviteUrl(origin: string, inv: Invite): string {
  return `${origin.replace(/\/+$/, '')}/?room=${inv.code}#k=${inv.secret}`;
}

const enc = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

export interface RoomKeys {
  /** Signaling topic (trystero hashes it again). */
  roomId: string;
  /** Offer/answer encryption password. */
  password: string;
  /** HMAC key for the handshake. */
  key: CryptoKey;
}

export async function deriveRoom(inv: Invite): Promise<RoomKeys> {
  const base = `lingo-pal-vr|cafe-a-deux|${inv.code}|${inv.secret}`;
  const [topic, password, mac] = await Promise.all([sha256Hex(`topic|${base}`), sha256Hex(`password|${base}`), sha256Hex(`hmac|${base}`)]);
  const key = await crypto.subtle.importKey('raw', enc.encode(mac), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { roomId: `${inv.code}-${topic.slice(0, 32)}`, password, key };
}

// ---- Handshake ----------------------------------------------------------------------

export type HandshakeSend = (data: { n?: string; mac?: string }) => Promise<void>;
export type HandshakeReceive = () => Promise<{ data: unknown }>;

const NONCE_BYTES = 16;
const HEX = /^[0-9a-f]+$/;

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function unhex(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const field = (x: unknown, name: 'n' | 'mac', len: number): string => {
  const v = typeof x === 'object' && x !== null ? (x as Record<string, unknown>)[name] : undefined;
  if (typeof v !== 'string' || v.length !== len || !HEX.test(v)) throw new Error('handshake: malformed');
  return v;
};

/**
 * Prove to the peer that we hold the room key, and check that they do.
 * Throws (the peer is dropped) on any mismatch. `isInitiator` differs on the two sides.
 */
export async function runHandshake(key: CryptoKey, send: HandshakeSend, receive: HandshakeReceive, isInitiator: boolean): Promise<void> {
  const mine = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(mine);
  const myNonce = hex(mine);
  await send({ n: myNonce });
  const theirNonce = field((await receive()).data, 'n', NONCE_BYTES * 2);
  if (theirNonce === myNonce) throw new Error('handshake: reflected nonce');
  const me = isInitiator ? 'i' : 'r';
  const them = isInitiator ? 'r' : 'i';
  const proof = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${theirNonce}|${me}`)));
  await send({ mac: hex(proof) });
  const theirMac = field((await receive()).data, 'mac', 64);
  const ok = await crypto.subtle.verify('HMAC', key, unhex(theirMac), enc.encode(`${myNonce}|${them}`));
  if (!ok) throw new Error('handshake: wrong key');
}
