// A software passkey (ES256, attestation "none") so tests can sign real WebAuthn responses.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => createHash('sha256').update(b).digest();
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

function cbor(v) {
  const head = (t, n) => Buffer.from(n < 24 ? [t << 5 | n] : n < 256 ? [t << 5 | 24, n] : [t << 5 | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  const e = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, e.length), ...e.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export function nuovoAutenticatore({ rpID = 'localhost', origin = 'http://localhost:3000' } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  let contatore = 0, userHandle;
  const client = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const flags = (uv, at) => Buffer.from([0x01 | (uv ? 0x04 : 0) | (at ? 0x40 : 0)]);

  return {
    id: b64u(credId),
    registra(opzioni, { uv = true } = {}) {
      userHandle = opzioni.user.id;
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const authData = Buffer.concat([sha256(rpID), flags(uv, true), u32(0), Buffer.alloc(16), u16(credId.length), credId, cose]);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(client('webauthn.create', opzioni.challenge)), attestationObject: b64u(cbor({ fmt: 'none', attStmt: {}, authData })), transports: ['internal'] } };
    },
    accedi(opzioni, { uv = true } = {}) {
      if (opzioni.allowCredentials?.length && !opzioni.allowCredentials.some(c => c.id === b64u(credId))) throw new Error('passkey non ammessa');
      const authData = Buffer.concat([sha256(rpID), flags(uv, false), u32(++contatore)]);
      const cd = client('webauthn.get', opzioni.challenge);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sign('sha256', Buffer.concat([authData, sha256(cd)]), privateKey)), userHandle } };
    },
  };
}
