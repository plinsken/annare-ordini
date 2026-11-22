import test from 'node:test';
import assert from 'node:assert/strict';

const ENV = { STAFF: 'Mario Rossi:K7P2X-9QWMT,Anna:H3M8RT2ZQA,Corto:ABC123', SESSION_SECRET: 'x'.repeat(40) };
Object.assign(process.env, ENV);
const { staff, creaToken, leggiToken, chi } = await import('../api/_auth.js');
const ordine = (await import('../api/ordine.js')).default;

const finto = () => ({ code: 200, headers: {}, body: undefined,
  status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  json(b) { this.body = b; return this; }, end() { return this; } });
const req = (method, body, cookie = '') => ({ method, body, headers: { cookie } });

test('staff list: codes normalised, short codes refused', () => {
  const m = staff(ENV);
  assert.equal(m.get('K7P2X9QWMT'), 'Mario Rossi');
  assert.equal(staff({ STAFF: 'Mario Rossi:k7p2x 9qwmt' }).get('K7P2X9QWMT'), 'Mario Rossi');
  assert.equal(m.get('H3M8RT2ZQA'), 'Anna');
  assert.equal(m.size, 2, 'Corto has a 6-character code and is ignored');
  assert.equal(staff({ STAFF: 'nocolon,:NOCODENAME12' }).size, 0);
});

test('token: valid, expired, tampered, revoked, no secret', () => {
  const t = creaToken('Anna', 'H3M8RT2ZQA', ENV, 1000);
  assert.equal(leggiToken(t, ENV, 2000), 'Anna');
  assert.equal(leggiToken(t, ENV, 1000 + 91 * 864e5), null, 'expired');
  const [, exp, sig] = t.split('.');
  assert.equal(leggiToken(`${Buffer.from('Mario Rossi').toString('base64url')}.${exp}.${sig}`, ENV, 2000), null, 'name swapped');
  assert.equal(leggiToken(`${t.split('.')[0]}.${Number(exp) + 1}.${sig}`, ENV, 2000), null, 'expiry extended');
  assert.equal(leggiToken(t, { ...ENV, STAFF: 'Anna:NEWCODE1234' }, 2000), null, 'code changed');
  assert.equal(leggiToken(t, { ...ENV, STAFF: 'Mario Rossi:K7P2X9QWMT' }, 2000), null, 'removed');
  assert.equal(leggiToken(t, { ...ENV, SESSION_SECRET: '' }, 2000), null, 'no secret');
  assert.equal(leggiToken('garbage', ENV), null);
  assert.equal(leggiToken(undefined, ENV), null);
});

test('order endpoint: 401 without login, emails with the logged-in name', async () => {
  const cookie = 'sessione=' + creaToken('Anna', 'H3M8RT2ZQA', ENV);
  const body = { sede: 'Bianconi', reparto: 'Pizzeria\r\nBcc: x@y.z', num: '1411-1200', pdf: 'JVBERi0xLjc=' };

  let r = finto(); await ordine(req('POST', body), r);
  assert.equal(r.code, 401);

  r = finto(); await ordine(req('POST', body, cookie), r);
  assert.equal(r.code, 503, 'email not configured yet');

  Object.assign(process.env, { RESEND_API_KEY: 're_test', ORDINI_DA: 'Ordini <ordini@example.com>', ORDINI_A: 'g@example.com' });
  r = finto(); await ordine(req('POST', { ...body, pdf: 'PGh0bWw+' }, cookie), r);
  assert.equal(r.code, 400, 'not a PDF');

  let inviato;
  globalThis.fetch = async (url, o) => { inviato = { url, ...JSON.parse(o.body), auth: o.headers.Authorization }; return { ok: true }; };
  r = finto(); await ordine(req('POST', { ...body, nome: 'Qualcun altro' }, cookie), r);
  assert.equal(r.code, 200);
  assert.equal(inviato.url, 'https://api.resend.com/emails');
  assert.equal(inviato.auth, 'Bearer re_test');
  assert.deepEqual(inviato.to, ['g@example.com']);
  assert.match(inviato.subject, /da Anna$/);
  assert.doesNotMatch(inviato.subject, /[\r\n]/);
  assert.equal(inviato.attachments[0].content, 'JVBERi0xLjc=');
});
