# Lingo Pal VR: Winning Plan for the Meta VR Start Developer Competition 2026

Owner: Pranav Saji (team "Pranav Innovates") · Build: Immersive Web SDK (WebXR) · Written Nov 11, 2026

This file is the single source of truth for the hackathon build. Claude Code: read the
"Hackathon context" and "Ground rules" sections before every phase, then work one phase at a
time, finishing each phase's acceptance checklist before starting the next.

---

## 0. Hackathon context (verified from the official Devpost pages on Nov 11, 2026)

### Key dates
| What | When |
| --- | --- |
| Competition window opened | Sep 24, 2026, 10:00 a.m. PST |
| **Submission deadline** | **Nov 18, 2026, 12:00 p.m. PST** (code freeze target: Nov 18, 9:00 a.m.) |
| Winners announced | on or around Dec 11, 2026 |

### Eligibility and status
- Must be a **Meta VR Start member** by the time of submission. Application submitted Nov 11
 . If no approval by Nov 13 evening, file a support case in the
  Meta Developer Support Center and mention the Nov 18 deadline.
- Devpost registration: done (draft project exists).
- **One entry per person. One prize per entry.** If an entry is considered for several prizes,
  it receives the highest-value one. So being eligible for many categories is pure upside.

### Our track and division
- **Track: Productivity.** Official description: "Apps that make you more effective anywhere or
  are designed around specific daily moments ... habits tied to a recurring context."
  Our framing: *a 10-minute daily French cafe habit*.
- **Division: New Experience.** This repo was created for the competition (first commit
  2026-11-12, inside the window). The VR app is a new codebase; it shares only the name with the
  separate Lingo Pal mobile app. Proof: first commit date (`git log --reverse`).
- Open question to email the hackathon manager: "Does a language-learning habit app fit the
  Productivity track?"

### Prizes ($1,000,000 total, 20 prizes)
| Prize | Amount | Our fit |
| --- | --- | --- |
| Best New Productivity Experience | $70,000 (runner-up $35,000) | **Primary target** |
| Best Agentic Interaction | $25,000 | **Strong**: spatial AI agent with tools, voice-first |
| Best Reason to Come Back | $25,000 | **Strong**: streaks, spaced repetition, unlocks, memory |
| Best First Five Minutes | $25,000 | **Strong**: voice-guided, no-text onboarding |
| Best Accessibility Forward Experience | $25,000 | **Strong**: voice alternative to every hand action, gaze/dwell, high contrast |
| Boldest Original Concept | $25,000 | **Medium**: finger counting + mixed reality cafe on your real table |
| Judge's Choice (x2) | $20,000 each | Any standout entry |
| Best Social & Multiplayer | $25,000 | **Weak**: only an optional stretch ("Cafe a deux") |
| Gaming / Entertainment tracks | $100k / $50k | Not our track |

### Official special-award definitions (design to these words)
- **Agentic Interaction:** "AI as a core part of the experience, such as spatial agents,
  voice-first interaction, procedural content, and context-aware assistance."
- **Reason to Come Back:** "something to work toward, visible growth between sessions, and a loop
  that draws users back ... built for longevity, not as a one-time demo."
- **First Five Minutes:** "how quickly it explains itself, how it teaches controller-free
  interaction without heavy text, and whether it pays off before the headset comes off."
- **Accessibility Forward:** "voice alternatives to hand interactions, eyes-only navigation for
  limited mobility, high-contrast modes, and inclusive defaults."
- **Boldest Original Concept:** "ideas that couldn't exist elsewhere, where the core loop depends
  on presence, spatial depth, real-world scale, or eyes and hands ... whether the experience
  would fall apart on another platform."

### Judging (all four criteria equally weighted)
1. **Innovation & Creativity:** originality, ambition, track fit; use of Meta device capabilities
   (spatial depth, hands-first, gaze, passthrough, scene understanding, anchors) to encourage
   repeat use.
2. **Experience Design:** intuitive from the start, clear onboarding, rewarding purpose; seated,
   hands-first use. Passthrough must meaningfully change the experience, not just sit behind it.
3. **Technical Implementation:** reliability, hand tracking, gaze, FOV-aware design.
   **Minimum 60 fps on Meta Quest hardware, solid and bug-free.**
4. **Polish & Presentation:** UI/UX, art direction, sound design, text, images, video.
   Video must show "real gameplay that honestly represents the experience"; do not "lean on
   AI-generated video to carry the pitch."

Judging has two stages. **Judges review apps on a Meta Quest 3 or Quest 3S.**

### Hard requirements
- Fully usable with **hands alone**, no controller ever required.
- Design for **seated use**; get users in and out quickly.
- Core experience must be original, **not a thin wrapper** around a third-party service
  (FAQ: wrappers around services such as ChatGPT are "highly discouraged").
- Must run at **60 fps minimum** on Quest 3/3S.
- Follow Meta Start terms, developer policies and an age rating (target 10+ or 13+).
- Third-party assets/code only under their licenses; disclose them.

