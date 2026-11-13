/**
 * Canvas drawings for the "Café à deux" invite card and its buttons
 * (redrawn only when something changes). The QR code is generated locally.
 */

import { encodeQr } from './qr.js';

export const CARD_W = 512;
export const CARD_H = 700;

export interface CardContent {
  code: string;
  link: string;
  url: string;
  status: { fr: string; en: string };
  connected: boolean;
  role: 'host' | 'guest';
  turn: string;
}

function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 2): number {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (c.measureText(test).width > maxW && line) {
      c.fillText(line, x, y);
      y += lineH;
      line = w;
      if (++lines >= maxLines - 1) break;
    } else line = test;
  }
  if (line) c.fillText(line, x, y);
  return y + lineH;
}

export function drawQr(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  const qr = encodeQr(text, 'M');
  const quiet = 3;
  const cell = Math.floor(size / (qr.size + quiet * 2));
  const total = cell * (qr.size + quiet * 2);
  const ox = x + Math.floor((size - total) / 2);
  const oy = y + Math.floor((size - total) / 2);
  c.fillStyle = '#ffffff';
  c.fillRect(ox, oy, total, total);
  c.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++)
    for (let col = 0; col < qr.size; col++) if (qr.modules[r * qr.size + col]) c.fillRect(ox + (col + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
}

export function drawCard(c: CanvasRenderingContext2D, k: CardContent): void {
  c.clearRect(0, 0, CARD_W, CARD_H);
  c.fillStyle = '#1d3557';
  c.beginPath();
  c.roundRect(0, 0, CARD_W, CARD_H, 36);
  c.fill();
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#f5d90a';
  c.font = 'bold 40px sans-serif';
  c.fillText('Café à deux', CARD_W / 2, 58);
  c.fillStyle = '#c9ccd3';
  c.font = '22px sans-serif';
  c.fillText(k.role === 'host' ? 'Invitez un ami · Invite a friend' : 'Chez votre ami · At your friend’s café', CARD_W / 2, 92);

  let y = 120;
  if (!k.connected && k.role === 'host') {
    drawQr(c, k.url, CARD_W / 2 - 120, y, 240);
    y += 252;
    c.fillStyle = '#fafaf7';
    // The link carries the room key after "#": two lines so it stays readable.
    const cut = k.link.indexOf('#');
    c.font = 'bold 22px monospace';
    c.fillText(cut > 0 ? k.link.slice(0, cut) : k.link, CARD_W / 2, y + 2);
    if (cut > 0) c.fillText(k.link.slice(cut), CARD_W / 2, y + 30);
    y += cut > 0 ? 62 : 40;
    c.fillStyle = '#c9ccd3';
    c.font = '21px sans-serif';
    y = wrap(c, 'Open this link on a laptop or phone (or scan it) to join from any browser.', CARD_W / 2, y, CARD_W - 60, 27);
  } else {
    y += 20;
  }
  c.fillStyle = '#9fd3c7';
  c.font = 'bold 22px sans-serif';
  c.fillText('CODE', CARD_W / 2, y + 12);
  c.fillStyle = '#ffffff';
  c.font = 'bold 76px monospace';
  c.fillText(k.code.split('').join(' '), CARD_W / 2, y + 88);
  y += 128;

  c.fillStyle = k.connected ? '#2a9d8f' : '#457b9d';
  c.beginPath();
  c.roundRect(28, y, CARD_W - 56, 92, 20);
  c.fill();
  c.fillStyle = '#ffffff';
  c.font = 'bold 28px sans-serif';
  c.fillText(k.status.fr, CARD_W / 2, y + 40);
  c.fillStyle = '#eef6f5';
  c.font = '21px sans-serif';
  c.fillText(k.status.en, CARD_W / 2, y + 74);
  y += 116;
  if (k.connected && k.turn) {
    c.fillStyle = '#f4a261';
    c.font = 'bold 26px sans-serif';
    c.fillText(k.turn, CARD_W / 2, y + 10);
  }
}

export const BUTTON_W = 256;
export const BUTTON_H = 104;

export function drawButton(c: CanvasRenderingContext2D, fr: string, en: string, color: string, hover: boolean): void {
  c.clearRect(0, 0, BUTTON_W, BUTTON_H);
  c.fillStyle = hover ? '#ffffff' : color;
  c.beginPath();
  c.roundRect(4, 4, BUTTON_W - 8, BUTTON_H - 8, 30);
  c.fill();
  c.textAlign = 'center';
  c.fillStyle = hover ? color : '#ffffff';
  c.font = 'bold 34px sans-serif';
  c.fillText(fr, BUTTON_W / 2, 50);
  c.font = '22px sans-serif';
  c.fillText(en, BUTTON_W / 2, 82);
}
