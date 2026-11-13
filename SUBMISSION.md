# Devpost submission kit

Paste-ready text for the Devpost form, plus the demo video shot list. Everything here
describes features that exist in the build at https://lingo-pal-vr.vercel.app.
Re-read it after the Quest device pass and remove anything that did not hold up on device.

## Form fields

- **Project name:** Lingo Pal VR: Cafe Lune
- **Tagline (≤140 chars):** A daily French café on your real table. Order with fingers and voice, pay in euros; proactive AI shopkeepers remember you.
- **Track / division:** Productivity, New Experience
- **Playable link:** https://lingo-pal-vr.vercel.app
- **Target launch:** December 2026, public web (Quest Browser)
- **Team:** Pranav Saji (Pranav Innovates), solo developer

## Description (about 600 words)

**Inspiration.** The hardest part of learning a language is speaking it in a real moment,
like ordering a coffee, with someone waiting for your answer. Apps teach words; they rarely
make you use them. Lingo Pal VR turns that moment into a ten-minute daily habit you can do
seated, with only your hands, your eyes and your voice.

**What it does.** You sit at Madame Lune's café counter in Paris. Look at the croissants,
hold up two fingers and say "Deux croissants, s'il vous plaît": she serves two croissants
and tells you the price in French. Pick up a 5 € note, drop it on her tray, and she counts
your change back out loud. Every reply you speak gets a pronunciation score. Three shops
(café, boulangerie, marché), each with its own shopkeeper, menu and words, and a daily
shopping list across Paris.

**An agent, not a chatbot.** The shopkeepers are spatial AI agents built on Claude with
strict tool use. A deterministic game core owns the menu, prices and every calculation;
the model proposes actions (serve, quote, give change, offer a substitute, remember a fact)
and the client validates each one before it happens in 3D. They are proactive: they notice
when you hesitate or keep looking at an item and offer a hint scaled to your level; they
remember your mistakes ("Lune note : deux ≠ douze") and reuse those words on purpose; when
an item runs out they propose a substitute; once you are doing well they sometimes give
you the wrong change on purpose to see if you catch it; and at goodbye they plan
tomorrow's shopping list around your weakest words. Hints run locally with no extra AI call.

**Your real table.** In mixed reality the café comes to your room: plane detection finds
your real table or desk and the counter snaps onto it; you can move it with a pinch or by
saying "ici", and a persistent spatial anchor brings it back to the same spot tomorrow.
With Quest 3 depth sensing your real hands pass in front of the virtual croissants.

**Come back tomorrow.** Streaks with earned rest days, XP and levels from A1 to A2, a
Passeport de Paris with twelve stamps, spaced-repetition word review, a café that visibly
changes as you progress, a "Bon retour !" summary of what changed since your last visit,
a teaser for tomorrow, and "Ma semaine", a weekly report.

**First five minutes.** A branded page appears instantly with a real loading bar. Madame
Lune asks how you want to play: hands, eyes or voice. A ghost hand and her voice teach
four moves (wave, pinch, count, pay) with one pictogram each and almost no text; the
first order and confetti arrive in about a minute.

**Accessible by default.** Every hand action has a voice alternative and an eyes-only
alternative (look for one second), including paying ("je paie"). Global voice commands
open every panel. Subtitles on, high contrast that also reaches 3D labels and coins, text
size, slow speech, left-handed layout, reduced motion, hands-free voice. Seated, and it
also fits the narrower view of Meta VR Glasses with gaze and pinch.

**Café à deux.** Invite a friend with a private link or QR code: they join from a second
headset or simply a laptop or phone browser, appear across the counter with head and hands,
talk over spatial voice chat, and take turns ordering on one shared tray. Peer to peer, no
accounts.

**How we built it.** Meta's Immersive Web SDK (three.js and an entity-component system),
WebXR hand tracking, gaze, plane detection, anchors, depth sensing, UIKitML spatial panels.
Shopkeepers and customers are Microsoft Rocketbox avatars (MIT) animated procedurally;
food and rooms are photo scans (CC0 and CC-BY). Claude and natural French voices (Inworld)
run on Vercel serverless routes behind rate limits and daily budgets; keys never reach the
headset. On-device Whisper is the speech fallback. Per-frame work is measured and kept low
(about 2 ms of app logic per frame).

**What's next.** More cities (Madrid, Rome), a teacher mode, and launch on the Meta
Horizon Store as a PWA.

## Judge quick start

- Fresh first launch: https://lingo-pal-vr.vercel.app/?reset
- A week of progress in one click (labelled DEMO): https://lingo-pal-vr.vercel.app/?demo=week
  (your own progress is backed up first; `?restore` brings it back)
- Mixed reality: press "Dans ma pièce" on the start page (Quest 3: set up your room first)
- Café à deux: Paris map → "Inviter un ami", then open the shown link on a laptop or phone

## Hand interactions (optional field)

| Gesture | What it does | Alternative |
| --- | --- | --- |
| Look at an item + hold up 1 to 5 fingers | Orders that many | Say it, or pinch a suggested reply |
| Pinch | Select a reply, button or item | Look at it for 1 second (eyes-only mode) |
| Pinch-grab a coin or note, release over the tray | Pay | Say "je paie" or "voilà cinq euros", or look at a coin for 1 second |
| Point at your real table and pinch (mixed reality) | Place the café there | Say "ici" |
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
