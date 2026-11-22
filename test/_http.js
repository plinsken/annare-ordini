// Fake Vercel req/res for handler tests. Development host: http://localhost:3000.
process.env.VERCEL_ENV = 'development';

export const finto = () => ({ code: 200, headers: {}, body: undefined,
  status(c) { this.code = c; return this; },
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  getHeader(k) { return this.headers[k.toLowerCase()]; },
  json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end() { return this; } });

export const req = (method, body, { cookie = '', origin = 'http://localhost:3000', ip = '1.2.3.4', query = {}, headers = {} } = {}) =>
  ({ method, body, query, headers: { cookie, origin, 'x-real-ip': ip, ...headers } });

// Keeps cookies across calls, like a browser: biscotti(res, jar) -> new jar string.
export function biscotti(res, jar = '') {
  const m = new Map(jar.split(/;\s*/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
  for (const c of [res.getHeader('set-cookie') ?? []].flat()) {
    const [nv] = c.split(';'), [n, v] = nv.split(/=(.*)/s);
    if (/Max-Age=0\b/.test(c)) m.delete(n); else m.set(n, v);
  }
  return [...m].map(([n, v]) => `${n}=${v}`).join('; ');
}

// Calls a handler and returns the response; `jar` (object with .c) is updated with cookies.
export async function chiama(handler, method, body, opts = {}, jar) {
  const r = finto();
  await handler(req(method, body, { ...opts, cookie: opts.cookie ?? jar?.c ?? '' }), r);
  if (jar) jar.c = biscotti(r, jar.c);
  return r;
}