### What to submit
1. **Playable build:** for IWSDK, a hosted link (Vercel). APKs are not accepted for web
   projects. Must stay live through judging. **No changes after the deadline** (may be
   disqualified).
2. **Demo video:** under 3 minutes, footage from a Quest, XR Simulator or emulator, public on
   YouTube or Vimeo. Best footage first.
3. **Form:** name, 140-character tagline, track, division, description of inspiration, build
   process and future plans (about 500 words), optional hand-interaction description, target
   launch date, team member details.

### Build status (updated Nov 11, 2026, late)
Prize table above re-verified against UploadVR's launch article (Devpost blocks automated
fetches). Top prize reachable for this concept: **$70,000** (Productivity, New). The $100k
prizes are Gaming/Entertainment only; one prize per entry, so special awards are fallbacks.

Done and tested (`npm test`: 33 passing; typecheck and build clean):
- **Phase 1 core:** `src/state/{dates,srs,progression,profile,store}.ts`, v1 progress migration,
  streak, XP/levels A1.1 to A2.2, unlock table, session summary, "last visit" recap.
- **Phase 4 core:** `src/agent/{menu,tools,intent,scenarios,protocol,script,director,agent-client,runtime}.ts`,
  `server/agent-handler.mjs` + `api/agent.mjs` (Anthropic SDK, strict tool use, one round trip,
  per-IP rate limit). The AI proposes tool calls; `applyActions` validates them and corrects any total
  or change amount the model gets wrong. French number words, euro change-making.
- **Phase 2 piece:** `src/voice/pronunciation.ts` (word alignment scoring).
- **Phase 3 piece:** `src/hands/gestures.ts` (finger count, French thumb-first counting, thumbs up/down,
  palm-up, pinch, 400 ms stabilizer; zero allocations). Not yet wired to live XR hand joints.
- **Wired in app and verified in IWER with real hand presses:** name -> "Deux croissants" (2 croissant
  entities pop onto the counter) -> "trois euros quarante" -> pay 5 EUR -> "Je vous rends un euro
  soixante"; pinching an object still shows its word, and Madame Lune reacts with its price.
  Payment currently uses 3 coin choices on the chat panel (stand-in until Phase 3 physical coins).

### Build status, Nov 12, 2026 (top-10 feature build)
All ten winning features are implemented, typechecked, unit-tested (53 tests) and exercised in
the IWER emulator with real hand/controller input:
1. Live finger counting (`src/hands/hand-system.ts`): badge over the hand; head-gaze + raised,
   upright hand held 1 s orders N of the item (pointing poses are ignored, verified).
2. Physical money (`src/interaction/coin-system.ts`): DistanceGrabbable MoveFromTarget; aim at the
   tray and release (or quick tap); change counted back coin by coin. Verified: 5 EUR note for
   3,40 -> "un euro soixante" + 1 EUR/50c/10c coins.
3. Voice (`src/voice/*`, `server/stt-handler.mjs`): push-to-talk (mic button or palm up),
   pronunciation score vs the nearest suggested reply, voice commands, "voila cinq euros" pays.
   Engines: server key (optional) > desktop Web Speech > **on-device Whisper-base in a worker**
   (`src/voice/local-voice-worker.ts`, no key, used by Quest Browser). Madame Lune speaks with the
   browser's French voice, or an on-device MMS-TTS French voice (fp32, measured ~3x faster than
   int8 under WASM) when there is none. Verified in headless Chromium against production:
   synthesized French -> Whisper round trip; fake-mic test of the real MediaRecorder path. Base chosen over tiny: tiny heard "deux croissants" as "2-300".
4. Madame Lune rig + NpcSystem: looks at you / what you look at, lip flap, blinks, emotes, points.
5. Live AI verified with the key: feminine agreement, "vous", amounts copied from the engine,
   warm-up ping, instant scripted greeting, 1.8 to 2.5 s warm turns.
6. Onboarding (`src/world/onboarding-system.ts`): ghost hand, wave -> pinch -> 1 finger -> coin,
   confetti; never blocks (auto-advance), skip by "passer". Dev: Shift+R or `?reset` = new learner.
7. Progression visuals (`src/world/decor-system.ts`): streak candle, unlock pop-ins, chalkboard.
8. Mon Carnet + daily SRS review (`public/ui/carnet.uikitml`, `src/ui/panels-system.ts`).
9. Accessibility: settings panel (verified text size L and high contrast), eyes-only dwell
   (`src/ui/dwell-system.ts`) on every button and object, voice alternatives, left-hand mode.
10. Mixed reality (`src/world/mixed-reality-system.ts`, passthrough, table height) + synthesized
    spatial audio (`src/audio/audio-system.ts`).

Deployed (Nov 12): https://lingo-pal-vr.vercel.app (Vercel team talk-to-my-hand, project
lingo-pal-vr, ANTHROPIC_API_KEY set for all environments). Verified: page 200, COOP/COEP headers,
/api/agent live turn ~2 s, app renders with no console errors. Paste-ready Devpost text and the
video shot list are in SUBMISSION.md; licenses in CREDITS.md (MMS-TTS is CC-BY-NC 4.0).

