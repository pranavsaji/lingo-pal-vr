// Demo-video capture from the IWSDK emulator: real gameplay, real app audio.
// Open the app with ?record (audio tap), then run in the background while you drive it:
//   CLIP=name SECS=40 npx @iwsdk/cli browser run scripts/video/record.mjs --timeout 600000
// Writes .tmp/video/<name>/f-<ms>.jpg screen frames (CDP screencast) and audio.webm;
// scripts/video/assemble.sh turns them into an MP4.
import fs from 'node:fs';

export default async function run({ page, frame }) {
  const name = process.env.CLIP || `clip-${Date.now()}`;
  const secs = Number(process.env.SECS || 30);
  const dir = `.tmp/video/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^f-\d+\.jpg$|^audio\.webm$/.test(f)) fs.unlinkSync(`${dir}/${f}`); // a retake replaces the clip
  const app = frame ?? page;
  const cdp = await page.context().newCDPSession(page);
  let frames = 0;
  let t0 = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const t = f.metadata.timestamp * 1000;
    if (!t0) t0 = t;
    fs.writeFileSync(`${dir}/f-${String(Math.round(t - t0)).padStart(7, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    frames += 1;
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  // Audio first (MediaRecorder on the app's audio tap), then the screen, so they start together.
  await app.evaluate(() => {
    const tap = window.__lingoTap;
    window.__aChunks = [];
    if (!tap) return;
    window.__aRec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    window.__aRec.ondataavailable = (e) => e.data.size && window.__aChunks.push(e.data);
    window.__aRec.start(500);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, secs * 1000));
  await cdp.send('Page.stopScreencast');
  const b64 = await app.evaluate(async () => {
    const rec = window.__aRec;
    if (!rec) return '';
    await new Promise((res) => { rec.onstop = res; rec.stop(); });
    const buf = new Uint8Array(await new Blob(window.__aChunks, { type: 'audio/webm' }).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) fs.writeFileSync(`${dir}/audio.webm`, Buffer.from(b64, 'base64'));
  console.log(`saved ${dir}: ${frames} frames, audio ${b64 ? 'yes' : 'no'}`);
}
