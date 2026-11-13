/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import dns from 'node:dns';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, loadEnv, type Plugin } from 'vite';
// @ts-expect-error plain ESM module shared with the Vercel function
import { handleAgent } from './server/agent-handler.mjs';
// @ts-expect-error plain ESM module shared with the Vercel function
import { handleStt } from './server/stt-handler.mjs';
// @ts-expect-error plain ESM module shared with the Vercel function
import { handleTts } from './server/tts-handler.mjs';

type Handler = (body: unknown, env: Record<string, string | undefined>) => Promise<{ status: number; body: unknown }>;

// Some providers (Inworld) publish IPv4 only; Node's dual-stack connect can stall on them locally.
dns.setDefaultResultOrder('ipv4first');

/** Local /api/agent, /api/stt and /api/tts routes so the AI works in `npm run dev`. */
function shopkeeperApi(): Plugin {
  return {
    name: 'lingo-pal-shopkeeper-api',
    configureServer(server) {
      const env = { ...process.env, ...loadEnv(server.config.mode, process.cwd(), '') };
      // Shopkeeper voices: GET with query, binary audio back.
      server.middlewares.use('/api/tts', (req, res) => {
        const query = Object.fromEntries(new URL(req.url ?? '/', 'http://local').searchParams);
        void handleTts(query, env, req.socket.remoteAddress ?? 'local', req.headers).then(
          ({ status, headers, body }: { status: number; headers: Record<string, string>; body: unknown }) => {
            res.statusCode = status;
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
            res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
          },
          (err: unknown) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          },
        );
      });
      // Speech-to-text takes raw audio, not JSON.
      server.middlewares.use('/api/stt', (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          let status = 500;
          let body: unknown = { error: 'unknown' };
          try {
            ({ status, body } = await handleStt(req.method, Buffer.concat(chunks), req.headers['content-type'], env, req.socket.remoteAddress ?? 'local'));
          } catch (err) {
            body = { error: String(err) };
          }
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        });
      });
      const routes: Record<string, Handler> = { '/api/agent': handleAgent };
      for (const [route, handle] of Object.entries(routes)) server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', async () => {
          let status = 500;
          let body: unknown = { error: 'unknown' };
          try {
            ({ status, body } = await handle(JSON.parse(raw || '{}'), env));
          } catch (err) {
            body = { error: String(err) };
          }
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), shopkeeperApi()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  // Same cross-origin isolation as vercel.json, so `vite preview` matches production
  // (it enables multi-threaded WASM for the on-device voice).
  preview: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  },
  // The on-device voice worker uses dynamic imports (ONNX runtime), which need ES workers.
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
