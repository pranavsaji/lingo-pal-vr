# Lingo Pal VR: Cafe Lune

A hands-first French cafe for Meta Quest and Meta VR Glasses, built with Meta's
Immersive Web SDK (WebXR). Entry for the Meta VR Start Developer Competition 2026.

**Live:** https://lingo-pal-vr.vercel.app (open in Quest Browser, press **Entrer au café**).
The landing page also plays a 3-minute tour.

- **Order with your hands**: look at an item and hold up fingers (index-first or the French
  thumb-first count), pinch reply chips, or simply say it in French.
- **An AI shopkeeper who acts in the world** (Claude, with tools the game validates): she
  serves the goods on the counter, quotes prices, counts your change back aloud, offers a
  swap when stock runs out, tests you with wrong change on purpose, remembers you between
  visits and plans tomorrow's practice from your weak words.
- **Seven places on a tabletop Plan de Paris**: Café Lune, La Boulangerie, Le Marché,
  Le Bistrot, Le Métro, La Pharmacie and L'Hôtel, each with its own shopkeeper, menu,
  prices, words, 360° photo backdrop and a real-life curveball ("Sur place ou à emporter ?").
  Pinch a pin on the little 3D Paris on the counter to travel.
- **Prêt pour Paris**: readiness for a real trip in 28 situations (order, say it, pay the
  exact amount, do it with no help, in each place), each ticked only by something the game
  verified; today's 10-minute plan; an optional trip countdown ("J-12").
- **Pay with real euros**: pinch coins and notes onto the tray, or a bank card at the hotel.
- **Speak and be scored**: pronunciation score on every spoken line, on-device French speech
  recognition (no key), natural shopkeeper voices; "Vraie vie" mode removes English and hints.
- **Pal**, a sparrow on the counter you can ask in English ("How do I ask for the bill?").
- **Come back tomorrow**: streaks with rest days, XP and A1 to A2 levels, Mon Carnet
  (spaced repetition), a daily shopping list, Ma semaine, the Passeport de Paris (16 stamps).
- **First five minutes**: landing page with real loading progress, a hands / eyes / voice
  choice, a ghost-hand tutorial and a paid first order in about a minute.
- **Accessibility**: voice for every action, eyes-only selection, high contrast, text size,
  slow speech, subtitles, left-hand mode, reduced motion, seated by default.
- **Mixed reality**: the café counter lands on your real table (planes, anchors, depth occlusion).
- **Café à deux**: a friend joins from any browser, peer to peer, and takes turns ordering.
- Built for Meta Quest 3 / 3S and Meta VR Glasses (narrow-view layout, gaze + pinch).

Tested in the IWSDK emulator (Meta Quest 3 profile); on-device reports welcome (TESTING.md).

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

Shopkeepers speak with natural voices from Inworld TTS-2 through `/api/tts` when
`INWORLD_API_KEY` is set (Madame Lune and Madame Rose: Hélène with different delivery;
Monsieur Paul: Alain; the learner's own phrases: Étienne). Responses are cached at the CDN,
so repeated lines are free. Without the key: the browser's French voice, or an on-device
French voice model (114 MB, downloaded once). Subtitles are always on. Test engines with
`?tts=cloud|browser|local` and `?stt=local`.

## Daily shopping list and weekly report

- **La liste de courses**: every day, one thing to buy in three open shops,
  shown on the home panel; ticked when paid for in that shop; the full list is worth +60 XP.
  The shopkeeper knows what is on your list in their shop.
- **Ma semaine**: XP per day for the last 7 days, minutes learning, new words, orders,
  average pronunciation, active days and streak, and the trend versus the week before.
  Its **Prêt pour Paris** tab shows the 28-situation checklist and today's plan (also from
  the home panel strip, or say "prêt pour Paris"). `src/state/readiness.ts`.

## Realistic look

Shopkeepers are Microsoft Rocketbox avatars (MIT) driven by procedural bone animation
(`src/world/characters/`). Props, surface textures and 360° environments come from
Poly Haven (CC0) and ambientCG scans (CC0) via `node scripts/fetch-assets.mjs`, plus six
CC-BY Sketchfab models via Objaverse with `node scripts/fetch-objaverse.mjs` (re-runnable;
budgets per model; credits in `CREDITS.md`).
Shop data (menus, prices, shopkeepers) lives in `shared/places.json`, read by both the
app and the AI server so they cannot drift apart.

## Visual clarity

`src/world/quality-system.ts` renders at each headset's physical panel resolution
(framebuffer scale 1.2 on Quest 3, 1.1 on Quest 3S, 1.0 elsewhere; Meta's render-scale table
puts the Quest panel at ~1.2) at the 72 Hz baseline, with light fixed foveation (0.15) so the
side panels' text stays sharp. If frames drop it raises foveation step by step; if foveation is
maxed and frames still drop for 3 s, it sheds extras one at a time (`src/world/power.ts`:
slower shadow updates, background customers, depth occlusion, decor, frozen shadows) and
restores them only after a long stable stretch. Static scenery is merged per material and
refractive glass is drawn as plain transparency (`src/world/static-merge.ts`).
Overrides for testing: `?res=1.5`, `?fov=0.5`, `?power=0..5`. Tester mode: `?perf` (TESTING.md).

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
`?demo=week` (demo seed, labelled in the UI) replaces the learner with a simulated week of history, so the
"Bon retour !" moment, the 7-day streak, a rest day, the passport and the A1 > A2 ladder can be seen in one sitting;
`?demo=rest` is the same week with yesterday missed, saved by a rest day.

Licenses and credits: see `CREDITS.md`.
