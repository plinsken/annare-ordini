import test from 'node:test';
import assert from 'node:assert/strict';
import { consolida } from '../api/_consolida.js';

const CAT = { sedi: ['Regina Margherita', 'Bianconi'], reparti: { Pizzeria: { Latticini: [['Brie', '', 'forma 1 kg'], ['Provolone', '', '~2 kg']], Salumi: [['Speck', '', '~2,5 kg']] }, Bar: { Caffè: [['Caffè', '', '1 kg']] } } };
const riga = (cat, nome, q, formato = '') => ({ cat, nome, dett: '', formato, q });
const R = (id, nome, sede, reparto, righe, nota = '') => ({ id, nome, sede, reparto, righe, nota });

test('sums the same product per sede and reparto, keeps who asked', () => {
  const out = consolida([
    R(1, 'Anna', 'Bianconi', 'Pizzeria', [riga('Salumi', 'Speck', 1, '~2,5 kg'), riga('Latticini', 'Brie', 2, 'forma 1 kg')], 'entro sabato'),
    R(2, 'Bruno', 'Bianconi', 'Pizzeria', [riga('Latticini', 'Brie', 3, 'forma 1 kg'), riga('Altro', 'Burrata', null)]),
    R(3, 'Carla', 'Bianconi', 'Pizzeria', [riga('Altro', 'Burrata', 2)]),
    R(4, 'Dario', 'Regina Margherita', 'Pizzeria', [riga('Latticini', 'Brie', 1, 'forma 1 kg')]),
    R(5, 'Ezio', 'Bianconi', 'Pizzeria', [riga('Latticini', 'Brie', 1, 'forma 2 kg')]),   // renamed format: own line
  ], CAT);
  assert.deepEqual(out.map(o => o.sede + '/' + o.reparto), ['Regina Margherita/Pizzeria', 'Bianconi/Pizzeria']);
  const b = out[1];
  assert.deepEqual(b.righe.map(r => [r.cat, r.nome, r.formato, r.q]), [
    ['Latticini', 'Brie', 'forma 1 kg', 5], ['Latticini', 'Brie', 'forma 2 kg', 1], ['Salumi', 'Speck', '~2,5 kg', 1],
    ['Altro', 'Burrata', '', null], ['Altro', 'Burrata', '', 2]]);
  assert.deepEqual(b.righe[0].chi, [{ nome: 'Anna', q: 2, richiesta: 1 }, { nome: 'Bruno', q: 3, richiesta: 2 }]);
  assert.deepEqual(b.note, [{ nome: 'Anna', nota: 'entro sabato' }]);
  assert.deepEqual(consolida([]), []);
});
