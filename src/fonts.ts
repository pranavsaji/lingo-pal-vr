/**
 * French-ready panel font.
 *
 * UIKitML's @font-face path builds its glyph atlas from plain ASCII only, so
 * accents (é, è, ç, î, ...) go missing. Here we build the same Poppins font with
 * a French character set and hand it to each panel as its font family.
 */

import { UIKit } from '@iwsdk/core';

const ASCII = ' \tABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,;:\'"()-[]{}@#$%&*+=/\\<>_|~';
const FRENCH = 'àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ«»’€°·≠…';
const CHARSET = ASCII + FRENCH;

const base = import.meta.env.BASE_URL;
let regular: Promise<unknown> | null = null;
let bold: Promise<unknown> | null = null;

function firstFace(loaded: unknown): unknown {
  const family = Object.values(loaded as Record<string, Record<string, unknown>>)[0];
  return family ? Object.values(family)[0] : undefined;
}

function load(file: string): Promise<unknown> {
  const loader = new UIKit.TTFLoader();
  return loader
    .loadAsync({ url: `${base}ui/fonts/${file}`, charset: CHARSET, textureSize: [1024, 1024] } as never)
    .then(firstFace);
}

/** Load sequentially: concurrent MSDF generation can produce broken atlases. */
function fonts(): { regular: Promise<unknown>; bold: Promise<unknown> } {
  if (!regular || !bold) {
    regular = load('Poppins-Regular.ttf');
    bold = regular.then(() => load('Poppins-Bold.ttf'));
  }
  return { regular, bold };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFrenchFont(panel: UIKit.Component<any> | null | undefined): void {
  if (!panel) return;
  const f = fonts();
  panel.setProperties({
    fontFamilies: {
      poppins: {
        normal: () => f.regular,
        bold: () => f.bold,
      },
    },
  });
}

/**
 * Resolves when both French fonts are built. Heavy background work (on-device
 * voice models) waits for this so panel text appears as early as possible.
 */
export function fontsReady(): Promise<void> {
  const f = fonts();
  return Promise.all([f.regular, f.bold]).then(
    () => undefined,
    () => undefined,
  );
}