Glasses check (Nov 12, IWER metaVRGlasses): default layout put the outer halves of both side panels
and the 5/10 EUR notes outside the 37 deg view. Fixed: narrow-FOV layout (panels to -21/+24 deg,
scale 0.85, detected from the XR projection or ?layout=glasses) -> all panel corners inside
(-34..+35 deg); notes moved to the inner side of the dish. Gaze+pinch verified on items and a
reply (either hand); gaze-off hand-ray fallback and gaze priority verified.

Not yet verified (needs a real Quest): fps, hand-joint thresholds (gestures.ts TUNING),
mic + on-device voice speed in Quest Browser, passthrough mode, Meta VR Glasses fit.
Next: Quest device pass, demo video, Devpost form.

---

## 1. Ground rules for this build

1. **Few features, done perfectly, around one memorable moment.** Every feature must serve a
   prize category below or the wow moment. Otherwise cut it.
2. **The game state machine owns the truth; the AI proposes.** The LLM never directly mutates
   the world. It returns tool calls; the client validates them against game state and then
   executes them in the scene. This is what makes us "AI as a core part", not a wrapper.
3. **Everything degrades gracefully.** No key, no network, no mic, no hand tracking: the app
   still works (scripted agent, tap replies, controller/gaze fallback, browser TTS).
4. **60 fps on Quest 3S is a release blocker.** Measure every day.
5. **Test on a real Quest 3/3S from Nov 13 at the latest.** Emulator passing is not enough.
6. **Never commit secrets.** Keys live in `.env` locally and in Vercel environment variables.
7. **Typecheck and build after every phase:** `npm run typecheck && npm run build`.
8. **Deploy early (Phase 0)** and redeploy after every phase so the judge link always works.
9. Use plain ASCII punctuation in UI copy except French accents (the bundled Poppins atlas in
   `src/fonts.ts` covers French characters; add glyphs there if a new language needs them).

---

## 2. The product

**Name:** Lingo Pal VR: Cafe Lune
**Tagline (140 chars max):**
"Your daily French cafe. Order with your voice and fingers, pay in euros, and Madame Lune
remembers you. Hands-only, no controllers."

**The wow moment (open the video with this, first 15 seconds):**
The learner holds up **two fingers** and says **"Deux croissants, s'il vous plait."**
Madame Lune nods, places two croissants on the counter, says "Ca fait trois euros quarante",
the learner **picks up coins and drops them into her hand**, she counts the change out loud in
French, and her line "A demain, Pranav !" shows she remembers him.

**Daily loop (10 minutes, seated):**
1. Bonjour ritual: Madame Lune greets you by name and recalls yesterday.
2. Warm-up: 3 spaced-repetition words from your weak list (pinch or say them).
3. Order of the day: an AI-generated "Plat du jour" scenario (cafe, boulangerie, marche).
4. Pay and count change (numbers practice with real coin objects).
5. Streak, XP, unlock (new decor, new menu item, new location).

---

## 3. Category coverage matrix (what earns each prize, and where judges will see it)

| Prize | Features that earn it | Where judges see it |
| --- | --- | --- |
| Productivity (New) $70k | Daily 10-min habit loop, measurable progress, spaced repetition, "Carnet" word book | Video 0:15-1:30, write-up "Daily moment" section |
| Agentic Interaction | Madame Lune as a spatial agent with tools (place items, quote price, give change, start quiz, remember facts), voice-first, procedurally generated daily scenario, context-aware hints from where you look and what you hold | Video 0:00-0:45, write-up "How the agent works" |
| Reason to Come Back | Streak flame, XP and CEFR level badge (A1 -> A2), spaced repetition, unlockable cafe upgrades and locations, she remembers you between sessions | Video 1:30-2:00, in-app "Carnet" panel |
| First Five Minutes | Zero-text onboarding, ghost-hand demonstrations, first successful order in under 2 minutes, celebratory payoff | Video 2:00-2:20, first launch for every judge |
| Accessibility Forward | Every hand action has a voice alternative; gaze + dwell selection for eyes-only use; high-contrast mode; text size; subtitles always on; slow-speech toggle; seated by default; left-hand mode | Settings panel, video 2:20-2:40 |
| Boldest Original Concept | Finger counting with real hand joints, physically paying with coins, optional mixed-reality mode that puts the counter on your real table | Video 0:00 hook + MR clip |
| Judge's Choice | Overall craft | Everything |
| Social & Multiplayer | Optional stretch only (Phase 11) | Only if finished |

---

## 4. Architecture

