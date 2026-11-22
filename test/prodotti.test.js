import test from 'node:test';
import assert from 'node:assert/strict';
import { valida } from '../api/_prodotti.js';

const CAT = { sedi: ['Bianconi', 'Regina Margherita'], reparti: { Pizzeria: { Latticini: [['Brie', 'francese', 'forma 1 kg'], ['Provolone', '', '~2 kg']] }, Bar: { Caffè: [['Caffè in grani', '', '1 kg']] } } };
const base = { sede: 'Bianconi', reparto: 'Pizzeria', righe: [{ cat: 'Latticini', nome: 'Brie', q: 2 }] };
const v = b => valida({ ...base, ...b }, CAT);

test('valid request keeps a snapshot from the catalogue', () => {
  assert.deepEqual(v({ nota: '  entro sabato ' }), { sede: 'Bianconi', reparto: 'Pizzeria', nota: 'entro sabato',
    righe: [{ cat: 'Latticini', nome: 'Brie', dett: 'francese', formato: 'forma 1 kg', q: 2 }] });
});

test('refuses unknown places, products and bad quantities', () => {
  assert.deepEqual(v({ sede: 'Altrove' }), { errore: 'Ordine non valido.' });
  assert.deepEqual(v({ reparto: 'Cantina' }), { errore: 'Ordine non valido.' });
  assert.deepEqual(v({ righe: [{ cat: 'Caffè', nome: 'Caffè in grani', q: 1 }] }), { errore: "Un prodotto non è più in lista. Aggiorna l'app." });
  assert.deepEqual(v({ righe: [{ cat: 'Latticini', nome: 'Mozzarella', q: 1 }] }), { errore: "Un prodotto non è più in lista. Aggiorna l'app." });
  for (const q of [0, 100, 1.5, '2', null, -1]) assert.deepEqual(v({ righe: [{ cat: 'Latticini', nome: 'Brie', q }] }), { errore: 'Quantità non valida.' }, String(q));
  assert.deepEqual(v({ righe: [base.righe[0], base.righe[0]] }), { errore: 'Prodotto ripetuto.' });
  assert.deepEqual(v({ righe: [] }), { errore: 'Aggiungi almeno un prodotto.' });
  assert.deepEqual(v({ righe: 'x' }), { errore: 'Ordine non valido.' });
  assert.deepEqual(valida(null, CAT), { errore: 'Ordine non valido.' });
});

test('"Altro" line and note are trimmed and capped', () => {
  const r = v({ righe: [], altro: { nome: 'Burrata\npugliese ' + 'x'.repeat(100), q: '' }, nota: 'n'.repeat(600) });
  assert.equal(r.righe.length, 1);
  assert.equal(r.righe[0].cat, 'Altro');
  assert.equal(r.righe[0].q, null);
  assert.equal(r.righe[0].nome.length, 80);
  assert.doesNotMatch(r.righe[0].nome, /\n/);
  assert.equal(r.nota.length, 500);
  assert.equal(v({ altro: { nome: 'Burrata', q: 3 } }).righe[1].q, 3);
  assert.deepEqual(v({ altro: { nome: 'Burrata', q: 120 } }), { errore: 'Quantità non valida.' });
  assert.equal(v({ altro: { nome: '   ', q: 3 } }).righe.length, 1, 'blank altro ignored');
});

test('the real catalogue loads', () => {
  const r = valida({ sede: 'Bianconi', reparto: 'Pizzeria', righe: [{ cat: 'Latticini', nome: 'Brie', q: 1 }] });
  assert.equal(r.righe[0].formato, 'forma 1 kg');
});
