/**
 * Café à deux in the scene: the invite card (code, link, QR, connection
 * state), the friend's avatar and voice, my pose and microphone going out,
 * and a small browser bar for 2D (laptop / phone) players.
 *
 * Solo play is untouched: until a room is opened (map panel "Inviter un ami",
 * voice "inviter", or a ?room= link) this system builds nothing, sends
 * nothing and does no per-frame work beyond one early return.
 */

import {
  AssetManager,
  CanvasTexture,
  createSystem,
  type Entity,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Pressed,
  RayInteractable,
  SRGBColorSpace,
  type UIKit,
  type UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { ensureAudioContext } from '../audio/audio-hub.js';
import { appState, events, type PlaceId } from '../game-state.js';
import { friendModelFor } from '../world/characters/customers.js';
import { HumanRig, prepareAvatar } from '../world/characters/human-rig.js';
import { JOINT_NAMES } from '../hands/gestures.js';
import { COUNTER_Y } from '../layout.js';
import { addDwellTarget, onActivate } from '../ui/dwell.js';
import { FriendAvatar } from './avatar.js';
import { BUTTON_H, BUTTON_W, CARD_H, CARD_W, drawButton, drawCard, drawQr } from './card.js';
import { PoseInterpolator } from './interp.js';
import { decodePose, encodePose, F_LEFT, F_POINTER, F_RIGHT, F_XR, friendSeat, JOINTS, newPose, P_HEAD, P_LEFT, P_POINTER, P_RIGHT, POSE_FLOATS, shortUrl } from './protocol.js';
import { inviteUrl } from './secret.js';
import { brokenInvite, hostRoom, social, socialEnv } from './runtime.js';
import { statusLine } from './session.js';

const SEND_HZ = 15;
const BUBBLE_MS = 6000;
const CARD_AUTOHIDE_MS = 5000;
const CARD_Y = 1.4;
/** 2D players: a seated head height at their own seat (their camera sits further back). */
const FLAT_HEAD: [number, number, number] = [0, 1.22, -0.05];

type ButtonId = 'mic' | 'hide' | 'leave';
const BUTTONS: { id: ButtonId; fr: string; en: string; color: string }[] = [
  { id: 'mic', fr: 'Micro', en: 'Mic on', color: '#3f8f78' },
  { id: 'hide', fr: 'Masquer', en: 'Hide', color: '#3b4a63' },
  { id: 'leave', fr: 'Quitter', en: 'Leave', color: '#b5473a' },
];

interface Button {
  id: ButtonId;
  mesh: Mesh;
  entity: Entity;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  hover: boolean;
}

export class SocialSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
  hovered: { required: [RayInteractable, Hovered] },
}) {
  private built = false;
  private card!: Group;
  private cardCanvas!: HTMLCanvasElement;
  private cardTex!: CanvasTexture;
  private buttons: Button[] = [];
  private cardShown = false;
  private cardHideAt = -1;
  private avatar!: FriendAvatar;
  private interp = new PoseInterpolator();
  private rx = newPose();
  private tx = newPose();
  private view = new Float32Array(POSE_FLOATS);
  private sendAcc = 0;
  private clockMs = 0;
  private bubbleUntil = -1;
  private origin = new Vector3();
  private viewer = new Vector3();
  private tmp = new Vector3();
  private headWorld = new Vector3();
  private pointerNdc: [number, number] | null = null;
  private mic: MediaStream | null = null;
  private micStarting = false;
  private micBlocked = false;
  /** The microphone stays off until the learner turns it on (after connecting). */
  private muted = true;
  private audio: { el: HTMLAudioElement; panner: PannerNode | null; analyser: AnalyserNode | null; buf: Float32Array<ArrayBuffer> } | null = null;
  private dom: { root: HTMLDivElement; status: HTMLSpanElement; extra: HTMLDivElement; mic: HTMLButtonElement; sound: HTMLButtonElement; join: HTMLButtonElement; leave: HTMLButtonElement } | null = null;
  private inviteLabel: UIKit.Text | null = null;

  init(): void {
    const map = this.world.getSceneObject<UIKitMLAsset>('map-panel');
    const invite = map?.getElementById('invite-button');
    this.inviteLabel = map?.getElementById<UIKit.Text>('invite-label') ?? null;
    if (invite) this.cleanupFuncs.push(onActivate(invite, () => this.onInvite()));

    this.cleanupFuncs.push(
      events.invite.on(() => this.onInvite()),
      social.changed.on(() => this.onSessionChange()),
      social.friendSaid.on((text) => {
        this.avatar?.setLabel(social.friendName, text);
        this.bubbleUntil = this.clockMs + BUBBLE_MS;
      }),
      social.pose.on((raw) => {
        if (decodePose(raw, this.rx)) this.interp.push(this.rx, this.clockMs);
      }),
      social.stream.on((s) => this.setFriendAudio(s)),
      this.world.visibilityState.subscribe((v) => (socialEnv.immersive = v !== VisibilityState.NonImmersive)),
    );
    this.queries.pressed.subscribe('qualify', (e) => this.onPressed(e));
    this.queries.hovered.subscribe('qualify', (e) => this.setHover(e, true));
    this.queries.hovered.subscribe('disqualify', (e) => this.setHover(e, false));

    // Opened from a ?room= link before the World existed.
    if (social.active) this.onSessionChange();
    else if (brokenInvite) this.toast('Lien incomplet : ouvrez le lien complet (avec #k=…). · Incomplete link: open the full link (with #k=…).');
  }

  /** A short message for browser players (disappears on its own). */
  private toast(text: string): void {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:20;max-width:calc(100vw - 32px);padding:10px 14px;border-radius:14px;background:rgba(209,73,91,.95);color:#fff;font:600 15px/1.3 system-ui,sans-serif';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  }

  // ---- Room lifecycle -------------------------------------------------------------

  private onInvite(): void {
    events.openPanel.emit('home');
    if (social.active) {
      this.showCard(!this.cardShown);
      return;
    }
    hostRoom();
  }

  private onSessionChange(): void {
    if (social.active) {
      this.build();
      if (!this.cardShown && social.state !== 'connected') this.showCard(true);
      if (social.state === 'connected' && this.cardShown && this.cardHideAt < 0) this.cardHideAt = this.clockMs + CARD_AUTOHIDE_MS;
      if (social.state !== 'connected') {
        this.cardHideAt = -1;
        this.avatar.hide();
        this.interp.clear();
      } else this.avatar.setLabel(social.friendName, '');
      this.inviteLabel?.setProperties({ text: social.state === 'connected' ? `Avec ${social.friendName}` : 'Café à deux' });
    } else {
      this.stopMic();
      this.muted = true;
      this.micBlocked = false;
      this.setFriendAudio(null);
      if (this.built) {
        this.showCard(false);
        this.avatar.hide();
      }
      this.interp.clear();
      this.inviteLabel?.setProperties({ text: 'Inviter un ami' });
      this.dom?.root.remove();
      this.dom = null;
      if (typeof history !== 'undefined' && (/[?&]room=/.test(location.search) || location.hash)) {
        const url = new URL(location.href);
        url.searchParams.delete('room');
        url.hash = ''; // the room key leaves the address bar too
        history.replaceState(null, '', url.toString());
      }
    }
    this.renderCard();
    this.renderDom();
  }

  /**
   * The friend appears as a real person (a Rocketbox human like the shop's customers),
   * one not already among this shop's customers, loaded when the friend first appears.
   * The stand-in shows until it loads; a failed load keeps the stand-in.
   */
  private personModel: string | null = null;
  private personWanted = false;
  private async loadPerson(place: PlaceId): Promise<void> {
    const id = friendModelFor(place);
    if (this.personModel === id) return;
    this.personModel = id;
    try {
      await AssetManager.loadGLTFById(id);
      const gltf = AssetManager.getGLTF(id); // a fresh skeleton-aware clone
      if (!gltf || this.personModel !== id) return;
      const root = gltf.scene;
      prepareAvatar(root, 'Friend (Café à deux)');
      root.traverse((o) => {
        if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) o.frustumCulled = false;
      });
      this.avatar.setPerson(root, new HumanRig(root, { legs: true }));
    } catch (err) {
      console.warn('[social] friend avatar model unavailable; keeping the stand-in', err);
      this.personModel = null;
    }
  }

  /** The full share link, with the room key in the fragment. */
  private get url(): string {
    return social.invite ? inviteUrl(location.origin, social.invite) : '';
  }

  // ---- Building (only once a room exists) -------------------------------------------

  private build(): void {
    if (this.built) return;
    this.built = true;
    this.avatar = new FriendAvatar();
    this.world.createTransformEntity(this.avatar.root, { persistent: true });
    // Loaded only once a friend is actually here (solo players never download it).
    this.cleanupFuncs.push(events.place.on((place) => void (this.personWanted && this.loadPerson(place))));

    this.card = new Group();
    this.card.name = 'InviteCard';
    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = CARD_W;
    this.cardCanvas.height = CARD_H;
    this.cardTex = new CanvasTexture(this.cardCanvas);
    this.cardTex.colorSpace = SRGBColorSpace;
    const w = 0.3;
    const h = (w * CARD_H) / CARD_W;
    const face = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.cardTex, transparent: true }));
    face.position.y = 0.04;
    this.card.add(face);
    // The card sits on the side away from the friend's seat, turned toward me.
    // Above the counter end (clear of the streak candle), outside the home and chat panels.
    const side = friendSeat(social.role ?? 'host').x > 0 ? -1 : 1;
    this.card.position.set(side * 1.02, CARD_Y, -0.7);
    this.card.rotation.y = Math.atan2(-this.card.position.x, -this.card.position.z);
    const cardEntity = this.world.createTransformEntity(this.card, { persistent: true });

    const bw = 0.092;
    const bh = (bw * BUTTON_H) / BUTTON_W;
    BUTTONS.forEach((b, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = BUTTON_W;
      canvas.height = BUTTON_H;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(new PlaneGeometry(bw, bh), new MeshBasicMaterial({ map: tex, transparent: true }));
      mesh.position.set((i - 1) * (bw + 0.008), face.position.y - h / 2 - bh / 2 - 0.01, 0.002);
      const entity = this.world.createTransformEntity(mesh, { parent: cardEntity });
      entity.addComponent(RayInteractable);
      const button: Button = { id: b.id, mesh, entity, canvas, tex, hover: false };
      this.buttons.push(button);
      this.cleanupFuncs.push(addDwellTarget(mesh, () => this.press(b.id)));
      this.drawButton(button);
    });
    this.showCard(false);

    // 2D players: point at the counter with the mouse or a finger.
    const canvas = this.world.renderer.domElement;
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.pointerNdc = [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    // Browsers only play sound after a click or tap.
    const unlock = () => {
      ensureAudioContext();
      void this.audio?.el.play().catch(() => undefined);
      this.renderDom();
    };
    window.addEventListener('pointerdown', unlock);
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', move);
      window.removeEventListener('pointerdown', unlock);
    });
  }

  private showCard(show: boolean): void {
    if (!this.built) return;
    this.cardShown = show;
    this.card.visible = show;
    // Hidden objects still take rays in three.js: park the card far away.
    this.card.position.y = show ? CARD_Y : 100;
    if (!show) this.cardHideAt = -1;
    else this.renderCard();
  }

  private renderCard(): void {
    if (!this.built || !social.active) return;
    const c = this.cardCanvas.getContext('2d');
    if (!c) return;
    const turn = social.state === 'connected' ? `Au tour de ${social.nameOf(social.holder)}` : '';
    drawCard(c, { code: social.code, link: shortUrl(this.url), url: this.url, status: statusLine(social), connected: social.state === 'connected', role: social.role ?? 'host', turn });
    this.cardTex.needsUpdate = true;
    for (const b of this.buttons) this.drawButton(b);
  }

  private drawButton(b: Button): void {
    const spec = BUTTONS.find((x) => x.id === b.id)!;
    const c = b.canvas.getContext('2d');
    if (!c) return;
    if (social.state === 'invited') {
      // "Rejoindre le café de votre ami ?": Join / No thanks (pinch, look, or say "oui").
      b.mesh.visible = b.id !== 'hide';
      if (b.id === 'mic') drawButton(c, 'Rejoindre', 'Join', '#3f8f78', b.hover);
      else if (b.id === 'leave') drawButton(c, 'Non merci', 'No thanks', '#4a5568', b.hover);
      b.tex.needsUpdate = true;
      return;
    }
    b.mesh.visible = true;
    const off = b.id === 'mic' && (this.muted || !this.mic);
    const fr = b.id === 'mic' ? (off ? 'Micro : non' : 'Micro : oui') : spec.fr;
    const en = b.id !== 'mic' ? spec.en : this.micBlocked ? 'Mic blocked' : off ? 'Pinch to talk' : 'Mic on';
    drawButton(c, fr, en, off ? '#4a5568' : spec.color, b.hover);
    b.tex.needsUpdate = true;
  }

  private onPressed(e: Entity): void {
    const b = this.buttons.find((x) => x.entity === e);
    if (b) this.press(b.id);
  }

  private setHover(e: Entity, on: boolean): void {
    const b = this.buttons.find((x) => x.entity === e);
    if (!b) return;
    b.hover = on;
    this.drawButton(b);
  }

  private press(id: ButtonId): void {
    if (social.state === 'invited') {
      if (id === 'mic') social.accept();
      else if (id === 'leave') social.decline();
      return;
    }
    if (id === 'mic') this.setMuted(!this.muted);
    else if (id === 'hide') this.showCard(false);
    else void social.leave();
  }

  // ---- Microphone and the friend's voice -----------------------------------------

  private async startMic(): Promise<void> {
    if (this.mic || this.micStarting || !navigator.mediaDevices?.getUserMedia) return;
    this.micStarting = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!social.active) {
        for (const t of s.getTracks()) t.stop();
        return;
      }
      this.mic = s;
      for (const t of s.getAudioTracks()) t.enabled = !this.muted;
      social.link?.setStream(s);
    } catch (err) {
      console.warn('[social] microphone unavailable (your friend will not hear you)', err);
      this.mic = null;
      this.micBlocked = true;
    } finally {
      this.micStarting = false;
    }
    this.renderCard();
    this.renderDom();
  }

  private stopMic(): void {
    if (!this.mic) return;
    for (const t of this.mic.getTracks()) t.stop();
    social.link?.setStream(null);
    this.mic = null;
  }

  private setMuted(m: boolean): void {
    this.muted = m;
    if (!m && !this.mic) void this.startMic(); // first "on": ask for the microphone now, not before
    if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = !m;
    for (const b of this.buttons) if (b.id === 'mic') this.drawButton(b);
    this.renderDom();
  }

  /** The friend's voice comes from their head: WebAudio panner (HRTF). */
  private setFriendAudio(stream: MediaStream | null): void {
    if (this.audio) {
      this.audio.el.srcObject = null;
      this.audio.panner?.disconnect();
      this.audio = null;
    }
    if (!stream) return;
    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    const ctx = ensureAudioContext();
    let panner: PannerNode | null = null;
    let analyser: AnalyserNode | null = null;
    if (ctx) {
      // Chrome only feeds a remote WebRTC stream into WebAudio while a media element plays it (muted).
      el.muted = true;
      const src = ctx.createMediaStreamSource(stream);
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 0.8;
      panner.rolloffFactor = 0.6;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const gain = ctx.createGain();
      gain.gain.value = 1.3;
      src.connect(analyser);
      src.connect(panner).connect(gain).connect(ctx.destination);
    }
    void el.play().catch(() => undefined);
    this.audio = { el, panner, analyser, buf: new Float32Array(256) };
    this.renderDom();
  }

  // ---- Browser bar (2D players) ---------------------------------------------------

  private renderDom(): void {
    if (!social.active || typeof document === 'undefined') return;
    if (!this.dom) {
      const root = document.createElement('div');
      root.style.cssText =
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px);padding:8px 14px;border-radius:16px;background:rgba(29,53,87,.92);color:#fafaf7;font:15px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      const title = document.createElement('b');
      title.textContent = 'Café à deux';
      title.style.color = '#e2b857';
      const status = document.createElement('span');
      const extra = document.createElement('div');
      extra.style.cssText = 'display:flex;align-items:center;gap:8px';
      const btn = (label: string, color: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `border:0;border-radius:10px;padding:6px 10px;font:600 14px system-ui,sans-serif;color:#fff;background:${color};cursor:pointer`;
        b.addEventListener('click', fn);
        return b;
      };
      const sound = btn('Activer le son', '#d9a962', () => {
        ensureAudioContext();
        void this.audio?.el.play().catch(() => undefined);
        this.renderDom();
      });
      const mic = btn('Micro', '#3f8f78', () => this.setMuted(!this.muted));
      const leave = btn('Quitter', '#b5473a', () => void social.leave());
      const join = btn('Rejoindre', '#3f8f78', () => social.accept());
      root.append(title, status, extra, join, sound, mic, leave);
      document.body.appendChild(root);
      this.dom = { root, status, extra, mic, sound, join, leave };
    }
    const d = this.dom;
    const s = statusLine(social);
    d.status.textContent = `${s.fr} · ${s.en}`;
    const invited = social.state === 'invited';
    d.join.style.display = invited ? '' : 'none';
    d.mic.style.display = invited ? 'none' : '';
    d.leave.textContent = invited ? 'Non merci' : 'Quitter';
    d.mic.textContent = this.micBlocked ? 'Micro bloqué' : this.muted || !this.mic ? 'Micro : non' : 'Micro : oui';
    d.mic.style.background = this.muted || !this.mic ? '#4a5568' : '#3f8f78';
    const ctx = ensureAudioContextIfExists();
    d.sound.style.display = !invited && ctx && ctx.state !== 'running' ? '' : 'none';
    d.extra.replaceChildren();
    if (invited) {
      const t = document.createElement('span');
      t.textContent = `Code ${social.code}`;
      t.style.cssText = 'font:600 14px ui-monospace,monospace';
      d.extra.append(t);
    } else if (social.role === 'host' && social.state !== 'connected') {
      const q = document.createElement('canvas');
      q.width = q.height = 132;
      const c = q.getContext('2d');
      if (c) drawQr(c, this.url, 0, 0, 132);
      q.style.cssText = 'width:66px;height:66px;border-radius:6px;image-rendering:pixelated';
      const link = document.createElement('span');
      link.textContent = shortUrl(this.url);
      link.style.cssText = 'font:600 13px ui-monospace,monospace;user-select:all;word-break:break-all;max-width:300px';
      const copy = document.createElement('button');
      copy.textContent = 'Copier';
      copy.style.cssText = 'border:0;border-radius:10px;padding:6px 10px;font:600 14px system-ui,sans-serif;color:#fff;background:#457b9d;cursor:pointer';
      copy.addEventListener('click', () => void navigator.clipboard?.writeText(this.url).then(() => (copy.textContent = 'Copié !')).catch(() => undefined));
      d.extra.append(q, link, copy);
    } else if (social.state === 'connected') {
      const t = document.createElement('span');
      t.textContent = `Au tour de ${social.nameOf(social.holder)}`;
      t.style.color = '#d9a962';
      d.extra.append(t);
    }
  }

  // ---- Frame loop -------------------------------------------------------------------

  update(delta: number): void {
    if (!social.active || !this.built) return;
    this.clockMs += delta * 1000;
    if (this.cardHideAt > 0 && this.clockMs > this.cardHideAt) this.showCard(false);
    if (social.state !== 'connected') return;

    this.sendAcc += delta;
    if (this.sendAcc >= 1 / SEND_HZ) {
      this.sendAcc = 0;
      this.sendPose();
    }

    // No fresh packet (stale): the avatar keeps its last placement.
    const flags = this.interp.sample(this.clockMs, this.view);
    if (flags >= 0) {
      if (!this.personWanted) {
        this.personWanted = true;
        void this.loadPerson(appState.place);
      }
      this.origin.copy(this.player.position);
      this.world.camera.getWorldPosition(this.viewer);
      this.avatar.apply(flags, this.view, friendSeat(social.role ?? 'host'), this.origin, this.viewer, Math.min(delta, 0.1));
    }
    if (this.bubbleUntil > 0 && this.clockMs > this.bubbleUntil) {
      this.bubbleUntil = -1;
      this.avatar.setLabel(social.friendName, '');
    }

    const a = this.audio;
    if (a?.panner) {
      this.avatar.headWorldPosition(this.headWorld);
      a.panner.positionX.value = this.headWorld.x;
      a.panner.positionY.value = this.headWorld.y;
      a.panner.positionZ.value = this.headWorld.z;
    }
    if (a?.analyser) {
      a.analyser.getFloatTimeDomainData(a.buf);
      let sum = 0;
      for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
      this.avatar.setTalking(Math.sqrt(sum / a.buf.length) * 12);
    }
  }

  /** My head (and hands, or 2D pointer) in my player space, quantized and sent. */
  private sendPose(): void {
    const link = social.link;
    if (!link) return;
    const p = this.tx;
    const d = p.data;
    const cam = this.world.camera;
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.xrSession;
    let flags = 0;
    d[P_HEAD + 3] = cam.quaternion.x;
    d[P_HEAD + 4] = cam.quaternion.y;
    d[P_HEAD + 5] = cam.quaternion.z;
    d[P_HEAD + 6] = cam.quaternion.w;
    if (frame && ref && session) {
      flags |= F_XR;
      d[P_HEAD] = cam.position.x;
      d[P_HEAD + 1] = cam.position.y;
      d[P_HEAD + 2] = cam.position.z;
      for (const source of session.inputSources) {
        const hand = source.hand;
        if (!hand) continue;
        const left = source.handedness === 'left';
        if (!left && source.handedness !== 'right') continue;
        if (this.readHand(frame, ref, hand, d, left ? P_LEFT : P_RIGHT)) flags |= left ? F_LEFT : F_RIGHT;
      }
    } else {
      d[P_HEAD] = FLAT_HEAD[0];
      d[P_HEAD + 1] = FLAT_HEAD[1];
      d[P_HEAD + 2] = FLAT_HEAD[2];
      if (this.pointerNdc && this.pointAtCounter(d)) flags |= F_POINTER;
    }
    p.flags = flags;
    p.seq = (p.seq + 1) & 0xffff;
    link.sendPose(encodePose(p));
  }

  private readHand(frame: XRFrame, ref: XRReferenceSpace, hand: XRHand, out: Float32Array, start: number): boolean {
    for (let i = 0; i < JOINTS; i++) {
      const space = hand.get(JOINT_NAMES[i] as XRHandJoint);
      const pose = space ? frame.getJointPose?.(space, ref) : undefined;
      if (!pose) return false;
      const t = pose.transform.position;
      out[start + i * 3] = t.x;
      out[start + i * 3 + 1] = t.y;
      out[start + i * 3 + 2] = t.z;
    }
    return true;
  }

  /** Mouse ray -> the counter top (or 1.2 m ahead), in my player space. */
  private pointAtCounter(d: Float32Array): boolean {
    const ndc = this.pointerNdc;
    if (!ndc) return false;
    const cam = this.world.camera;
    cam.getWorldPosition(this.viewer);
    this.tmp.set(ndc[0], ndc[1], 0.5).unproject(cam).sub(this.viewer).normalize();
    const planeY = COUNTER_Y + 0.02 + this.player.position.y;
    let t = this.tmp.y < -0.01 ? (planeY - this.viewer.y) / this.tmp.y : -1;
    if (t <= 0 || t > 3) t = 1.2;
    d[P_POINTER] = this.viewer.x + this.tmp.x * t - this.player.position.x;
    d[P_POINTER + 1] = this.viewer.y + this.tmp.y * t - this.player.position.y;
    d[P_POINTER + 2] = this.viewer.z + this.tmp.z * t - this.player.position.z;
    return true;
  }
}

function ensureAudioContextIfExists(): AudioContext | null {
  return typeof AudioContext === 'undefined' ? null : ensureAudioContext();
}
