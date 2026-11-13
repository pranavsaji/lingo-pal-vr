/**
 * Peer-to-peer link between two learners: WebRTC data channels (state, poses)
 * and an audio track (voice chat). No server of ours and no secrets.
 *
 * Signaling (how the two browsers find each other) goes through trystero
 * (MIT) over public relays: Nostr first (many relays at once), and after a few
 * seconds without a friend, also public WebTorrent trackers as a fallback.
 * The first strategy that finds the friend wins; the other is closed.
 * Offers are encrypted with the room code; NAT traversal uses public STUN.
 *
 * The trystero code is loaded with a dynamic import, only when a room is
 * opened: a solo learner never downloads it or touches the network.
 */

import type { Room } from '@trystero-p2p/nostr';
import { APP_ID } from './protocol.js';

export type LinkEvent =
  | { kind: 'peer'; peerId: string; via: string }
  | { kind: 'leave'; peerId: string }
  | { kind: 'msg'; data: unknown; peerId: string }
  | { kind: 'pose'; data: unknown; peerId: string }
  | { kind: 'stream'; stream: MediaStream; peerId: string }
  | { kind: 'error'; error: string };

const FALLBACK_AFTER_MS = 6000;

/**
 * Nostr relays that relayed trystero signaling between two browsers in a test
 * on 2026-11-13 (several of the library's defaults did not). All are used at
 * once; any one working is enough, and WebTorrent trackers back them up.
 */
const NOSTR_RELAYS = [
  'relay.nostr.net',
  'relay.primal.net',
  'nostr.oxtr.dev',
  'purplerelay.com',
  'relay.nostr.dev.br',
  'nostr.rblb.it',
].map((h) => `wss://${h}`);

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

interface Joined {
  name: string;
  room: Room;
  msg: { send: (d: never, o?: { target?: string }) => Promise<void> };
  pose: { send: (d: never, o?: { target?: string }) => Promise<void> };
}

export class PeerLink {
  private rooms: Joined[] = [];
  private active: Joined | null = null;
  private stream: MediaStream | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  peerId: string | null = null;

  constructor(
    private code: string,
    private on: (e: LinkEvent) => void,
  ) {}

  async open(): Promise<void> {
    try {
      const nostr = await import('@trystero-p2p/nostr');
      if (this.closed) return;
      this.join('nostr', nostr.joinRoom, NOSTR_RELAYS);
    } catch (err) {
      this.on({ kind: 'error', error: `nostr: ${String(err)}` });
    }
    this.fallbackTimer = setTimeout(() => void this.fallback(), FALLBACK_AFTER_MS);
  }

  private async fallback(): Promise<void> {
    this.fallbackTimer = null;
    if (this.closed || this.peerId) return;
    try {
      const torrent = await import('@trystero-p2p/torrent');
      if (this.closed || this.peerId) return;
      this.join('torrent', torrent.joinRoom);
    } catch (err) {
      this.on({ kind: 'error', error: `torrent: ${String(err)}` });
    }
  }

  private join(
    name: string,
    joinRoom: (config: { appId: string; password: string; rtcConfig: RTCConfiguration; relayConfig?: { urls: string[] } }, roomId: string, cb?: { onJoinError?: (d: { error: string }) => void }) => Room,
    relays?: string[],
  ): void {
    const room = joinRoom({ appId: APP_ID, password: `cafe-${this.code}`, rtcConfig: RTC_CONFIG, ...(relays ? { relayConfig: { urls: relays } } : {}) }, this.code, {
      onJoinError: (d) => this.on({ kind: 'error', error: `${name}: ${d.error}` }),
    });
    const msg = room.makeAction('msg');
    const pose = room.makeAction('pose');
    const j: Joined = { name, room, msg: msg as never, pose: pose as never };
    this.rooms.push(j);
    msg.onMessage = (data, ctx) => {
      if (ctx.peerId === this.peerId) this.on({ kind: 'msg', data, peerId: ctx.peerId });
    };
    pose.onMessage = (data, ctx) => {
      if (ctx.peerId === this.peerId) this.on({ kind: 'pose', data, peerId: ctx.peerId });
    };
    room.onPeerJoin = (peerId) => {
      if (this.peerId && this.peerId !== peerId) {
        // Only two seats at the counter: tell a third visitor, then ignore them.
        void msg.send({ t: 'full' }, { target: peerId }).catch(() => undefined);
        return;
      }
      if (this.peerId === peerId) return;
      this.peerId = peerId;
      this.active = j;
      // Close the other strategies (they found nobody, or the same friend twice).
      for (const other of this.rooms) if (other !== j) void other.room.leave().catch(() => undefined);
      this.rooms = [j];
      if (this.stream) room.addStream(this.stream, { target: peerId });
      this.on({ kind: 'peer', peerId, via: name });
    };
    room.onPeerLeave = (peerId) => {
      if (peerId !== this.peerId) return;
      this.peerId = null;
      this.on({ kind: 'leave', peerId });
    };
    room.onPeerStream = (stream, peerId) => {
      if (peerId === this.peerId) this.on({ kind: 'stream', stream, peerId });
    };
  }

  get via(): string {
    return this.active?.name ?? '';
  }

  send(m: object): void {
    if (!this.active || !this.peerId) return;
    void this.active.msg.send(m as never, { target: this.peerId }).catch(() => undefined);
  }

  sendPose(buf: ArrayBuffer): void {
    if (!this.active || !this.peerId) return;
    void this.active.pose.send(buf as never, { target: this.peerId }).catch(() => undefined);
  }

  /** Share my microphone with the friend (now, and again after a reconnect). */
  setStream(stream: MediaStream | null): void {
    const prev = this.stream;
    this.stream = stream;
    if (!this.active) return;
    if (prev) this.active.room.removeStream(prev);
    if (stream && this.peerId) this.active.room.addStream(stream, { target: this.peerId });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    const rooms = this.rooms;
    this.rooms = [];
    this.active = null;
    this.peerId = null;
    await Promise.all(rooms.map((r) => r.room.leave().catch(() => undefined)));
  }
}
