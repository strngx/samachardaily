/**
 * Samachar Daily — Cloudflare Worker Authentication Engine
 *
 * Implements native Web Crypto security for the Cloudflare edge:
 * 1. PBKDF2-HMAC-SHA256 password verification with constant-time byte comparison.
 * 2. High-entropy, tamper-proof session tokens signed with HMAC-SHA256.
 * 3. Zero in-memory Map dependency for production edge sessions.
 * 4. HttpOnly, Secure, SameSite=Strict, Path=/ cookies.
 * 5. 2-hour sliding session expiration window.
 * 6. Hardened HTTP security headers (CSP, Framing, MIME, No-Cache).
 * 7. Zero Node.js dependencies (100% standard Web APIs).
 */

const COOKIE_NAME = 'samachar_admin_session';
const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours

/**
 * Base64URL encoding helper
 */
export function base64UrlEncode(bytesOrString) {
  let bytes;
  if (typeof bytesOrString === 'string') {
    bytes = new TextEncoder().encode(bytesOrString);
  } else if (bytesOrString instanceof Uint8Array) {
    bytes = bytesOrString;
  } else if (bytesOrString instanceof ArrayBuffer) {
    bytes = new Uint8Array(bytesOrString);
  } else {
    bytes = new Uint8Array(bytesOrString);
  }

  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64URL decoding helper
 */
export function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Base64URL decode to string helper
 */
export function base64UrlDecodeToString(str) {
  const bytes = base64UrlDecode(str);
  return new TextDecoder().decode(bytes);
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function constantTimeCompare(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) {
    diff |= va[i] ^ vb[i];
  }
  return diff === 0;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Verifies a plaintext password against a PBKDF2 hash string:
 * Format: "pbkdf2:<iterations>:<salt_hex>:<hash_hex>"
 */
export async function verifyPassword(plainPassword, storedHashString) {
  if (!plainPassword || typeof plainPassword !== 'string') return false;
  if (!storedHashString || typeof storedHashString !== 'string') return false;

  const parts = storedHashString.trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }

  const iterations = parseInt(parts[1], 10);
  if (isNaN(iterations) || iterations < 10000) {
    return false;
  }

  const saltBytes = hexToBytes(parts[2]);
  const targetHashBytes = hexToBytes(parts[3]);

  const passwordBuffer = new TextEncoder().encode(plainPassword);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterations,
      hash: 'SHA-256'
    },
    baseKey,
    targetHashBytes.byteLength * 8
  );

  return constantTimeCompare(derivedBits, targetHashBytes);
}

/**
 * Import HMAC key for session token signing and verification
 */
async function getHmacKey(sessionSecret) {
  if (!sessionSecret || typeof sessionSecret !== 'string') {
    throw new Error('ADMIN_SESSION_SECRET must be configured.');
  }
  const secretBytes = new TextEncoder().encode(sessionSecret);
  return await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Creates a cryptographically signed HMAC-SHA256 session token.
 * Accepts either a legacy username string (e.g. 'admin') or a member identity object.
 */
export async function createSessionToken(identity, sessionSecret, ttlSeconds = SESSION_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  let sub = 'admin';
  let role = 'owner';
  let email = 'admin@samachardaily.internal';
  let name = 'Technical Admin';

  if (typeof identity === 'string') {
    sub = identity;
    role = identity.toLowerCase() === 'admin' ? 'owner' : 'editor';
    if (identity.toLowerCase() !== 'admin') {
      email = null;
      name = identity;
    }
  } else if (identity && typeof identity === 'object') {
    sub = identity.id || identity.sub || 'admin';
    role = identity.role || 'editor';
    email = identity.email || null;
    name = identity.displayName || identity.name || null;
  }

  const payload = {
    sub,
    role,
    email,
    name,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID()
  };

  const payloadString = JSON.stringify(payload);
  const payloadBase64 = base64UrlEncode(payloadString);

  const key = await getHmacKey(sessionSecret);
  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadBase64)
  );

  const signatureBase64 = base64UrlEncode(signatureBytes);
  return `${payloadBase64}.${signatureBase64}`;
}

/**
 * Verifies the signature and expiration of a session token
 */
export async function verifySessionToken(token, sessionSecret) {
  if (!token || typeof token !== 'string') return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const payloadBase64 = token.substring(0, dotIndex);
  const signatureBase64 = token.substring(dotIndex + 1);

  if (!payloadBase64 || !signatureBase64) return null;

  try {
    const key = await getHmacKey(sessionSecret);
    const signatureBytes = base64UrlDecode(signatureBase64);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(payloadBase64)
    );

    if (!isValid) return null;

    const payloadJson = base64UrlDecodeToString(payloadBase64);
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Parse cookies from the incoming HTTP Request
 */
export function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [name, ...val] = c.trim().split('=');
    if (name) {
      cookies[name] = decodeURIComponent(val.join('='));
    }
  });
  return cookies;
}

/**
 * Extract active session token from the Request
 */
export function getSessionTokenFromRequest(request) {
  const cookies = parseCookies(request);
  return cookies[COOKIE_NAME] || null;
}

/**
 * Build the Set-Cookie string for establishing an authenticated session
 */
export function buildSessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

/**
 * Build the Set-Cookie string for logging out
 */
export function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Returns security headers for admin responses
 */