### Existing (v1, working)
| File | Role |
| --- | --- |
| `src/vocab.ts` | 12 words, tips, positions, 5 missions |
| `src/cafe-builder.ts` | Procedural cafe, items, Madame Lune |
| `src/item-system.ts` | Pinch, hover glow, bounce, mission ring |
| `src/lesson-system.ts` | Lesson panel, missions, score, streak |
| `src/chat-system.ts`, `src/shopkeeper.ts` | AI chat with 3 pinchable replies, offline script |
| `src/speech.ts` | Browser TTS (fallback) |
| `src/fonts.ts` | Poppins with French glyphs for panels |
| `server/agent-handler.mjs`, `api/agent.mjs` | Server AI route (dev + Vercel); legacy /api/chat removed |

### New modules to add
```
src/
  state/
    store.ts            # single game state (profile, session, inventory, orders) + events
    progression.ts      # XP, levels, streak, unlocks
    srs.ts              # spaced repetition (SM-2 lite) over the word bank
    profile.ts          # persistence: localStorage now, optional server sync later
  agent/
    tools.ts            # tool schema + client-side validators/executors
    agent-client.ts     # POST /api/agent, timeouts, fallback to script
    script.ts           # offline scripted agent (extends current shopkeeper.ts)
    scenarios.ts        # daily scenario templates (cafe, boulangerie, marche)
  voice/
    mic.ts              # getUserMedia + MediaRecorder push-to-talk, VAD-lite
    stt-client.ts       # POST /api/stt
    tts-client.ts       # POST /api/tts with cache, fallback to speech.ts
    pronunciation.ts    # compare transcript vs target, per-word scores
  hands/
    gestures.ts         # finger count, thumbs up, wave, palm-up (push-to-talk)
    hand-system.ts      # ECS system that emits gesture events with debounce
  interaction/
    coins.ts            # coin objects, tray zone, payment counting
    handoff.ts          # grab item and hand it to Madame Lune (drop zone)
  world/
    npc-system.ts       # Madame Lune animation: look-at, talk mouth flap, nod, gestures
    audio-system.ts     # ambient cafe loop, spatial SFX
    mr-mode.ts          # optional passthrough + plane placement
  ui/
    settings-system.ts  # accessibility settings
    carnet-system.ts    # word book panel
    onboarding-system.ts
server/
  agent-handler.mjs     # LLM with tools, JSON validation
  stt-handler.mjs       # speech-to-text provider
  tts-handler.mjs       # text-to-speech provider + cache headers
api/
  agent.mjs, stt.mjs, tts.mjs   # Vercel functions wrapping the handlers
public/
  models/ (CC0 glTF)   audio/ (CC0)   ui/*.uikitml
```

### Agent design (the heart of the Agentic prize)
- Server route `/api/agent` receives: `profile` (name, level, weak words, last visit summary),
  `scene` (items on counter, what the learner is holding, what they look at, money on tray),
  `event` (utterance transcript, gesture, item shown), and recent turns.
- The LLM (Anthropic Messages API with tool use; default model `claude-haiku-5-5`, configurable
  via `AGENT_MODEL`) must answer with:
  - `say`: { fr, en } short line (max 18 words)
  - `tools`: zero or more of:
    - `place_items(itemId, quantity)`
    - `quote_price(total_cents)`
    - `give_change(cents)`
    - `start_quiz(wordIds[])`
    - `praise(reason)` / `correct(expected, heard, tip)`
    - `remember(key, value)` (name, favorite order, goal)
    - `set_scenario(scenarioId)`
    - `suggest_replies([{fr,en} x3])`
  - `points`: 0 to 20
- Client validates every tool call against `store.ts` (item exists, quantity 1 to 5, price
  matches menu, change is correct) before executing; invalid calls are dropped and logged.
- Prices, change math and inventory are computed deterministically in code; the AI only
  narrates and chooses actions.
- Latency budget: show a "thinking" nod + filler line ("Alors...") if no answer in 700 ms;
  hard timeout 8 s, then fall back to `script.ts`.

### Voice pipeline
- Push-to-talk, hands-first: **palm-up gesture** or **pinch-and-hold the mic bubble** starts
  recording; release stops. Voice alternative: always-listening is off by default (privacy).
- `mic.ts`: getUserMedia({ audio: true }) + MediaRecorder (webm/opus), max 6 s, simple energy
  VAD to trim silence. **Day-1 gating test:** confirm mic permission and MediaRecorder work in
  Quest Browser during an immersive session. If not, fall back to pinchable replies only.
- `/api/stt`: send audio to a speech-to-text provider with `language=fr` (for example OpenAI
  Whisper API or Deepgram; check current model names and pricing before choosing). Return
  transcript + word timings if available.
- `pronunciation.ts`: normalize (lowercase, strip accents for matching, keep originals for
  display), align transcript words to the expected phrase (Levenshtein per word), produce a
  0 to 100 score and highlight missed words. For deeper scoring, an option is Azure Speech
  pronunciation assessment (verify availability for fr-FR first).
- `/api/tts`: natural French voice (for example ElevenLabs or OpenAI TTS; verify current
  voices and terms), cache by text hash (in-memory server cache + `Cache-Control`), client
  caches as object URLs. Fallback: `speech.ts`.
