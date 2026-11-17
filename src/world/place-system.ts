/**
 * The Paris map in action: moves the learner between shops.
 *
 * A trip fades the view to black, loads the shop's realistic assets (textures,
 * models, 360 backdrop, lighting), swaps the menu, words and set, tells the
 * other systems (events.place: items, shopkeeper, decor, panels), fades back in,
 * and the new shopkeeper greets the learner. The coin dish, tray, hands, voice
 * and agent are shared, so everything keeps working in every shop.
 */

import {
  AssetManager,
  BackSide,
  createSystem,
  DomeTexture,
  type Entity,
  IBLTexture,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  type DirectionalLight,
  SphereGeometry,
} from '@iwsdk/core';
import { refreshVocabIds, director } from '../agent/runtime.js';
import { setMenuPlace } from '../agent/menu.js';
import { emptyOrder } from '../agent/tools.js';
import { appState, events, type PlaceId } from '../game-state.js';
import { PLACE_LOOKS, PLACE_ORDER, PLACE_UNLOCK_ORDERS, placeModelIds, placeUnlocked } from '../places/places.js';
import { store } from '../state/store.js';
import { PLACE_VOCAB, setVocabPlace } from '../vocab.js';
import { buildShopSet, type ShopSet } from './shop-set.js';
import { loadSurface, type TextureSet } from './surfaces.js';

const FADE_SECONDS = 0.35;
const LOAD_TIMEOUT_MS = 20000;

