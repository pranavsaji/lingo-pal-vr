# Lingo Pal VR: Cafe Lune

A hands-first French cafe for Meta Quest and Meta VR Glasses, built with Meta's
Immersive Web SDK (WebXR). Entry for the Meta VR Start Developer Competition 2026.

**Live:** https://lingo-pal-vr.vercel.app (open in Quest Browser, press Enter VR)

- Order by holding up fingers while looking at an item, or by saying it in French.
- Pay with real euro coins and notes; Madame Lune counts your change back aloud.
- Madame Lune is an AI agent (Claude) whose actions are validated by a deterministic
  game core; she looks at you, talks, gestures, and remembers you between visits.
- Pronunciation score on every spoken reply; spaced-repetition word book (Mon Carnet);
  streak, XP, CEFR-style levels, and cafe decor that unlocks as you progress.
- Zero-text first-run tutorial with a ghost hand; accessibility settings (eyes-only
  dwell, voice commands, high contrast, text size, slow speech, left-hand mode).
- Optional mixed reality (passthrough) mode puts the counter in your room.
- **Three shops on a Paris map**: Café Lune (Madame Lune), La Boulangerie (Monsieur
  Paul) and Le Marché (Madame Rose), each with its own menu, prices, words, realistic
  shopkeeper, 360° photo backdrop and lighting. The bakery opens after the tutorial,
  the market after your first paid order. Pinch "Paris" or say "allons au marché".

## Run it on your Mac

You need Node 20.19+ or 22.12+ (`node -v`).

```bash
npm install
cp .env.example .env   # then set ANTHROPIC_API_KEY=...
npm run dev
```

A browser window opens at https://localhost:8081 (accept the local certificate warning).
Click **Enter VR**; the built-in emulator (IWER) lets you test with hands or controllers.
Without a key the app still works with its built-in offline conversation.

## Voice

Speech recognition picks the first engine available:

1. A server provider, if `OPENAI_API_KEY` or `DEEPGRAM_API_KEY` is set (`/api/stt`).
2. The browser's own recognition (desktop Chrome and Edge).
3. **On-device Whisper** (`src/voice/local-voice-worker.ts`): no key needed. This is
   what Quest Browser uses. About 74 MB (Whisper base), downloaded once in the background and cached.

Madame Lune speaks with the browser's French voice when there is one, otherwise with an
on-device French voice model (114 MB, downloaded once in the background). Subtitles are
always on. Test the on-device engines on desktop with `?stt=local&tts=local`.

## Realistic look

Shopkeepers are Microsoft Rocketbox avatars (MIT) driven by procedural bone animation
(`src/world/characters/`). Props, surface textures and 360° environments come from
Poly Haven (CC0) via `node scripts/fetch-assets.mjs` (re-runnable; budgets per model).
Shop data (menus, prices, shopkeepers) lives in `shared/places.json`, read by both the
app and the AI server so they cannot drift apart.

## Visual clarity

`src/world/quality-system.ts` renders above the default resolution (framebuffer scale 1.3 on
Quest 3, 1.1-1.15 on Quest 2/3S/Pro) with light fixed foveation (0.15) so the side panels'
text stays sharp; if frames drop it raises foveation step by step and relaxes it again when
there is headroom. Overrides for testing: `?res=1.5`, `?fov=0.5`.

## Meta VR Glasses

Gaze tracking is requested (optional), so on the glasses you look at a target and pinch
with either hand. When the headset's view is narrow (under ~42 degrees per side, as on the
glasses), the side panels swing toward the center and shrink to 85% so they stay in view
while you face Madame Lune. Force it on any device with `?layout=glasses` (or `?layout=wide`).
Test in the emulator by setting `dev.emulator.device` to `metaVRGlasses` in `iwsdk.config.json`.

## Test on a Quest

Open https://lingo-pal-vr.vercel.app in Quest Browser. For local builds, put the Quest
and Mac on the same Wi-Fi, run `npm run dev`, then `npx @iwsdk/cli dev status` and open
the `network` URL.

## Deploy (Vercel)

The project is linked (`.vercel/`) and `ANTHROPIC_API_KEY` is set in the Vercel project.

```bash
vercel deploy --prod
```

`vercel.json` sets cross-origin isolation headers (multi-threaded WASM for the
on-device voice) and serves `api/*.mjs` as functions. `.vercelignore` keeps `.env` local.

## Project map

| Path | What it is |
| --- | --- |
| `src/state/` | Profile, XP/levels, streak, unlocks, spaced repetition (pure, tested) |
| `src/agent/` | Menu and French numbers, validated tools, intent parser, offline agent, director |
| `server/agent-handler.mjs` | Madame Lune AI (Anthropic SDK, strict tool use) for `/api/agent` |
| `server/stt-handler.mjs` | Speech-to-text proxy for `/api/stt` (OpenAI or Deepgram key) |
| `src/hands/` | Finger counting and gestures from WebXR hand joints |
| `src/interaction/coin-system.ts` | Grab euros, pay on the tray, change counted back |
| `src/voice/` | Push-to-talk, pronunciation scoring, voice commands, on-device Whisper + French voice worker |
| `src/world/` | Madame Lune animation, decor unlocks, onboarding, confetti, mixed reality |
| `src/ui/` | Carnet/Settings panels, eyes-only dwell selection |
| `src/audio/audio-system.ts` | Synthesized spatial sound and cafe ambience |
| `src/models/cafe-models.ts` | Procedural models (Madame Lune rig, money, decor, ghost hand) |
| `tests/` | `npm test` (vitest) |

Dev tips: `?debug` exposes `window.__lingoVoice` for automated voice checks. `Shift+R` (dev only) or `?reset` in the URL starts a brand-new learner (tutorial).

Licenses and credits: see `CREDITS.md`.