- Subtitles always shown for every spoken line (accessibility and judges with sound off).

### Hand gestures (WebXR hand joints)
- Read joint poses each frame from IWSDK hand input; if not exposed, use
  `xrFrame.getJointPose(hand.get(jointName), referenceSpace)` on `XRHand`.
- Finger extended test: tip-to-wrist distance vs. proximal-to-wrist distance ratio, plus
  angle at PIP joint. Count extended fingers 0 to 5 on each hand (sum for 6 to 10).
- Gestures: count (1 to 10), thumbs up (oui), thumbs down (non), open-palm wave (bonjour /
  au revoir), palm up (push-to-talk).
- Debounce: gesture must hold 400 ms; show a small finger-count badge above the hand so the
  learner sees what was detected.
- Allocate all vectors in `init()`; zero allocations per frame.

---

## 5. Phases (Nov 12 to Nov 18)

Each phase lists goals, tasks, acceptance checks and a ready-to-paste Claude Code prompt.
**Cut lines** are marked; if behind schedule, drop items below the cut line, never the
Phase 9 and 10 essentials.

### Phase 0: Setup, deploy, device check (Nov 12 morning, 2 to 3 hours)
Tasks
- `npm install`, `npm run dev`, confirm v1 works in the emulator.
- `git init`, first commit, push to a **new private GitHub repo** `lingo-pal-vr`. Done 2026-11-15: https://github.com/pranavsaji/lingo-pal-vr (private; full history, first commit c52ca52 2026-11-12).
- Deploy to Vercel now (`vercel`, `vercel env add ANTHROPIC_API_KEY`, `vercel --prod`).
- Open the Vercel URL on a Quest 3/3S (borrow/buy). Record fps with the Quest browser
  performance overlay or `metavr` CLI, check hand-ray pinch on the panels (v1 open issue).
- Run the **mic gating test** on the Quest (tiny test page: button -> getUserMedia ->
  MediaRecorder 3 s -> play back).
- Email the hackathon manager the Productivity-track question.
Acceptance
- [ ] Public Vercel link loads on Quest and enters VR.
- [ ] Hand pinch works on objects and panels on device (fix now if not: increase panel
      `RayInteractable` hit area or add `PokeInteractable` + larger buttons).
- [ ] Mic test result recorded in this file (works / does not work).
Prompt
> Read PLAN.md sections 0 to 4. Set up git, add a `.gitignore` check for `.env`, create a
> minimal `public/mic-test.html` page that records 3 seconds with MediaRecorder and plays it
> back, deploy with Vercel, and give me the exact commands. Do not change gameplay code.

### Phase 1: State, progression and memory core (Nov 12, afternoon)
Goals: one store for everything; persistence; XP/levels/streak; SRS.
Tasks
- `state/store.ts`: profile { name, level, xp, streakDays, lastPlayedDay, wordsSeen,
  srs map, memories {key: value}, unlocks[], settings }, session state, menu with prices
  in cents, inventory on counter, tray money.
- Migrate `game-state.ts` progress into `store.ts`; keep the event bus.
- `state/srs.ts`: SM-2 lite (ease 1.3 to 2.5, intervals 1, 3, 7, 14 days) per word; "due"
  list for the warm-up.
- `state/progression.ts`: XP per action (word heard 2, mission 10, correct spoken phrase 15,
  order completed 25, correct payment 20), levels A1.1 -> A1.2 -> A1.3 -> A2.1 with
  thresholds, unlock table (decor items, new menu items, boulangerie, marche).
- Name capture: first session, Madame Lune asks "Comment vous appelez-vous ?"; learner says
  or picks a name (voice or a big letter-free choice: "Je m'appelle ..." with 3 name options
  + "Autre").
Acceptance
- [ ] Reload keeps XP, level, streak, memories, SRS state.
- [ ] Unit-style checks for srs.ts and progression.ts (simple `node --test` file or vitest).
Prompt
> Implement Phase 1 of PLAN.md exactly. Create src/state/{store,progression,srs,profile}.ts,
> migrate existing progress logic, keep all current features working, add small tests for
> SRS intervals and XP thresholds, then run typecheck and build.

### Phase 2: Voice (Nov 12 night to Nov 13)
Goals: speak French, get understood, get scored; natural TTS.
Tasks
- `voice/mic.ts`, `voice/stt-client.ts`, `server/stt-handler.mjs`, `api/stt.mjs`.
- Mic bubble UI near Madame Lune (pinch-and-hold), plus palm-up gesture (Phase 3 wires it).
- `voice/pronunciation.ts` with per-word scoring; show green/orange/red words on the panel;
  Madame Lune reacts ("Presque ! On dit crois-SANT").
- `voice/tts-client.ts`, `server/tts-handler.mjs`, `api/tts.mjs` with caching; replace all
  `speakFrench` calls with a `say()` that uses TTS first, browser voice as fallback.
