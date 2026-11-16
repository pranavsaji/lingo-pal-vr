# Devpost submission kit

Paste-ready text for the Devpost form. Everything here describes features that exist in
the build at https://lingo-pal-vr.vercel.app. Testing status is stated honestly below:
re-read it after any Quest device report and remove anything that did not hold up.

## Form fields

- **Project name:** Lingo Pal VR: Café Lune
- **Tagline (≤140 chars, 136):** Speak French to an AI shopkeeper who serves you, counts your change and tests you. Hands-first, on your real table. Get prêt pour Paris.
- **Track / division:** Productivity, New Experience
- **New Experience eligibility:** this repository was created for the competition. Its first commit is dated 2026-11-12, inside the window that opened 2026-09-24, and every line of the VR app was written from scratch in it. It shares only the "Lingo Pal" name with the founder's separate mobile app, not code or builds. Proof: `git log --reverse` (first commit c52ca52, 2026-11-12).
- **Playable link:** https://lingo-pal-vr.vercel.app (the start page also plays the 3-minute tour)
- **Target launch:** December 2026, public web (Quest Browser)
- **Team:** Pranav Saji (Pranav Innovates), solo developer

## Description (479 words; Devpost suggests 500 or less)

### Inspiration

Apps teach French words, but the moment that scares travellers is the counter: a Parisian waiting for your order, a price said fast, change counted out loud. We wanted a place to practise that moment, with your hands, before the trip.

### What it does

You sit at Madame Lune's café counter in Paris. Look at the croissants in her glass case, hold up two fingers and say "Deux croissants, s'il vous plaît": she serves two on a tray, says the price in French and waits. Drop a 5 € note on the payment dish and she counts your change aloud. She is an AI agent (Claude) whose every action is a tool call the game validates before it happens in 3D: serve, quote, give change, run out of stock and offer a swap, or slip you wrong change on purpose to see if you catch it.

**Prêt pour Paris** measures readiness for a real trip: 28 situations across seven places (café, boulangerie, market, bistrot, métro, pharmacie, hotel), each ticked only when the game verified it: a paid order, a phrase pronounced 70 %+ right, the exact amount, an order with no help in "Vraie vie" mode. Set your trip date and the home panel counts down ("PRÊT POUR PARIS 34 % · J-12") with today's 10-minute plan.

No French? Pinch **Pal**, a sparrow on the counter, and ask in English; it answers and hands you the French line with a sounds-like spelling. Everything is hands-first and seated, with voice and eyes-only alternatives for every action, plus subtitles, high contrast, slow speech and a left-handed layout. In mixed reality the counter lands on your real table and a spatial anchor brings it back tomorrow. **Café à deux** lets a friend join from a headset or a phone.

### How we built it

Meta's Immersive Web SDK (three.js + ECS): WebXR hand tracking with finger counting on all 25 joints, gaze, plane detection, anchors, depth sensing and UIKitML panels. A deterministic game core owns the menu, prices, stock and every calculation; the agent proposes, the game validates, the world shows the result. Without the AI, the game still runs on its built-in scripted shopkeepers. Claude, Inworld voices and speech recognition run on Vercel server routes behind rate limits, so keys never reach the headset. 402 automated tests cover the game core, agent validation, finger counting and readiness.

Built and tested in the IWSDK emulator with the Quest 3 profile; we have not yet had a physical Quest. A frame-rate guard sheds extras if frames drop, and `?perf` mode reports frame rates from real headsets.

### Challenges and what we learned

Counting fingers reliably at any hand angle took a test harness of captured hand poses. Keeping the agent honest taught us to let the game, not the model, do every calculation.

### What's next

Testing on Quest 3 and 3S hardware, more cities (Madrid, Rome), a teacher mode, and launching on the Meta Horizon Store as a PWA.

## Judge quick start

- Fresh first launch: https://lingo-pal-vr.vercel.app/?reset
- A week of progress in one click (labelled DEMO): https://lingo-pal-vr.vercel.app/?demo=week
  (your own progress is backed up first; `?restore` brings it back)
- Mixed reality: press "Dans ma pièce" on the start page (Quest 3: set up your room first)
- No French? Pinch Pal (the sparrow on the front-left of the counter) and ask in English
- Real-life mode: say "vraie vie" (or Réglages → Vraie vie)
- Plan de Paris: pinch "Paris" on the left panel; touch a pin on the tabletop map to travel
  (with `?demo=week` all seven places are open)
- Café à deux: Paris map → "Inviter un ami", then open the shown link on a laptop or phone
- Prêt pour Paris: the teal strip on the home panel (or say "prêt pour Paris"); set a trip
  in Réglages → "Mon voyage à Paris"

## Hand interactions (optional field)

Every action in Lingo Pal VR works with bare hands, seated, end to end; no controller is ever needed. Hands come first because ordering in a real café is physical: you point, you hold up fingers, you hand over money. What excites us about VR is practising those real-world moments with your own body before they happen.

| Gesture | What it does | Alternative |
| --- | --- | --- |
| Look at an item + hold up 1 to 5 fingers | Orders that many | Say it, or pinch a suggested reply |
| Pinch | Select a reply, button or item | Look at it for 1 second (eyes-only mode) |
| Touch or pinch a pin on the tabletop Plan de Paris | Travel to that place | Say "au marché", or look at the pin |
| Hold up 2 fingers at the hotel desk | Book two nights | Say "deux nuits" |
| Pinch or touch Pal | Ask for help in English | Say "Pal" or "help me", or look at Pal |
| Pinch-grab a coin or note, release over the tray | Pay | Say "je paie" or "voilà cinq euros", or look at a coin for 1 second |
| Point at your real table and pinch (mixed reality) | Place the café there | Say "ici" |
| Palm up / lower palm | Start / stop talking | Pinch "Parler" |
| Wave | Say hello (tutorial step 1) | Say "bonjour" |
| Thumbs up | Agree | Say "oui" |

## Demo video

`lingo-pal-demo.mp4`, 2:59 (178.8 s), real gameplay recorded in the IWSDK emulator (Meta Quest 3
profile) with the app's own audio. Every one of the seven places is shown with a real AI
conversation (café, boulangerie, métro, marché, pharmacie, bistrot, hôtel), and the start page lists
them. The emulator has no microphone, so the learner's lines are spoken by the app's learner voice
and fed in as heard speech; the shopkeepers' replies are live. Shot list and timestamps in
`.tmp/video/final/SHOTLIST.md` (not in git). A 720p copy plays from the start page ("Regarder la visite").

## Before you press Submit

- [x] Membership approved (Meta VR Start): welcome email 2026-11-11 to pranavs9876@gmail.com
- [x] Devpost draft filled 2026-11-15 (overview, story, 16 tags, try-it link, 12 captioned images, additional info)
- [ ] Devpost: country of residence + the three eligibility checkboxes (age, jurisdiction, not a Meta employee)
- [ ] Devpost: YouTube/Vimeo link (public or unlisted) in Project details
- [ ] Link opens on Quest 3 and 3S in a logged-out browser; Enter VR works
- [ ] Video public or unlisted, under 3:00 (current cut: 2:59, all seven places in conversation)
- [ ] Screenshots: hero cafe, wow moment, Carnet, high contrast, mixed reality
- [ ] Anthropic console spend limit set; keep the Vercel project and key live until winners
      are announced (about Dec 11)
