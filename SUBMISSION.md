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

## Description (about 850 words)

**The only place you can speak French to a shopkeeper who acts in the world.** You sit at
Madame Lune's café counter in Paris. Look at the croissants, hold up two fingers and say
"Deux croissants, s'il vous plaît": she puts two croissants on the counter, tells you the
price in French and waits. Drop a 5 € note on her tray and she counts your change back out
loud. She is an AI agent (Claude) whose every action is a tool call the game validates
before it happens in 3D, so she can serve, quote, give change, run out of stock and offer
a swap, or slip you wrong change on purpose to see if you catch it. Everything works with
bare hands, seated, and in mixed reality the counter lands on your real table.

**Prêt pour Paris: the productivity loop.** The goal is not XP; it is being ready for a
real trip. Readiness is measured in 28 real situations, four in each of seven places: order,
say it in French well enough to be understood (70 %+ pronunciation), pay the exact amount,
and do it with no help in "Vraie vie" mode. A situation is ticked only when the game
verified it (a paid order, a scored phrase, the register's change, a clean real-life
order), so the percentage never moves for free. Each day the home panel shows "PRÊT POUR
PARIS 34 % · J-12" and Ma semaine lists today's 10-minute plan: a new place to try, the
skill you are missing where you have already been, and your weakest words. Set "Mon voyage
à Paris" to 7, 14 or 30 days and the countdown turns practice into a deadline you care about.

**Seven places on a little Paris.** Café, boulangerie, market, bistrot, métro ticket
window, pharmacie and a small hotel (book nights by holding up fingers, pay by card), each
with its own shopkeeper, voice, menu, words and real-life curveball ("Sur place ou à
emporter ?", "Vous pouvez épeler votre nom ?"). You travel on the Plan de Paris, a tabletop
city that unfolds on the counter (the Seine with a tour boat, the Eiffel Tower, one pin per
place): touch or pinch a pin, look at it, or say "au marché".

**No French? Ask Pal.** The shopkeepers only speak French. Pal, a sparrow in a beret on
your counter, speaks English: pinch it and ask "How do I ask for the bill?" and it answers
aloud, then hands you the French line with a sounds-like spelling ("lah-dee-SYON, seel voo
PLAY"). Someone with zero French succeeds in minutes. When you are ready, "Vraie vie"
removes English, hints and suggested replies, at natural Parisian speed.

**An agent, not a chatbot.** A deterministic game core owns the menu, prices, stock and
every calculation; the agent proposes, the game validates, the 3D world shows the result.
The shopkeepers are proactive: they notice when you hesitate or keep looking at an item and
give a hint at your level, remember your mistakes ("Lune note : deux ≠ douze"), and at
goodbye plan tomorrow around your weakest words.

**Your real table.** In mixed reality plane detection finds your table and the counter
snaps onto it; move it with a pinch or by saying "ici", and a persistent spatial anchor
brings it back to the same spot tomorrow. With Quest 3 depth sensing your real hands pass
in front of the virtual croissants.

**Come back tomorrow.** Prêt pour Paris and the trip countdown, streaks with earned rest
days, XP and levels from A1 to A2, a Passeport de Paris with sixteen stamps, spaced
repetition (Mon Carnet), a daily shopping list across Paris, "Bon retour !" and a weekly report.

**First five minutes.** A branded page appears instantly with a real loading bar. Madame
Lune asks how you want to play: hands, eyes or voice. A ghost hand and her voice teach four
moves (wave, pinch, count, pay) with almost no text; the first paid order and confetti
arrive in about a minute.

**Accessible by default.** Every hand action has a voice alternative and an eyes-only
alternative (look for one second), including paying ("je paie"). Subtitles, high contrast
down to the 3D coins, text size, slow speech, left-handed layout, reduced motion,
hands-free voice; seated, and it fits the narrower view of Meta VR Glasses.

**Café à deux.** Invite a friend with a private link: they join from a headset or simply a
laptop or phone browser, appear across the counter, and take turns ordering. Peer to peer,
no accounts.

**How we built it.** Meta's Immersive Web SDK (three.js and an entity-component system),
WebXR hand tracking (finger counting on all 25 joints, robust to hand angle and size), gaze,
plane detection, anchors, depth sensing, UIKitML spatial panels. Claude, Inworld voices and
speech recognition run on Vercel routes behind rate limits; keys never reach the headset,
and on-device Whisper is the fallback. 391 automated tests cover the game core, the agent's
tool validation, finger counting on captured hand poses, layouts and readiness.

**Testing status (honest).** Built and tested in the IWSDK emulator with the Meta Quest 3
profile; we have not yet had a physical Quest. Measured there at full quality: 154 to 263
draw calls per frame for both eyes plus shadows (heaviest: the café with its animated
customers) and under 300k triangles everywhere; a frame-rate guard raises foveation and then
sheds extras (customers, decor, shadow updates) if frames drop. Tester mode (`?perf`) reports
frame rate from real headsets anonymously.

**What's next.** More cities (Madrid, Rome), a teacher mode, and launch on the Meta Horizon
Store as a PWA.

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

`lingo-pal-demo.mp4`, 2:59, real gameplay recorded in the IWSDK emulator (Meta Quest 3
profile) with the app's own audio; shot list and timestamps in `.tmp/video/final/SHOTLIST.md`
(not in git). A 720p copy plays from the start page ("Regarder la visite").

## Before you press Submit

- [ ] Membership approved (Meta VR Start)
- [ ] Link opens on Quest 3 and 3S in a logged-out browser; Enter VR works
- [ ] Video public, under 3:00 (current cut: 2:59)
- [ ] Screenshots: hero cafe, wow moment, Carnet, high contrast, mixed reality
- [ ] Anthropic console spend limit set; keep the Vercel project and key live until winners
      are announced (about Dec 11)