- Subtitles panel under Madame Lune for every spoken line (fr + en).
Acceptance
- [ ] On Quest: hold, say "Un cafe, s'il vous plait", see transcript + score within 2.5 s.
- [ ] TTS voice plays; repeated lines play instantly from cache.
- [ ] With keys removed, the app still works (browser TTS, pinch replies).
Prompt
> Implement Phase 2 of PLAN.md. Add push-to-talk recording, a server STT route
> (provider configurable by env STT_PROVIDER, default openai-whisper), pronunciation scoring,
> and a server TTS route with caching. Never expose keys to the client. Keep offline
> fallbacks. Typecheck, build, and list manual test steps for the Quest.

### Phase 3: Hands-first signature mechanics (Nov 13 to Nov 14 morning)
Goals: finger counting, gestures, handing items over, paying with coins.
Tasks
- `hands/gestures.ts` + `hands/hand-system.ts` (see design above), on-hand count badge.
- Order with fingers: holding up N fingers while ordering sets quantity N (works with voice
  or with pinch replies).
- Thumbs up = "oui", thumbs down = "non", wave = greet/leave.
- `interaction/handoff.ts`: make menu items grabbable (`OneHandGrabbable` or
  `DistanceGrabbable`, check IWSDK skill `iwsdk-grab`), a glowing tray zone in front of
  Madame Lune; dropping an item there "shows/gives" it to her; items return to rest when
  released elsewhere.
- `interaction/coins.ts`: coin and note objects (2 EUR, 1 EUR, 50c, 20c, 10c) in a small dish
  next to the learner; drag to the tray; store sums cents deterministically; Madame Lune
  counts the total and change aloud.
Acceptance
- [ ] On Quest: 1 to 5 fingers detected reliably (>90% in 20 tries), shown on the badge.
- [ ] Full wow moment works end to end without controllers.
- [ ] Still 60+ fps with hands tracked (check).
Prompt
> Implement Phase 3 of PLAN.md. Use the iwsdk-grab and iwsdk-ray project skills for
> grabbing and drop zones. Build finger counting from WebXR hand joints with debouncing and
> zero per-frame allocations, coins and payment with deterministic math, and the
> item-to-tray handoff. Then script an emulator test that runs the wow moment.

### Phase 4: Agentic Madame Lune (Nov 14)
Goals: tool-using spatial agent with memory and daily scenarios.
Tasks
- `server/agent-handler.mjs` + `api/agent.mjs` with the tool schema above; strict JSON
  validation; system prompt includes level, weak words, memories, scenario, scene snapshot.
- `agent/tools.ts`: validators + executors that call store and scene systems.
- `agent/scenarios.ts`: Cafe (default), Boulangerie (unlock A1.2), Marche (unlock A1.3);
  "Plat du jour" generated daily by the agent from the menu (seeded by date so it is stable
  for the day).
- Context awareness: send what the learner is looking at (gaze/head ray hit) and holding;
  Madame Lune offers hints ("Vous regardez le fromage ? C'est du comte.").
- `world/npc-system.ts`: look-at head turn, mouth flap while TTS plays (amplitude from an
  AnalyserNode), nod on correct, small shrug on wrong.
- Extend `script.ts` so offline mode covers the full order -> pay -> change flow.
Acceptance
- [ ] Agent places exactly the requested quantity, quotes the right price, gives correct
      change; invalid tool calls are rejected (add a test with bad calls).
- [ ] Second session: she greets by name and references the last order.
- [ ] p50 agent latency under 1.5 s on Wi-Fi, filler animation covers waits.
Prompt
> Implement Phase 4 of PLAN.md: tool-using agent route, client validators/executors,
> scenarios, context snapshot (gaze target, held item, tray), NPC animation, and an
> extended offline script. The game state machine must stay authoritative. Add tests for
> tool validation and change math.

### Phase 5: First Five Minutes (Nov 15 morning)
Goals: zero-text onboarding with a payoff before 2 minutes.
Tasks
- `ui/onboarding-system.ts`: Madame Lune speaks; a translucent **ghost hand** animates the
  pinch, then the finger count, then palm-up talk. Each step advances when the learner does
  it (no "Next" buttons).
- Step order: wave hello (she waves back) -> pinch the croissant (hear it) -> say "Bonjour"
  -> order 1 croissant with 1 finger -> pay with one coin -> celebration (confetti, chime,
  first badge, streak day 1).
- Skip by saying "passer" or pinching a small skip chip. Never show a text wall.
Acceptance
- [ ] A new person (not you) completes onboarding in under 2 minutes without help.
- [ ] Onboarding only runs once (re-run from settings).
Prompt
> Implement Phase 5 of PLAN.md: gesture-gated onboarding with ghost-hand demonstrations,
> spoken guidance, and a payoff in under 2 minutes. No instruction text walls.

### Phase 6: Reason to Come Back (Nov 15 afternoon)
Tasks
- Streak flame on the counter (grows with days), XP bar + level badge on the lesson panel.
- `ui/carnet-system.ts`: "Mon Carnet" panel: words collected, mastery dots from SRS, tap to
  hear.