export function getSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
  };
}

/**
 * Extract client IP from Cloudflare header
 */
export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         '127.0.0.1';
}

export const LOCKOUT_KEY = 'admin_lockout_state';
export const MAX_FAILED_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LOCKOUT_TTL_SECONDS = 24 * 60 * 60; // 86400s

/**
 * Resolve IP-scoped lockout storage key to prevent global denial-of-service
 */
export function getLockoutKeyForIp(clientIp) {
  const ip = (typeof clientIp === 'string' && clientIp.trim()) ? clientIp.trim() : '127.0.0.1';
  return `${LOCKOUT_KEY}:${ip}`;
}

/**
 * Check if an IP address or admin account is currently locked out
 * Supports getLockoutState(env, clientIp, currentTimeMs) and getLockoutState(env, currentTimeMs)
 * @param {object} env Worker environment bindings
 * @param {string|number} [clientIpOrTime] Optional client IP or mock time
 * @param {number} [mockTimeMs] Optional mock time if clientIp is provided
 * @returns {Promise<{ isLocked: boolean, lockedUntil?: number, attempts: number }>}
 */
export async function getLockoutState(env, clientIpOrTime = '127.0.0.1', mockTimeMs) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const clientIp = typeof clientIpOrTime === 'string' ? clientIpOrTime : '127.0.0.1';
  const currentTimeMs = typeof clientIpOrTime === 'number' ? clientIpOrTime : (mockTimeMs || Date.now());
  const key = getLockoutKeyForIp(clientIp);

  const raw = await env.AUTH_KV.get(key);
  if (!raw) {
    return { isLocked: false, attempts: 0 };
  }
  const state = JSON.parse(raw);
  if (state.lockedUntil && currentTimeMs < state.lockedUntil) {
    return {
      isLocked: true,
      lockedUntil: state.lockedUntil,
      attempts: state.attempts || MAX_FAILED_ATTEMPTS
    };
  }
  // Lockout expired automatically
  if (state.lockedUntil && currentTimeMs >= state.lockedUntil) {
    return { isLocked: false, attempts: 0 };
  }
  return {
    isLocked: false,
    attempts: state.attempts || 0
  };
}

/**
 * Record a failed login attempt scoped by client IP; activates 24h lockout upon 3rd failure
 * @param {object} env Worker environment bindings
 * @param {string|number} [clientIpOrTime] Optional client IP or mock time
 * @param {number} [mockTimeMs] Optional mock time if clientIp is provided
 * @returns {Promise<{ isLocked: boolean, lockedUntil?: number, attempts: number }>}
 */
export async function recordFailedLogin(env, clientIpOrTime = '127.0.0.1', mockTimeMs) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const clientIp = typeof clientIpOrTime === 'string' ? clientIpOrTime : '127.0.0.1';
  const currentTimeMs = typeof clientIpOrTime === 'number' ? clientIpOrTime : (mockTimeMs || Date.now());
  const key = getLockoutKeyForIp(clientIp);

  const raw = await env.AUTH_KV.get(key);
  let state = raw ? JSON.parse(raw) : null;
  
  // If account is already locked out, keep the existing lockout window (prevents DoS extension)
  if (state && state.lockedUntil && currentTimeMs < state.lockedUntil) {
    return {
      isLocked: true,
      lockedUntil: state.lockedUntil,
      attempts: state.attempts || MAX_FAILED_ATTEMPTS
    };
  }

  // If previous lockout expired, reset
  if (state && state.lockedUntil && currentTimeMs >= state.lockedUntil) {
    state = null;
  }

  const currentAttempts = (state ? state.attempts || 0 : 0) + 1;

  if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = currentTimeMs + LOCKOUT_DURATION_MS;
    const newState = {
      attempts: currentAttempts,
      lockedUntil: lockedUntil,
      lastFailureTime: currentTimeMs,
      ip: clientIp
    };
    await env.AUTH_KV.put(key, JSON.stringify(newState), {
      expirationTtl: LOCKOUT_TTL_SECONDS
    });
    return {
      isLocked: true,
      lockedUntil: lockedUntil,
      attempts: currentAttempts
    };
  } else {
    const newState = {
      attempts: currentAttempts,
      lastFailureTime: currentTimeMs,
      ip: clientIp
    };
    await env.AUTH_KV.put(key, JSON.stringify(newState), {
      expirationTtl: LOCKOUT_TTL_SECONDS
    });
    return {
      isLocked: false,
      attempts: currentAttempts
    };
  }
}

/**
 * Reset lockout state upon successful authentication for a client IP
 * @param {object} env Worker environment bindings
 * @param {string} [clientIp] Optional client IP
 * @returns {Promise<void>}
 */
export async function resetLockoutState(env, clientIp = '127.0.0.1') {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }
  const key = getLockoutKeyForIp(clientIp);
  await env.AUTH_KV.delete(key);
}

// Re-export core member & authorization helpers
export {
  ROLES,
  MEMBER_STATUS,
  INVITATION_STATUS,
  OWNER_RECORD,
  DEFAULT_ROOT_OWNER_NAME,
  getRootOwnerEmail,
  isRootOwnerEmail,
  getOwnerRecord,
  getAuthenticatedMember,
  getMemberRole,
  requireRole,
  hasPermission
} from './members.js';


