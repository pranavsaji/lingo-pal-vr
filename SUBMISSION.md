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

## Description (about 750 words)

**Inspiration.** The hardest part of learning a language is speaking it in a real moment,
with someone waiting for your answer. Apps teach words; they rarely make you use them. Lingo Pal VR turns that moment into a ten-minute daily habit you can do
seated, with only your hands, your eyes and your voice.

**What it does.** You sit at Madame Lune's café counter in Paris. Look at the croissants,
hold up two fingers and say "Deux croissants, s'il vous plaît": she serves two croissants
and tells you the price in French. Pick up a 5 € note, drop it on her tray, and she counts
your change back out loud. Every reply you speak gets a pronunciation score. Seven
everyday places open one by one: the café, the boulangerie, the market, a bistrot (order
lunch, ask for the bill), a métro ticket window (ask the way to Montmartre), a pharmacie
("Vous avez mal où ?") and a small hotel (give your name, book nights by holding up
fingers, pay by card). Each has its own shopkeeper, voice, menu and words, and a daily
shopping list sends you across Paris.

**A little Paris on your table.** You travel on "Plan de Paris", a tabletop city that
unfolds on the counter: the Seine with a tour boat, the Eiffel Tower, Notre-Dame, the Arc
de Triomphe and Sacré-Cœur, and one pin per place. Touch or pinch a pin (or look at it, or
say "au marché") and you are there.

**An agent, not a chatbot.** The shopkeepers are AI agents built on Claude with strict tool
use: a deterministic game core owns the menu, prices and every calculation, and validates
each proposed action (serve, quote, give change, offer a substitute) before it happens in
3D. They are proactive: they notice when you hesitate or keep looking at an item and give
a hint at your level, remember your mistakes ("Lune note : deux ≠ douze"), offer a swap
when something runs out, sometimes give wrong change on purpose to see if you catch it,
and at goodbye plan tomorrow's shopping list around your weakest words.

**Your real table.** In mixed reality the café comes to your room: plane detection finds
your real table or desk and the counter snaps onto it; you can move it with a pinch or by
saying "ici", and a persistent spatial anchor brings it back to the same spot tomorrow.
With Quest 3 depth sensing your real hands pass in front of the virtual croissants, and
the Plan de Paris sits on your real desk.

**Come back tomorrow.** Streaks with earned rest days, XP and levels from A1 to A2, a
Passeport de Paris with sixteen stamps, spaced-repetition word review, a café that visibly
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
headset. French speech recognition runs on a server route, with on-device Whisper as the
fallback. Built for Quest 3 at 72 Hz: merged static scenery (about 120 to 160 draw calls
per place), about 2 ms of app logic per frame, and a frame-rate guard that raises
foveation and then sheds extras (background customers, decor) before frames drop.

**What's next.** More cities (Madrid, Rome), a teacher mode, and launch on the Meta
Horizon Store as a PWA.

## Judge quick start

- Fresh first launch: https://lingo-pal-vr.vercel.app/?reset
- A week of progress in one click (labelled DEMO): https://lingo-pal-vr.vercel.app/?demo=week
  (your own progress is backed up first; `?restore` brings it back)
- Mixed reality: press "Dans ma pièce" on the start page (Quest 3: set up your room first)
- Plan de Paris: pinch "Paris" on the left panel; touch a pin on the tabletop map to travel
  (with `?demo=week` all seven places are open)
- Café à deux: Paris map → "Inviter un ami", then open the shown link on a laptop or phone

## Hand interactions (optional field)

| Gesture | What it does | Alternative |
| --- | --- | --- |
| Look at an item + hold up 1 to 5 fingers | Orders that many | Say it, or pinch a suggested reply |
| Pinch | Select a reply, button or item | Look at it for 1 second (eyes-only mode) |
| Touch or pinch a pin on the tabletop Plan de Paris | Travel to that place | Say "au marché", or look at the pin |
| Hold up 2 fingers at the hotel desk | Book two nights | Say "deux nuits" |
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