- Unlocks: visible cafe upgrades (plants, string lights, a chalkboard menu that shows
  "Plat du jour"), new locations by level.
- Session end summary: "Aujourd'hui: 6 mots, 2 commandes, 92% prononciation. Revenez demain
  pour la boulangerie !"
Acceptance
- [ ] Visible difference between session 1 and session 3 (screenshot both for the video).
Prompt
> Implement Phase 6 of PLAN.md using the Phase 1 store: streak flame, XP/level UI, Carnet
> panel, unlockable decor and locations, and an end-of-session summary.

### Phase 7: Accessibility Forward (Nov 15 evening)
Tasks
- `ui/settings-system.ts` panel (open by palm-up long hold or saying "reglages"):
  high contrast, text size (S/M/L), speech speed (slow/normal), subtitles (always on by
  default), left-hand mode, gaze + dwell selection (eyes-only), reduce motion.
- Voice alternative for every hand action: "je choisis le croissant", "deux", "oui",
  "je paie", "repeter", "aide".
- Gaze + dwell (1.0 s ring fill) as an eyes-only selection path; use IWSDK gaze tracking
  with head-ray fallback (`world.xr.features.gazeTracking`, see `.claude/skills/iwsdk-glasses-test`).
- Color-blind-safe feedback (shape + color, not color alone).
Acceptance
- [ ] Complete the wow moment using only voice + gaze (no hands).
- [ ] High-contrast mode readable in a screenshot at 50% size.
Prompt
> Implement Phase 7 of PLAN.md: settings panel, voice commands for every hand action,
> gaze+dwell eyes-only selection, high contrast, text size, slow speech, left-hand mode.

### Phase 8: Polish: art, audio, performance (Nov 16)
Tasks
- Replace primitive food/furniture with CC0 glTF models (check license on each: for example
  Kenney or Quaternius packs, or Poly Pizza items marked CC0). Compress (glTF transform,
  KTX2 textures), keep total download under 15 MB.
- Ambient cafe loop + SFX (cup clink, coin drop, register ding, success chime) from CC0
  sources; spatialize via IWSDK `AudioSource`.
- Lighting pass, warm palette, contact shadows, Madame Lune outfit details.
- Performance: draw calls under 100, triangles under 150k, no per-frame allocation; verify
  60+ fps (target 72) on Quest 3S in the busiest moment (agent talking + hands + coins).
- `CREDITS.md` listing every third-party asset and license.
Acceptance
- [ ] 72 fps steady on Quest 3S in the wow moment; never below 60.
- [ ] Cohesive look in a screenshot; no placeholder primitives in the hero view.
Prompt
> Implement Phase 8 of PLAN.md: swap in CC0 models and audio (list licenses in CREDITS.md),
> compress assets, lighting pass, and a performance pass with measured fps on device.

**Cut line A:** if behind schedule on Nov 16 evening, skip Phase 9 MR and go to Phase 10.

### Phase 9: Boldest Concept and Meta VR Glasses (Nov 16 evening, optional)
Tasks
- `world/mr-mode.ts`: AR/passthrough mode (IWSDK `xr.mode: "ar"`, scene understanding /
  plane detection) that places the counter and Madame Lune on your **real table**; food
  sits on your real surface. Toggle from settings. Must meaningfully change the experience
  (order happens on your own table), not just a background.
- Meta VR Glasses readiness: run `.claude/skills/iwsdk-glasses-test`, enable
  `fieldOfViewMask`, keep all critical UI inside the glasses' view (37 deg left/right,
  25 deg up, 43 deg down), gaze + pinch on every control.
Acceptance
- [ ] MR mode works in two different rooms on device.
- [ ] Glasses emulator test passes with all controls reachable.
Prompt
> Implement Phase 9 of PLAN.md: optional passthrough mode with plane placement, and Meta VR
> Glasses readiness using the iwsdk-glasses-test skill. Keep VR mode the default.

### Phase 10: Hardening, video, submission (Nov 17 to Nov 18 9 a.m.) NEVER CUT
Tasks
- Bug bash on Quest: 3 testers, 10 minutes each, note every stuck point; fix top 5.
- Error handling: every network call has timeout + fallback; no unhandled rejections in logs.
- Final deploy to Vercel production; verify on Quest 3 **and** 3S; confirm the link works in
  a fresh browser profile.
- **Freeze code Nov 18, 9:00 a.m. PST.** Tag `v1.0-submission`. No pushes after submission.
- Video (2:45 max), recorded on Quest (casting/recording) plus emulator for close-ups:
  - 0:00 to 0:15: the wow moment (fingers + voice + coins + "A demain, Pranav !")
  - 0:15 to 0:45: agent: she reacts to what you look at and hold, tool actions visible
  - 0:45 to 1:30: daily loop: warm-up SRS, plat du jour, pronunciation feedback
  - 1:30 to 2:00: come-back loop: streak, level, Carnet, unlocks (session 1 vs 3)
  - 2:00 to 2:20: first five minutes (ghost hand onboarding)
  - 2:20 to 2:40: accessibility (voice-only + gaze-only order, high contrast)
  - 2:40 to 2:45: title card, link, "Built with Immersive Web SDK"
  - Real footage only; no AI-generated video. Subtitles burned in.
