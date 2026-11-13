# Devpost submission kit

Paste-ready text for the Devpost form, plus the demo video shot list. Everything here
describes features that exist in the build at https://lingo-pal-vr.vercel.app.
Re-read it after the Quest device pass and remove anything that did not hold up on device.

## Form fields

- **Project name:** Lingo Pal VR: Cafe Lune
- **Tagline (≤140 chars):** Your daily French cafe. Order with your voice and fingers, pay in euros, and Madame Lune remembers you. Hands-only.
- **Track / division:** Productivity, New Experience
- **Playable link:** https://lingo-pal-vr.vercel.app
- **Target launch:** December 2026, public web (Quest Browser)
- **Team:** Pranav Saji (Pranav Innovates), solo developer

## Description (about 500 words)

**Inspiration.** The hardest part of learning a language is speaking it in a real moment,
like ordering a coffee, with someone waiting for your answer. Apps teach words; they rarely
make you use them. Lingo Pal VR turns that moment into a ten-minute daily habit you can do
seated, with only your hands and your voice.

**What it does.** You sit at Madame Lune's cafe counter in Paris. Look at the croissants,
hold up two fingers and say "Deux croissants, s'il vous plaît": she serves two croissants
and tells you the price in French. Pick up a 5 € note, drop it on her tray, and she counts
your change back coin by coin, out loud. Every reply you speak gets a pronunciation score
with the words to practise. Each visit adds to your streak, XP and level (A1.1 to A2.2),
new words go into your Carnet with spaced-repetition review, and the cafe changes as you
progress: string lights, plants, a daily-special chalkboard, a gramophone.

**A small Paris to explore.** Three shops on a Paris map, each with its own realistic
shopkeeper, menu, prices and words: Café Lune (Madame Lune), La Boulangerie (Monsieur
Paul, croissants and éclairs) and Le Marché (Madame Rose, fruit and vegetables in a
covered market). The bakery opens after the tutorial and the market after your first paid
order, so a first visit sees all three within minutes. Say "allons au marché" or pinch
"Paris" to travel.

**How the agent works.** Madame Lune is a spatial AI agent built on Claude with strict
tool use. A deterministic game core owns the menu, the prices, the money and every
calculation. The model proposes actions (serve items, quote the total, give change,
start a quiz, remember a fact about you, emote, point at an item) and the client
validates each one before it happens in 3D, so she can never charge the wrong price or
invent change. She knows what you are looking at and holding, remembers your name and
details between visits, and every day brings a different "plat du jour" challenge. If
the network drops, a built-in offline script keeps the cafe working.

**Hands-first design.** Finger counting from WebXR hand joints, pinch to select, grab and
release coins, palm up to talk, wave to say hello. Every hand action has a voice
alternative ("répéter", "plus lentement", "réglages", "voilà cinq euros") and a gaze
alternative (look at a button for one second), so the app also works eyes-only and
voice-only.

**Accessibility.** Subtitles in French and English are always on. Settings for high
contrast, text size, slow speech, left-handed layout, reduced motion and eyes-only dwell
selection. Seated by default.

**How we built it.** Meta's Immersive Web SDK (three.js plus an entity-component system),
WebXR hand tracking, UIKitML spatial panels and synthesized spatial audio. Realistic
shopkeepers are Microsoft Rocketbox avatars (MIT) animated procedurally (look-at, lip
movement, blinks, gestures, pointing); food, props, surfaces and 360° photo environments
with image-based lighting are Poly Haven scans (CC0), optimized to stay within a Quest
frame budget. Each shop's menu and prices live in one data file shared by the app and the
AI server. Claude runs on a Vercel serverless route; the key
never reaches the headset. Speech recognition (Whisper) and, when the browser has no
French voice, Madame Lune's voice run on the headset itself in a Web Worker, so voice works
in Quest Browser with no extra service. Optional mixed reality mode puts the counter in
your room with passthrough.

**Challenges.** Counting fingers reliably without false orders (we require a raised,
upright hand and a gaze target). Paying with physical coins while seated (aim-and-release
onto the tray). Keeping the AI fast (about 2 seconds per turn) and keeping all money
arithmetic out of the model. Getting voice into Quest Browser, which has no speech
recognition, without blocking the 72 fps frame loop.

**What's next.** Spanish and Italian cafes, a market and a bakery scene, Meta VR Glasses
support tuned for gaze and pinch, and "Café à deux" for practising with a friend.

## Hand interactions (optional field)

| Gesture | What it does | Alternative |
| --- | --- | --- |
| Look at an item + hold up 1 to 5 fingers | Orders that many | Say it, or pinch a suggested reply |
| Pinch | Select a reply, button or item | Look at it for 1 second (eyes-only mode) |
| Pinch-grab a coin or note, release over the tray | Pay | Say "voilà cinq euros" |
| Palm up / lower palm | Start / stop talking | Pinch "Parler" |
| Wave | Say hello (tutorial step 1) | Say "bonjour" |
| Thumbs up | Agree | Say "oui" |

## Demo video shot list (2:45 max, real footage only)

Record on Quest (Meta Quest casting or the built-in recorder) and add emulator close-ups.
Burn in subtitles. Open `?reset` once beforehand to film the first-run tutorial.

| Time | Shot |
| --- | --- |
| 0:00–0:15 | Wow moment: look at croissants, two fingers, "Deux croissants, s'il vous plaît", she serves, quotes "trois euros quarante", drop the 5 € note on the tray, change counted back aloud |
| 0:15–0:45 | Agent: she points at what you look at, remembers your name, tool actions visible (served items, total on the register display) |
| 0:45–1:30 | Daily loop: plat du jour, pronunciation score with words to practise, Carnet review |
| 1:30–2:00 | Come-back loop: streak candle, XP bar, level up, decor unlocks (session 1 vs session 3) |
| 2:00–2:20 | First five minutes: ghost-hand tutorial (wave, pinch, count, pay), confetti |
| 2:20–2:40 | Accessibility: eyes-only dwell order, voice commands, high contrast, large text |
| 2:40–2:45 | Title card, link, "Built with Immersive Web SDK" |

## Before you press Submit

- [ ] Membership approved (Meta VR Start)
- [ ] Link opens on Quest 3 and 3S in a logged-out browser; Enter VR works
- [ ] Video public, under 3:00
- [ ] Screenshots: hero cafe, wow moment, Carnet, high contrast, mixed reality
- [ ] Anthropic console spend limit set; keep the Vercel project and key live until winners
      are announced (about Dec 11)
