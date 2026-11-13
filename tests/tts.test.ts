import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain ESM server module
import { handleTts, SPEAKERS } from '../server/tts-handler.mjs';

const env = { INWORLD_API_KEY: 'test-key' };

afterEach(() => vi.unstubAllGlobals());

describe('shopkeeper voices route', () => {
  it('reports whether a provider is configured', async () => {
    expect((await handleTts({ probe: '1' }, env)).status).toBe(200);
    expect((await handleTts({ probe: '1' }, {})).status).toBe(503);
  });
  it('rejects unknown speakers, empty or long text, and smuggled delivery instructions', async () => {
    expect((await handleTts({ s: 'boss', t: 'Bonjour' }, env)).status).toBe(400);
    expect((await handleTts({ s: 'lune', t: '' }, env)).status).toBe(400);
    expect((await handleTts({ s: 'lune', t: 'x'.repeat(241) }, env)).status).toBe(413);
    expect((await handleTts({ s: 'lune', t: '[shout] Bonjour' }, env)).status).toBe(400);
  });
  it('gives each shopkeeper a voice and returns cacheable MP3', async () => {
    expect(Object.keys(SPEAKERS)).toEqual(['lune', 'paul', 'rose', 'learner']);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ audioContent: Buffer.alloc(4000, 1).toString('base64') })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await handleTts({ s: 'paul', t: 'Voilà votre baguette.', slow: '1' }, env, 'ip-test');
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('audio/mpeg');
    expect(r.headers['Cache-Control']).toContain('s-maxage');
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }])[1].body);
    expect(sent.voiceId).toBe('Alain');
    expect(sent.modelId).toBe('inworld-tts-2');
    expect(sent.text).toContain('Voilà votre baguette.');
    expect(sent.audioConfig.speakingRate).toBeCloseTo(0.95 * 0.8);
  });
});