export class PlaceSystem extends createSystem({
  dome: { required: [DomeTexture] },
  ibl: { required: [IBLTexture] },
}) {
  private set: { entity: Entity; shop: ShopSet } | null = null;
  private fade!: Mesh;
  private fadeMat!: MeshBasicMaterial;
  private fadeTarget = 0;
  private busy = false;
  private loaded = new Map<PlaceId, Promise<void>>();

  init(): void {
    this.fadeMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: BackSide, depthTest: false, depthWrite: false });
    this.fade = new Mesh(new SphereGeometry(0.3, 16, 12), this.fadeMat);
    this.fade.renderOrder = 10000;
    this.fade.visible = false;
    this.fade.name = 'Travel Fade';
    this.world.createTransformEntity(this.fade, { parent: this.world.playerHeadEntity });

    this.cleanupFuncs.push(events.travel.on((place) => void this.travel(place)));
    void this.travel('cafe', true);
    // Warm the other shops' assets in the background once the cafe is up.
    setTimeout(() => {
      for (const p of PLACE_ORDER) if (p !== 'cafe' && (PLACE_UNLOCK_ORDERS[p] <= 1 || placeUnlocked(p, store.profile))) void this.preload(p);
    }, 15000);
  }

  /** Load a shop's models, textures and environment maps once (cached by AssetManager). */
  private preload(place: PlaceId): Promise<void> {
    let p = this.loaded.get(place);
    if (!p) {
      const look = PLACE_LOOKS[place];
      const models = placeModelIds(place, PLACE_VOCAB[place].map((v) => v.model));
      const surfaces = [look.floor, look.counterTop, look.counterFront, look.backTop, look.backFront].map((s) => s.tex);
      p = Promise.all([
        ...models.map((id) => AssetManager.loadGLTFById(id).catch(() => null)),
        ...surfaces.map((id) => loadSurface(id)),
      ]).then(() => undefined);
      this.loaded.set(place, p);
    }
    return p;
  }

  async travel(place: PlaceId, initial = false): Promise<void> {
    if (this.busy || (!initial && place === appState.place)) return;
    const anyway = appState.travelAnyway === place;
    appState.travelAnyway = null;
    if (!anyway && !placeUnlocked(place, store.profile)) return;
    this.busy = true;
    try {
      if (!initial) await this.fadeTo(1);
      await Promise.race([this.preload(place), new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS))]);

      // Data first: menu, words, order, conversation.
      setMenuPlace(place);
      setVocabPlace(place);
      refreshVocabIds();
      appState.place = place;
      if (!initial) {
        store.setOrder(emptyOrder());
        director.resetConversation();
      }

      await this.buildSet(place);
      this.applyEnvironment(place);
      events.place.emit(place);

      if (!initial) {
        await this.fadeTo(0);
        // The new shopkeeper greets the learner (the first-run tutorial greets in the cafe itself).
        void director.handle({ kind: 'arrive' });
      }
    } finally {
      this.busy = false;
    }
  }

  private async buildSet(place: PlaceId): Promise<void> {
    const look = PLACE_LOOKS[place];
    const sets = new Map<string, TextureSet | null>();
    for (const s of [look.floor, look.counterTop, look.counterFront, look.backTop, look.backFront]) sets.set(s.tex, await loadSurface(s.tex));
    const shop = buildShopSet(look, sets, (id) => AssetManager.getGLTF(id)?.scene ?? null, place);
    if (this.set) {
      // Cached model instances share geometry and materials with the asset cache: detach, then dispose the rest.
      for (const prop of this.set.shop.props) prop.removeFromParent();
      this.set.entity.dispose();
      for (const g of this.set.shop.geometries) g.dispose(); // merged prop meshes (static-merge.ts)
    }
    this.set = { entity: this.world.createTransformEntity(shop.root), shop };
  }

  /**
   * Photographic rendering: neutral tone mapping keeps the backdrop photo's real
   * colors (ACES re-grades an already tone-mapped photo and the 3D objects stop
   * matching it), and the key light's shadow map is fitted tightly to the counters
   * so contact shadows are crisp, with soft PCF edges.
   */
  private applyRendering(exposure: number): void {
    const r = this.world.renderer;
    r.toneMapping = NeutralToneMapping;
    r.toneMappingExposure = exposure;
    let key: DirectionalLight | null = null;
    this.world.scene.traverse((o) => {
      if (!key && (o as DirectionalLight).isDirectionalLight && (o as DirectionalLight).castShadow) key = o as DirectionalLight;
    });
    const light = key as DirectionalLight | null;
    if (!light) return;
    light.target.position.set(0, 1, -1.3);
    if (!light.target.parent) light.parent?.add(light.target); // the target only needs a world matrix
    const cam = light.shadow.camera;
    cam.left = -2.6;
    cam.right = 2.6;
    cam.top = 2.6;
    cam.bottom = -2.6;
    cam.updateProjectionMatrix();
    light.shadow.radius = 3;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.02;
  }

  private applyEnvironment(place: PlaceId): void {
    const look = PLACE_LOOKS[place];
    this.applyRendering(look.exposure ?? 1);
    const base = import.meta.env.BASE_URL;
    const yaw = (look.hdriYawDeg * Math.PI) / 180;
    for (const e of this.queries.dome.entities) {
      e.setValue(DomeTexture, 'src', `${base}hdri/${look.hdri}_bg.jpg`);
      e.setValue(DomeTexture, 'intensity', look.backdropIntensity);
      e.getVectorView(DomeTexture, 'rotation')[1] = yaw;
      e.setValue(DomeTexture, '_needsUpdate', true);
    }
    for (const e of this.queries.ibl.entities) {
      e.setValue(IBLTexture, 'src', `${base}hdri/${look.hdri}_1k.hdr`);
      e.setValue(IBLTexture, 'intensity', look.iblIntensity);
      e.getVectorView(IBLTexture, 'rotation')[1] = yaw;
      e.setValue(IBLTexture, '_needsUpdate', true);
    }
  }

  private fadeResolve: (() => void) | null = null;

  private fadeTo(target: number): Promise<void> {
    this.fadeTarget = target;
    this.fade.visible = true;
    return new Promise((resolve) => {
      this.fadeResolve?.();
      this.fadeResolve = resolve;
      // Safety: never leave a trip hanging if frames stop (hidden tab).
      setTimeout(() => {
        if (this.fadeResolve === resolve) {
          this.fadeMat.opacity = target;
          this.fade.visible = target > 0;
          this.fadeResolve = null;
          resolve();
        }
      }, FADE_SECONDS * 1000 + 800);
    });
  }

  update(delta: number): void {
    if (!this.fade.visible) return;
    const step = delta / FADE_SECONDS;
    const o = this.fadeMat.opacity;
    this.fadeMat.opacity = this.fadeTarget > o ? Math.min(this.fadeTarget, o + step) : Math.max(this.fadeTarget, o - step);
    if (this.fadeMat.opacity === this.fadeTarget) {
      if (this.fadeTarget === 0) this.fade.visible = false;
      const r = this.fadeResolve;
      this.fadeResolve = null;
      r?.();
    }
  }
}