- Devpost form: name, tagline, track Productivity, division New Experience, description
  (template in section 8), hand-interaction description, target launch date (Dec 2026 web
  launch), team member (Pranav Saji, solo developer).
- Screenshots: hero cafe, wow moment, Carnet, high contrast, MR mode.
Acceptance
- [ ] Submitted before Nov 18, 11:00 a.m. PST (one hour buffer).
- [ ] Link, video (public), and form all verified in a logged-out browser.

### Phase 11: Social & Multiplayer stretch (only if everything above is done)
- "Cafe a deux": two learners join by a 4-letter code (WebRTC data channel via a tiny
  signaling route), see each other's avatar hands, take turns ordering. Low priority: one
  prize per entry and this category is our weakest fit.

---

## 6. Day-by-day schedule

| Day | Morning | Afternoon | Evening |
| --- | --- | --- | --- |
| Wed Nov 12 | Phase 0 | Phase 1 | Phase 2 start |
| Thu Nov 13 | Phase 2 finish (device test) | Phase 3 | Phase 3; Start support case if not approved |
| Fri Nov 14 | Phase 3 finish | Phase 4 | Phase 4 |
| Sat Nov 15 | Phase 5 | Phase 6 | Phase 7 |
| Sun Nov 16 | Phase 8 | Phase 8 + device perf | Phase 9 (cut line A) |
| Mon Nov 17 | Bug bash with 3 testers | Fixes + final deploy | Record + edit video, write-up |
| Tue Nov 18 | Final checks, **freeze 9:00 a.m.**, submit by 11:00 a.m. | Do not touch the build | |

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Start membership not approved by Nov 18 | Medium | Fatal | Support case Nov 13; forum post; keep Firebase hackathon as backup |
| Mic or MediaRecorder blocked in Quest Browser XR | Medium | High | Day-1 test; fallback pinch replies + finger counting still deliver the wow moment |
| Hand-ray pinch on UIKit panels unreliable on device | Medium | High | Bigger buttons, PokeInteractable, gaze+pinch path, test Nov 12 |
| Agent latency > 2 s | Medium | Medium | Haiku-class model, short prompts, filler animation, TTS cache, script fallback |
| Below 60 fps | Medium | High | Daily perf checks, instancing, compressed assets, cut MR mode |
| Judged as "AI wrapper" | Low | High | Deterministic game core, tools validated client-side, write-up section explaining it |
| API cost spike during judging | Low | Medium | Rate limit per IP, max tokens 400, TTS cache, monthly cap on provider |
| Scope creep | High | High | Cut lines; Phase 10 never cut |

---

## 8. Devpost write-up template (about 500 words)

**Inspiration.** I built Lingo Pal, a French learning app, in October 2026. The hardest part of
learning a language is speaking it in a real moment, like ordering a coffee. Lingo Pal VR turns
that daily moment into a 10-minute habit you can do seated with only your hands and voice.

**What it does.** (wow moment in two sentences) ... daily loop ... progression ... accessibility.

**How the agent works.** Madame Lune is a spatial AI agent. A deterministic game core owns the
menu, prices, inventory and money; the model proposes tool calls (place items, quote price,
give change, start quiz, remember) that the client validates before acting in 3D. She sees what
you look at and hold, remembers you between sessions, and generates a daily scenario.

**Hands-first design.** Finger counting from WebXR hand joints, pinch to select, grab and hand
items over, pay with coins, palm-up to talk. Every action also works by voice or gaze.

**How we built it.** Immersive Web SDK 1.x (Three.js + ECS), hand tracking, spatial UI
(UIKitML), server routes for speech-to-text, text-to-speech and the agent; offline fallbacks.

**Challenges.** French glyphs in MSDF fonts, low-latency voice in WebXR, robust finger counting.

**What's next.** Spanish and more scenes, Meta VR Glasses launch, shared cafe sessions.

**Hand interactions (optional field).** List each gesture and its fallback.

---

## 9. Final submission checklist

- [ ] Start membership approved (flair visible on the Developer Forum)
- [ ] Track Productivity, division New Experience
- [ ] Hosted link works on Quest 3 and 3S, logged out, first click
- [ ] 60+ fps everywhere; no console errors
- [ ] Fully usable with hands only; also voice-only and gaze-only paths
- [ ] Video under 3:00, public, real footage, wow moment in first 15 s
- [ ] Description, tagline (<=140 chars), hand-interaction text, launch date, team info
- [ ] CREDITS.md with all asset licenses; no secrets in the repo
- [ ] Repo tagged `v1.0-submission`; no changes after the deadline
- [ ] Keep Vercel and API keys active until winners are announced (about Dec 11)
