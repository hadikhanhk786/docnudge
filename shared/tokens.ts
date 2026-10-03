// Client upload links carry a signed token instead of a stored secret:
//   <requestId>.<version>.<hmac>
// Nothing secret is stored in the database, links can be re-shown any time,
// and bumping requests.link_version revokes every older link.

const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toB64Url(new Uint8Array(sig)).slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeToken(secret: string, requestId: string, version: number): Promise<string> {
  return `${requestId}.${version}.${await sign(secret, `${requestId}:${version}`)}`;
}

export async function verifyToken(secret: string, token: string): Promise<{ requestId: string; version: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [requestId, versionStr, sig] = parts;
  if (!UUID_RE.test(requestId) || !/^\d{1,6}$/.test(versionStr)) return null;
  const version = Number(versionStr);
  const expected = await sign(secret, `${requestId}:${version}`);
  return safeEqual(expected, sig) ? { requestId, version } : null;
}
