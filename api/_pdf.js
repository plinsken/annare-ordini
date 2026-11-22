// The order PDF, built on the server from approved data. Same layout as the PDF the app used to make in the browser.
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { dataBreve } from './_settimana.js';

const file = n => readFileSync(new URL(`./_fonti/${n}`, import.meta.url));
let risorse;
const carica = () => (risorse ??= { isr: file('isr.ttf'), isi: file('isi.ttf'), m4: file('m4.ttf'), m7: file('m7.ttf'), logo: file('logo.png') });

export async function creaPdf(o) {
  const R = carica();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const F = { r: await doc.embedFont(R.m4, { subset: true }), b: await doc.embedFont(R.m7, { subset: true }), s: await doc.embedFont(R.isr, { subset: true }), si: await doc.embedFont(R.isi, { subset: true }) };
  const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = { ink: hex('#221812'), pom: hex('#c8301e'), deep: hex('#9c260b'), latte: hex('#fbf6ea'), linea: hex('#e2cf9f'), muto: hex('#5f4a3a') };
  const logo = await doc.embedPng(R.logo);
  const W = 595.28, H = 841.89, M = 42, X = { prod: M, form: 330, q: 482, ck: W - M - 11 };
  let pg, y; const pagine = [];
  const t = (s, x, yy, f, sz, c) => pg.drawText(String(s), { x, y: yy, font: f, size: sz, color: c || C.ink });
  const rt = (s, x, yy, f, sz, c) => t(s, x - f.widthOfTextAtSize(String(s), sz), yy, f, sz, c);
  const TR = 1.3;
  const lw = (s, f, sz) => String(s).toUpperCase().split('').reduce((a, ch) => a + f.widthOfTextAtSize(ch, sz) + TR, -TR);
  const et = (s, x, yy, dx) => { let xx = dx ? x - lw(s, F.b, 7.5) : x; for (const ch of String(s).toUpperCase()) { t(ch, xx, yy, F.b, 7.5, C.deep); xx += F.b.widthOfTextAtSize(ch, 7.5) + TR; } };
  const aCapo = (s, f, sz, w) => { const out = []; let l = ''; for (const p of String(s).split(' ')) { const n = l ? l + ' ' + p : p; if (f.widthOfTextAtSize(n, sz) > w && l) { out.push(l); l = p; } else l = n; } if (l) out.push(l); return out; };
  const intestaTabella = () => { et('Prodotto', X.prod, y); et('Formato', X.form, y); et('Qtà', X.q, y, 1); et('Arrivato', W - M, y, 1); y -= 8; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: C.ink }); y -= 16; };
  function nuova(prima) {
    pg = doc.addPage([W, H]); pagine.push(pg);
    pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.latte });
    const lw2 = 118, lh = lw2 * 196 / 606;
    pg.drawImage(logo, { x: M, y: H - M - lh, width: lw2, height: lh });
    rt('Ordine n. ' + o.num, W - M, H - M - 12, F.b, 9);
    rt(o.data + ', ore ' + o.ora, W - M, H - M - 25, F.r, 9, C.muto);
    y = H - M - lh - 12; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: C.pom }); y -= 14;
    if (prima) {
      y -= 26; t('Ordine ', M, y, F.s, 34, C.ink); t(o.reparto.toLowerCase(), M + F.s.widthOfTextAtSize('Ordine ', 34), y, F.si, 34, C.pom); y -= 24;
      [['Sede', o.sede], ['Reparto', o.reparto], ['Settimana', 'venerdì ' + dataBreve(o.settimana)], ['Approvato da', o.approvatoDa]].forEach(([a, b]) => { et(a, M, y); t(b, M + 92, y, F.r, 10); y -= 15; });
      y -= 14;
    }
    intestaTabella();
  }
  nuova(true);
  for (const g of o.gruppi) {
    if (y < M + 70) nuova(false);
    t(g.cat, M, y, F.b, 10.5, C.ink); y -= 15;
    for (const r of g.righe) {
      const dett = aCapo(r.dett || '', F.r, 8, 270), form = aCapo(r.formato || '', F.r, 9.5, 135);
      const h = Math.max(13 + dett.length * 10, form.length * 12) + 8;
      if (y - h < M + 30) { nuova(false); t(g.cat + ' (segue)', M, y, F.b, 10.5, C.ink); y -= 15; }
      t(r.nome, X.prod, y, F.r, 10); dett.forEach((l, i) => t(l, X.prod, y - 12 - i * 10, F.r, 8, C.muto));
      form.forEach((l, i) => t(l, X.form, y - i * 12, F.r, 9.5, C.muto));
      rt(r.q ?? 'da indicare', X.q, y, F.b, r.q == null ? 8 : 11);
      pg.drawRectangle({ x: X.ck, y: y - 2, width: 11, height: 11, borderColor: C.ink, borderWidth: 0.8 });
      y -= h - 8; pg.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.5, color: C.linea }); y -= 11;
    }
    y -= 8;
  }
  if (o.note) { const l = aCapo(o.note, F.r, 10, W - 2 * M); if (y - 30 - l.length * 14 < M + 30) nuova(false); y -= 4; et('Note', M, y); y -= 15; l.forEach(x => { t(x, M, y, F.r, 10); y -= 14; }); }
  pagine.forEach((p, i) => { pg = p; t('Annaré, ordini interni', M, M - 14, F.r, 8, C.muto); rt('pag. ' + (i + 1) + ' di ' + pagine.length, W - M, M - 14, F.r, 8, C.muto); });
  return doc.save();
}
