import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.JWT_SECRET || 'assetview-dev-secret-change-me';
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

function b64url(data) {
  return Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))
    .toString('base64url');
}

function sign(input) {
  return createHmac('sha256', SECRET).update(input).digest('base64url');
}

export function signToken(payload, ttlSec = DEFAULT_TTL_SEC) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  });
  const sig = sign(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = sign(`${header}.${body}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
