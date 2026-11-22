// Which app this deploy is, from Vercel's env, never from the Host header.
const PROD = 'ordini.annarepizzeria.com';
const PROVA = 'annare-ordini-git-prova-plinskens-projects.vercel.app';
const da = (host, origin, rpID, prova) => ({ host, origin, rpID, prova });

export function sito(env = process.env) {
  if (env.VERCEL_ENV === 'production') return da(PROD, `https://${PROD}`, PROD, false);
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'prova') return da(PROVA, `https://${PROVA}`, PROVA, true);
  if (env.VERCEL_ENV === 'development') return da('localhost:3000', 'http://localhost:3000', 'localhost', true);
  return null;
}
