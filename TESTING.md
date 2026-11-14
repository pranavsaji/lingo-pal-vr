# Testing on a real Quest (3 minutes)

We cannot test on hardware ourselves, so volunteer numbers from a real Meta Quest 3 / 3S
are gold. Thank you!

## Tester link

**https://lingo-pal-vr.vercel.app/?perf**

`?perf` turns on tester mode: a small readout in the lower left of your view, and an
anonymous frame-rate summary sent every 30 s. Without `?perf` nothing is shown or sent.

## What to do (about 3 minutes)

1. Open the link in the Quest Browser and press **Entrer au café** (Enter).
2. **Order once**: pinch a reply on the chat panel, or point at an item, or say "un café, s'il vous plaît".
3. **Pay**: pinch coins from the dish and drop them on the tray.
4. **Open the map** (the map button, or say "le plan").
5. **Travel once** to another shop and look around for ~20 s.
6. Leave the session (the Meta button). That's it.

If something stutters, a note of what you were doing helps (e.g. "when the baker waved").

## What the readout shows

`72 fps low 58` average fps and the 1%-low over the last ~4 s (green = on budget, yellow =
a little over, red = dropping frames) · `ms` frame time and its 95th percentile · `calls` draw
calls per frame (both eyes) · `fov` fixed foveation (0.15 sharp to 1.0 max) · `res` framebuffer
scale · `power` how many extras the app has switched off to hold the frame rate (0 = none;
see `src/world/power.ts`) · the device guess.

## What is sent (and what is not)

Every 30 s, while the page is open: device class from the user agent ("Quest 3"), VR/MR/flat,
shop, average fps, 1%-low fps, p95 frame ms, draw calls, triangles, framebuffer scale,
foveation, power level and seconds in the session. Nothing else: no IP stored, no account,
no identifiers, no free text (the server rejects anything outside these fields).

## Reading the results (owner)

Each valid report is one log line on the `/api/perf` function, prefixed `[perf]`:

```sh
vercel logs --project lingo-pal-vr --environment production --since 1h \
  --query 'requestPath:/api/perf' --limit 1000 | grep "\[perf\]"
```

(Vercel CLI 65: `--since` takes `1h`, `24h` or an ISO date; the default window is only 30 min
and 100 records.) A line looks like:

```
[perf] {"build":"d2b392c","device":"Quest 3","mode":"vr","place":"cafe","avgFps":71.9,"low1Fps":60.2,"p95Ms":14.1,"drawCalls":310,"triangles":298000,"fbScale":1.2,"foveation":0.15,"power":0,"sessionS":95}
```

Healthy on Quest 3/3S: `avgFps` ≥ 70 at 72 Hz, `low1Fps` ≥ 60, `power` 0-1. A `power` of 2+ or a
`foveation` of 1 means the headset was struggling: compare `place` and `drawCalls` across reports.
Local overrides for experiments: `?res=1.0` (framebuffer scale), `?fov=0.4`, `?power=2`.
