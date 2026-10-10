/**
 * Samachar Daily — Editorial Control Center Authentication & Security Engine
 *
 * Implements defense-in-depth server-side security for the local newsroom dashboard:
 * 1. Password verification via Node.js crypto.scryptSync with cryptographic salt.
 * 2. High-entropy session tokens (256-bit crypto.randomBytes) stored in server memory.
 * 3. HttpOnly, SameSite=Strict session cookies.
 * 4. 2-hour sliding session expiration with explicit logout invalidation.
 * 5. IP-based brute-force protection with exponential lockout (max 5 failed attempts per 15 min).
 * 6. Constant-time comparison (crypto.timingSafeEqual) and artificial delay to prevent timing attacks.
 * 7. Server-side route guarding for /admin/editorial/* (unauthenticated requests rejected with 302 redirect).
 * 8. Comprehensive security audit logging.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// Load local environment variables from .env if present
const envFilePath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envFilePath)) {
  try {
    const envContent = fs.readFileSync(envFilePath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (_) {}
}

// Local GSC persistence for development
const localGscTokensFile = path.resolve(__dirname, 'editorial-control-center', 'gsc-tokens.json');
let localGscTokens = null;
try {
  if (fs.existsSync(localGscTokensFile)) {
    localGscTokens = JSON.parse(fs.readFileSync(localGscTokensFile, 'utf8'));
  }
} catch (_) {}

function saveLocalGscTokens(data) {
  if (localGscTokens && localGscTokens.refresh_token && !data.refresh_token) {
    data.refresh_token = localGscTokens.refresh_token;
  }
  localGscTokens = data;
  try {
    const dir = path.dirname(localGscTokensFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localGscTokensFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

function deleteLocalGscTokens() {
  localGscTokens = null;
  try {
    if (fs.existsSync(localGscTokensFile)) fs.unlinkSync(localGscTokensFile);
  } catch (_) {}
}

function getOAuthSigningSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    return null;
  }
  return secret.trim();
}


// Local in-memory cache and used OAuth state tracker
const localGscCache = new Map();
const usedOAuthStates = new Set();

let gscModulePromise = null;
function getGSCModule() {
  if (!gscModulePromise) {
    gscModulePromise = import('../worker/gsc.js');
  }
  return gscModulePromise;
}

let newsletterModulePromise = null;
function getNewsletterModule() {
  if (!newsletterModulePromise) {
    newsletterModulePromise = import('../worker/newsletter.js');
  }
  return newsletterModulePromise;
}

// Local in-memory members registry for development parity
const localMembers = [
  {
    id: 'usr_root_arjun',
    email: 'thesamachardaily@gmail.com',
    name: 'Arjun',
    role: 'owner',
    title: 'Root Owner / Technical Admin',
    status: 'active',
    created_at: 1700000000000,
    last_login: null
  }
];
const localInvitations = [];


function getLocalGSCEnv() {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || null,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || null,
    GSC_PROPERTY_ID: process.env.GSC_PROPERTY_ID || 'https://thesamachardaily.in/',
    AUTH_KV: {
      async get(key) {
        if (key === 'gsc:tokens') {
          return localGscTokens ? JSON.stringify(localGscTokens) : null;
        }
        return localGscCache.get(key) || null;
      },
      async put(key, value, options) {
        if (key === 'gsc:tokens') {
          saveLocalGscTokens(typeof value === 'string' ? JSON.parse(value) : value);
        } else {
          localGscCache.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
      },
      async delete(key) {
        if (key === 'gsc:tokens') {
          deleteLocalGscTokens();
        } else {
          localGscCache.delete(key);
        }
      },
      async list(options) {
        const prefix = options?.prefix || '';
        const keys = [];
        for (const k of localGscCache.keys()) {
          if (k.startsWith(prefix)) keys.push({ name: k });
        }
        return { keys };
      }
    }
  };
}

// Strict path regex for article Markdown files
const ARTICLE_PATH_REGEX = /^src\/articles\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.md$/;

// Calculate Git blob SHA for consistent concurrency conflict checking
function computeGitBlobSha(content) {
  const normalized = (typeof content === 'string' ? content : content.toString('utf8')).replace(/\r\n/g, '\n');
  const buf = Buffer.from(normalized, 'utf8');
  const header = Buffer.from(`blob ${buf.length}\0`);
  return crypto.createHash('sha1').update(Buffer.concat([header, buf])).digest('hex');
}

// Safe path resolver for article Markdown files
function getArticleFilePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const forwardPath = relPath.replace(/\\/g, '/');
  if (!ARTICLE_PATH_REGEX.test(forwardPath)) {
    return null;
  }
  const fullPath = path.resolve(__dirname, '..', forwardPath);
  const articlesRoot = path.resolve(__dirname, '..', 'src', 'articles');
  if (!fullPath.startsWith(articlesRoot)) {
    return null;
  }
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return fullPath;
}

// Helper to safely parse incoming JSON body from Node HTTP request
function parseJsonBody(req, maxBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function parseRequestBody(req, maxBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      const cType = req.headers['content-type'] || '';
      if (cType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        const obj = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        return resolve(obj);
      }
      try {
        const parsed = JSON.parse(body || '{}');
        resolve(parsed);
      } catch (_) {
        try {
          const params = new URLSearchParams(body);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          resolve(obj);
        } catch (e) {
          resolve({});
        }
      }
    });
    req.on('error', reject);
  });
}


// Configuration
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const COOKIE_NAME = 'samachar_admin_session';

// Salt & Scrypt derived key for default administrative password
// Default newsroom password: "Samachar@Admin2026!"
// Satisfies strong policy: 19 chars, uppercase, lowercase, numbers, special characters
const DEFAULT_SALT = 'e7a9b1c3d5f8246019384756abcdef12';
const DEFAULT_HASH = crypto.scryptSync('Samachar@Admin2026!', DEFAULT_SALT, 64).toString('hex');

// In-memory state stores (isolated to this server instance)
const sessions = new Map(); // token -> { username, createdAt, lastActivity, expiresAt, ip, userAgent }
const loginAttempts = new Map(); // ip -> { count, firstAttempt, lockedUntil }
const auditLog = [];

function recordSecurityAudit(event, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    details: details || {}
  };
  auditLog.push(entry);
  if (auditLog.length > 500) auditLog.shift();
  // Safe console log for server operator
  console.log(`[ADMIN SECURITY] ${entry.timestamp} | ${event} | IP: ${details.ip || 'unknown'}`);
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    '127.0.0.1'
  ).split(',')[0].trim();
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

function verifyPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') return false;

  const envPassword = process.env.ADMIN_PASSWORD;
  if (envPassword) {
    // If environment variable is configured, verify against it
    const inputHash = crypto.scryptSync(plainPassword, DEFAULT_SALT, 64);
    const targetHash = crypto.scryptSync(envPassword, DEFAULT_SALT, 64);
    return crypto.timingSafeEqual(inputHash, targetHash);
  }

  // Verify against scrypt-hashed default
  const inputHash = crypto.scryptSync(plainPassword, DEFAULT_SALT, 64);
  const targetHash = Buffer.from(DEFAULT_HASH, 'hex');
  return crypto.timingSafeEqual(inputHash, targetHash);
}

function isIpLocked(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) {
    return true;
  }
  // Reset window if expired
  if (now - record.firstAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return false;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, lockedUntil: null };
  record.count++;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_WINDOW_MS;
    recordSecurityAudit('BRUTE_FORCE_LOCKOUT_TRIGGERED', { ip, attempts: record.count, lockedUntilMs: LOCKOUT_WINDOW_MS });
  }
  loginAttempts.set(ip, record);
}

function resetFailedLogin(ip) {
  loginAttempts.delete(ip);
}

function createSession(username, ip, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    username,
    token,
    ip,
    userAgent,
    createdAt: now,
    lastActivity: now,
    expiresAt: now + SESSION_TTL_MS
  };
  sessions.set(token, session);
  recordSecurityAudit('SESSION_CREATED', { username, ip, tokenPrefix: token.substring(0, 8) });
  return session;
}

function validateSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  const now = Date.now();
  if (now > session.expiresAt) {
    sessions.delete(token);
    recordSecurityAudit('SESSION_EXPIRED', { tokenPrefix: token.substring(0, 8) });
    return null;
  }

  // Slide expiration window on activity
  session.lastActivity = now;
  session.expiresAt = now + SESSION_TTL_MS;
  return session;
}

function invalidateSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (token && sessions.has(token)) {
    sessions.delete(token);
    recordSecurityAudit('SESSION_TERMINATED', { tokenPrefix: token.substring(0, 8) });
    return true;
  }
  return false;
}

/**
 * Dev Server Middleware for Eleventy
 */
function adminAuthMiddleware(req, res, next) {
  const rawUrl = req.url || '';
  const parsedUrl = new URL(rawUrl, 'http://localhost:8080');
  const pathname = parsedUrl.pathname;
  const ip = getClientIp(req);
  const isHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

  // 1. API: Login endpoint
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    if (isIpLocked(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Too many failed login attempts. IP temporarily locked for 15 minutes.'
      }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10240) req.destroy(); // Prevent memory exhaustion
    });

    req.on('end', async () => {
      try {
        let payload = {};
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
          payload = JSON.parse(body);
        } else {
          const params = new URLSearchParams(body);
          payload = Object.fromEntries(params.entries());
        }

        const username = (payload.username || '').trim();
        const password = payload.password || '';

        // Artificially delay verification to prevent timing attack enumeration
        await new Promise(r => setTimeout(r, 200));

        if (username.toLowerCase() === 'admin' && verifyPassword(password)) {
          resetFailedLogin(ip);
          const session = createSession('admin', ip, req.headers['user-agent'] || '');

          const cookieFlags = [
            `${COOKIE_NAME}=${session.token}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            `Max-Age=${SESSION_TTL_MS / 1000}`
          ];
          if (isHttps) cookieFlags.push('Secure');

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieFlags.join('; ')
          });
          res.end(JSON.stringify({
            success: true,
            user: 'admin',
            expiresAt: session.expiresAt
          }));
        } else {
          recordFailedLogin(ip);
          recordSecurityAudit('LOGIN_FAILED', { username, ip });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Invalid administrator credentials.'
          }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed request payload.' }));
      }
    });
    return;
  }

  // 2. API: Logout endpoint
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    invalidateSession(req);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
    });
    res.end(JSON.stringify({ success: true, message: 'Logged out successfully.' }));
    return;
  }

  // 3. API: Check Session status
  if (pathname === '/api/admin/session' && req.method === 'GET') {
    const session = validateSession(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (session) {
      res.end(JSON.stringify({
        authenticated: true,
        user: session.username,
        googlePicture: (localGscTokens && localGscTokens.account_picture) || null,
        expiresAt: session.expiresAt,
        sessionTtlMinutes: Math.round((session.expiresAt - Date.now()) / 60000)
      }));
    } else {
      res.end(JSON.stringify({ authenticated: false }));
    }
    return;
  }

  // 4. API: Get Article Content & SHA on-demand
  if (pathname === '/api/admin/articles/get' && req.method === 'GET') {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    const relPath = parsedUrl.searchParams.get('relPath');
    const filePath = getArticleFilePath(relPath);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Target article source file not found or path invalid.' }));
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const sha = computeGitBlobSha(raw);
      const file = matter(raw, { cache: false });
      const wordCount = (file.content || '').trim().split(/\s+/).filter(Boolean).length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        relPath: relPath,
        sha: sha,
        data: file.data,
        body: (file.content || '').trim(),
        wordCount: wordCount
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to read article: ' + err.message }));
    }
    return;
  }

  // 5. API: Save Article Changes
  if (pathname === '/api/admin/articles/save' && req.method === 'POST') {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    parseJsonBody(req).then(payload => {
      const { relPath, sha, title, dek, category, author, image, imageCredit, sourceName, sourceUrl, seoTitle, why_it_matters, what_happens_next, body } = payload;
      const filePath = getArticleFilePath(relPath);
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Target article source file not found or path invalid.' }));
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const currentSha = computeGitBlobSha(raw);

        // Concurrency check: Compare client expected SHA with current SHA
        if (sha && sha !== currentSha) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'This article changed in GitHub since you opened it. Reload before saving.',
            conflict: true,
            currentSha: currentSha
          }));
          return;
        }

        const file = matter(raw, { cache: false });

        // Update ONLY supported editorial properties if provided; PRESERVE all others (slug, date, videos, etc.)
        if (typeof title === 'string' && title.trim()) file.data.title = title.trim();
        if (typeof dek === 'string') file.data.dek = dek.trim();
        if (typeof category === 'string' && category.trim()) file.data.category = category.trim();
        if (typeof author === 'string') file.data.author = author.trim();
        if (image !== undefined) file.data.image = image ? String(image).trim() : null;
        if (imageCredit !== undefined) file.data.imageCredit = imageCredit ? String(imageCredit).trim() : null;
        if (sourceName !== undefined) file.data.sourceName = sourceName ? String(sourceName).trim() : null;
        if (sourceUrl !== undefined) file.data.sourceUrl = sourceUrl ? String(sourceUrl).trim() : null;
        if (seoTitle !== undefined) file.data.seoTitle = seoTitle ? String(seoTitle).trim() : null;
        if (why_it_matters !== undefined) file.data.why_it_matters = why_it_matters ? String(why_it_matters).trim() : null;
        if (what_happens_next !== undefined) file.data.what_happens_next = what_happens_next ? String(what_happens_next).trim() : null;

        // Update body content if provided
        if (typeof body === 'string') {
          file.content = '\n' + body.trim() + '\n';
        }

        const newWordCount = file.content.trim().split(/\s+/).filter(Boolean).length;
        const nowIso = new Date().toISOString();

        // Write cleanly back to disk
        const updatedMarkdown = matter.stringify(file.content, file.data);
        fs.writeFileSync(filePath, updatedMarkdown, 'utf8');
        const newSha = computeGitBlobSha(updatedMarkdown);

        recordSecurityAudit('ARTICLE_SAVED', { relPath, title: file.data.title, ip });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Saved successfully',
          sha: newSha,
          modified: nowIso,
          wordCount: newWordCount,
          article: {
            ...file.data,
            body: file.content.trim(),
            relPath: relPath,
            wordCount: newWordCount
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to write article changes: ' + err.message }));
      }
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // 6. API: Archive Article (Reversible soft-prune / noindex: true)
  if (pathname === '/api/admin/articles/archive' && req.method === 'POST') {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    parseJsonBody(req).then(payload => {
      const { relPath, sha } = payload;
      const filePath = getArticleFilePath(relPath);
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Target article source file not found.' }));
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const currentSha = computeGitBlobSha(raw);

        if (sha && sha !== currentSha) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'This article changed in GitHub since you opened it. Reload before saving.',
            conflict: true,
            currentSha: currentSha
          }));
          return;
        }

        const file = matter(raw, { cache: false });
        file.data.noindex = true;
        const nowIso = new Date().toISOString();
        const updatedMarkdown = matter.stringify(file.content, file.data);
        fs.writeFileSync(filePath, updatedMarkdown, 'utf8');
        const newSha = computeGitBlobSha(updatedMarkdown);

        recordSecurityAudit('ARTICLE_ARCHIVED', { relPath, title: file.data.title, ip });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Article archived successfully (set to noindex)',
          noindex: true,
          sha: newSha,
          modified: nowIso
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to archive article: ' + err.message }));
      }
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // 7. API: Restore Article (Revert archive -> active/indexable)
  if (pathname === '/api/admin/articles/restore' && req.method === 'POST') {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    parseJsonBody(req).then(payload => {
      const { relPath, sha } = payload;
      const filePath = getArticleFilePath(relPath);
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Target article source file not found.' }));
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const currentSha = computeGitBlobSha(raw);

        if (sha && sha !== currentSha) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'This article changed in GitHub since you opened it. Reload before saving.',
            conflict: true,
            currentSha: currentSha
          }));
          return;
        }

        const file = matter(raw, { cache: false });
        delete file.data.noindex;
        const nowIso = new Date().toISOString();
        const updatedMarkdown = matter.stringify(file.content, file.data);
        fs.writeFileSync(filePath, updatedMarkdown, 'utf8');
        const newSha = computeGitBlobSha(updatedMarkdown);

        recordSecurityAudit('ARTICLE_RESTORED', { relPath, title: file.data.title, ip });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Article restored successfully (active/indexable)',
          noindex: false,
          sha: newSha,
          modified: nowIso
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to restore article: ' + err.message }));
      }
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // 8. API: Delete Article (Guarded Destructive Action)
  if (pathname === '/api/admin/articles/delete' && req.method === 'POST') {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    parseJsonBody(req).then(payload => {
      const { relPath, confirmTitle, sha } = payload;
      const filePath = getArticleFilePath(relPath);
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Target article source file not found.' }));
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const currentSha = computeGitBlobSha(raw);

        if (sha && sha !== currentSha) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'This article changed in GitHub since you opened it. Reload before saving.',
            conflict: true,
            currentSha: currentSha
          }));
          return;
        }

        const file = matter(raw, { cache: false });

        // Guard 1: Protect against deleting redirect stubs
        if (file.data.redirect || file.data.redirect_to || file.data.layout === 'redirect' || file.data.layout === 'layouts/redirect.njk') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Cannot delete redirect stub. Redirect stubs protect canonical backlinks and prevent crawl penalties.'
          }));
          return;
        }

        // Guard 2: Protect against deleting protected articles
        if (file.data.protected === true) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Cannot delete protected article.'
          }));
          return;
        }

        // Guard 3: Deliberate confirmation matching
        const enteredConfirm = (confirmTitle || '').trim().toLowerCase();
        if (enteredConfirm !== 'delete') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Confirmation phrase mismatch. Please enter "DELETE" to confirm.'
          }));
          return;
        }

        // Permanent deletion of source file
        fs.unlinkSync(filePath);

        recordSecurityAudit('ARTICLE_DELETED', { relPath, title: file.data.title, ip });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Article permanently deleted from source corpus.',
          relPath: relPath
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to delete article: ' + err.message }));
      }
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // 3G. GSC API ENDPOINTS (Phase 2 & 2.1 Local Support)
  if (pathname.startsWith('/api/admin/gsc/')) {
    // Only the exact OAuth callback route is exempted from the session cookie check
    // because browsers withhold SameSite=Strict cookies on incoming cross-origin redirects from Google.
    // The callback route strictly enforces cryptographic HMAC state validation instead.
    if (pathname !== '/api/admin/gsc/auth/callback') {
      const session = validateSession(req);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
        return;
      }
    }

    // Status
    if (pathname === '/api/admin/gsc/status' && req.method === 'GET') {
      (async () => {
        try {
          const gsc = await getGSCModule();
          const status = await gsc.getGSCStatus(getLocalGSCEnv());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // Auth Start
    if (pathname === '/api/admin/gsc/auth/start' && req.method === 'GET') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
      const format = urlObj.searchParams.get('format');
      const wantsJson = (req.headers.accept && req.headers.accept.includes('application/json')) || format === 'json';

      if (!clientId || !clientSecret) {
        const errMsg = 'Google OAuth client credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured in your local environment. Set them in your environment or Cloudflare secrets to enable Google sign-in.';
        if (wantsJson) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: errMsg }));
        } else {
          res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=missing_credentials#search' });
          res.end();
        }
        return;
      }

      const secretKey = getOAuthSigningSecret();
      if (!secretKey) {
        const errMsg = 'OAuth signing secret (ADMIN_SESSION_SECRET) is missing or too weak (must be at least 32 characters). Configure ADMIN_SESSION_SECRET before initiating OAuth.';
        if (wantsJson) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: errMsg }));
        } else {
          res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=insecure_signing_secret#search' });
          res.end();
        }
        return;
      }

      const redirectUri = process.env.GSC_REDIRECT_URI || `http://${req.headers.host || 'localhost:8080'}/api/admin/gsc/auth/callback`;
      const statePayload = { action: 'gsc_connect', ts: Date.now() };
      const rawState = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
      const sig = crypto.createHmac('sha256', secretKey).update(rawState).digest('base64url');
      const state = `${rawState}.${sig}`;

      (async () => {
        try {
          const gsc = await getGSCModule();
          const googleAuthUrl = gsc.buildGSCAuthUrl({
            clientId,
            redirectUri,
            state
          });

          if (wantsJson) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, authUrl: googleAuthUrl }));
          } else {
            res.writeHead(302, { 'Location': googleAuthUrl });
            res.end();
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // Auth Callback
    if (pathname === '/api/admin/gsc/auth/callback' && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
      const code = urlObj.searchParams.get('code');
      const stateParam = urlObj.searchParams.get('state');
      const errParam = urlObj.searchParams.get('error');

      if (errParam) {
        res.writeHead(302, { 'Location': `/admin/editorial?gsc_error=${encodeURIComponent(errParam)}#search` });
        res.end();
        return;
      }

      const secretKey = getOAuthSigningSecret();
      if (!secretKey) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=insecure_signing_secret#search' });
        res.end();
        return;
      }

      // Validate OAuth state parameter before processing code
      if (!stateParam || typeof stateParam !== 'string' || !stateParam.includes('.')) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=invalid_state#search' });
        res.end();
        return;
      }

      const parts = stateParam.split('.');
      if (parts.length !== 2) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=invalid_state#search' });
        res.end();
        return;
      }

      const [rawState, sig] = parts;
      if (!rawState || !sig) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=invalid_state#search' });
        res.end();
        return;
      }

      // Timing-safe HMAC verification
      const expectedSig = crypto.createHmac('sha256', secretKey).update(rawState).digest('base64url');
      const sigBuf = Buffer.from(sig);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=tampered_state#search' });
        res.end();
        return;
      }

      // Replay resistance: single-use check
      if (usedOAuthStates.has(sig)) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=replayed_state#search' });
        res.end();
        return;
      }

      let parsedState;
      try {
        parsedState = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8'));
      } catch (_) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=malformed_state#search' });
        res.end();
        return;
      }

      if (!parsedState || typeof parsedState !== 'object') {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=malformed_state#search' });
        res.end();
        return;
      }

      // Verify action scope
      if (parsedState.action !== 'gsc_connect') {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=invalid_action_state#search' });
        res.end();
        return;
      }

      // Timestamp must be a finite number
      if (typeof parsedState.ts !== 'number' || !Number.isFinite(parsedState.ts)) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=invalid_timestamp_state#search' });
        res.end();
        return;
      }

      const now = Date.now();
      // Reject future-dated states (>30s clock skew tolerance)
      if (parsedState.ts > now + 30 * 1000) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=future_state#search' });
        res.end();
        return;
      }

      // 10-minute expiration check (600,000 ms)
      if (now - parsedState.ts > 10 * 60 * 1000) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=expired_state#search' });
        res.end();
        return;
      }

      // Mark state as consumed to prevent replay in this process
      usedOAuthStates.add(sig);

      // Validate authorization code before exchange
      if (!code || typeof code !== 'string' || !code.trim() || code.length > 2048) {
        res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=missing_code#search' });
        res.end();
        return;
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GSC_REDIRECT_URI || `http://${req.headers.host || 'localhost:8080'}/api/admin/gsc/auth/callback`;

      (async () => {
        try {
          const gsc = await getGSCModule();
          const rawTokens = await gsc.exchangeGSCCode({
            code: code.trim(),
            clientId,
            clientSecret,
            redirectUri
          });

          const tokens = {
            ...rawTokens,
            expires_at: Date.now() + ((rawTokens.expires_in || 3600) * 1000),
            connected_at: new Date().toISOString()
          };

          await gsc.saveGSCTokens(getLocalGSCEnv(), tokens);

          res.writeHead(302, { 'Location': '/admin/editorial?gsc=connected#search' });
          res.end();
        } catch (err) {
          recordSecurityAudit('GSC_AUTH_CALLBACK_FAILED', {
            error: err.message ? err.message.replace(/code=[^&\s]+/gi, 'code=[REDACTED]') : 'Token exchange error'
          });
          res.writeHead(302, { 'Location': '/admin/editorial?gsc_error=token_exchange_failed#search' });
          res.end();
        }
      })();
      return;
    }

    // Disconnect
    if (pathname === '/api/admin/gsc/disconnect' && req.method === 'POST') {
      (async () => {
        try {
          const gsc = await getGSCModule();
          await gsc.deleteGSCTokens(getLocalGSCEnv());
          deleteLocalGscTokens();
          localGscCache.clear();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Google Search Console disconnected successfully.' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // Performance
    if (pathname === '/api/admin/gsc/performance' && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
      const range = urlObj.searchParams.get('range') || '28days';
      const customStart = urlObj.searchParams.get('startDate');
      const customEnd = urlObj.searchParams.get('endDate');
      const searchType = urlObj.searchParams.get('type') || 'web';
      const forceRefresh = urlObj.searchParams.get('refresh') === 'true';

      (async () => {
        try {
          const gsc = await getGSCModule();
          const perf = await gsc.getGSCPerformanceDashboard(getLocalGSCEnv(), {
            range,
            customStart,
            customEnd,
            searchType,
            forceRefresh
          });
          const statusCode = perf.success ? 200 : (perf.errorCode === 'PERMISSION_DENIED' ? 403 : 502);
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(perf));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, connected: true, error: err.message || 'Failed to fetch Search Console data.' }));
        }
      })();
      return;
    }

    // Inspect (GET or POST)
    if (pathname === '/api/admin/gsc/inspect' && (req.method === 'GET' || req.method === 'POST')) {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
      (async () => {
        try {
          let targetUrl = '';
          let forceRefresh = false;

          if (req.method === 'POST') {
            try {
              const body = await parseJsonBody(req);
              targetUrl = (body.url || '').trim();
              forceRefresh = Boolean(body.refresh);
            } catch (_) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload.' }));
              return;
            }
          } else {
            targetUrl = (urlObj.searchParams.get('url') || '').trim();
            forceRefresh = urlObj.searchParams.get('refresh') === 'true';
          }

          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing required parameter: url.' }));
            return;
          }

          const gsc = await getGSCModule();
          const validation = gsc.validateInspectUrl(targetUrl);
          if (!validation.valid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: validation.error, errorCode: 'INVALID_URL' }));
            return;
          }

          const inspection = await gsc.inspectUrl(getLocalGSCEnv(), { url: validation.url, forceRefresh });
          const httpStatus = inspection.success ? 200 : (inspection.status || 500);
          res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(inspection));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message || 'Failed to inspect URL.' }));
        }
      })();
      return;
    }
  }

  // 3H. PUBLIC NEWSLETTER ENDPOINTS (Phase J)
  if (pathname === '/api/newsletter/subscribe' && req.method === 'POST') {
    (async () => {
      try {
        const body = await parseRequestBody(req);
        const email = body.email || body['entry.963532165'] || '';
        const source = body.source || 'web';
        const nl = await getNewsletterModule();
        const result = await nl.registerSubscriber(getLocalGSCEnv(), {
          email,
          source,
          metadata: {
            userAgent: req.headers['user-agent'] || '',
            referrer: req.headers['referer'] || ''
          }
        });
        const status = result.success ? 200 : 400;

        // If form submission from browser without JS, redirect back
        const cType = req.headers['content-type'] || '';
        if (cType.includes('application/x-www-form-urlencoded')) {
          const redirectUrl = (req.headers['referer'] || '/') + '?newsletter=' + (result.success ? 'success' : 'error');
          res.writeHead(303, { 'Location': redirectUrl });
          res.end();
          return;
        }

        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Subscription failed.' }));
      }
    })();
    return;
  }

  if (pathname === '/api/newsletter/unsubscribe' && (req.method === 'GET' || req.method === 'POST')) {
    (async () => {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
        const token = (urlObj.searchParams.get('token') || '').trim();
        const id = (urlObj.searchParams.get('id') || '').trim();
        const confirmParam = urlObj.searchParams.get('confirm');
        const nl = await getNewsletterModule();

        const isPost = req.method === 'POST';
        const isConfirmedGet = req.method === 'GET' && confirmParam === '1';
        const acceptsHtml = (req.headers['accept'] || '').includes('text/html');

        // 1. Token Requirement: Public requests must provide a valid unsubscribe token.
        // Bare IDs alone are strictly rejected.
        if (!token) {
          if (acceptsHtml) {
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe Notice — Samachar Daily</title><style>body{font-family:-apple-system,sans-serif;background:#090d16;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.card{background:#101726;border:1px solid:#1e293b;border-radius:12px;padding:32px;max-width:480px;width:100%;text-align:center}.badge{display:inline-block;background:#C81E2C;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;margin-bottom:16px}h1{font-size:20px;margin:0 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px}a.btn{display:inline-block;background:#1e293b;color:#f8fafc;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600}</style></head><body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Unsubscribe Notice</h1><p>A valid unsubscribe verification token is required.</p><a href="/" class="btn">Return to Newsroom</a></div></body></html>`;
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A valid unsubscribe verification token is required.', errorCode: 'INVALID_TOKEN' }));
          return;
        }

        // 2. Resolve subscriber by token
        const existingSub = await nl.getSubscriberByToken(getLocalGSCEnv(), token);
        if (!existingSub) {
          if (acceptsHtml) {
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe Notice — Samachar Daily</title><style>body{font-family:-apple-system,sans-serif;background:#090d16;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.card{background:#101726;border:1px solid:#1e293b;border-radius:12px;padding:32px;max-width:480px;width:100%;text-align:center}.badge{display:inline-block;background:#C81E2C;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;margin-bottom:16px}h1{font-size:20px;margin:0 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px}a.btn{display:inline-block;background:#1e293b;color:#f8fafc;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600}</style></head><body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Unsubscribe Notice</h1><p>Subscriber record not found or link has expired.</p><a href="/" class="btn">Return to Newsroom</a></div></body></html>`;
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Subscriber record not found or link has expired.', errorCode: 'NOT_FOUND' }));
          return;
        }

        // Token belongs to someone else if id provided does not match
        if (id && existingSub.id !== id) {
          if (acceptsHtml) {
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe Notice — Samachar Daily</title><style>body{font-family:-apple-system,sans-serif;background:#090d16;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.card{background:#101726;border:1px solid:#1e293b;border-radius:12px;padding:32px;max-width:480px;width:100%;text-align:center}.badge{display:inline-block;background:#C81E2C;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;margin-bottom:16px}h1{font-size:20px;margin:0 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px}a.btn{display:inline-block;background:#1e293b;color:#f8fafc;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600}</style></head><body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Unsubscribe Notice</h1><p>Invalid or forged unsubscribe token.</p><a href="/" class="btn">Return to Newsroom</a></div></body></html>`;
            res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid or forged unsubscribe token.', errorCode: 'UNAUTHORIZED' }));
          return;
        }

        // 3. Mutating Execution: Either POST or confirm=1 GET
        if (isPost || isConfirmedGet) {
          const result = await nl.unsubscribeSubscriber(getLocalGSCEnv(), { id: existingSub.id, token });
          const status = result.success ? 200 : 400;

          if (acceptsHtml && req.method === 'GET') {
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Unsubscribe — Samachar Daily</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; }
    .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    a.btn { display: inline-block; background: #1e293b; color: #f8fafc; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">SAMACHAR DAILY</div>
    <h1>${result.success ? 'Unsubscribed Successfully' : 'Unsubscribe Notice'}</h1>
    <p>${result.message || result.error}</p>
    <a href="/" class="btn">Return to Newsroom</a>
  </div>
</body>
</html>`;
            res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }

          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        // 4. Safe GET Request
        if (existingSub.status === 'unsubscribed') {
          if (acceptsHtml) {
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Already Unsubscribed — Samachar Daily</title><style>body{font-family:-apple-system,sans-serif;background:#090d16;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.card{background:#101726;border:1px solid:#1e293b;border-radius:12px;padding:32px;max-width:480px;width:100%;text-align:center}.badge{display:inline-block;background:#C81E2C;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;margin-bottom:16px}h1{font-size:20px;margin:0 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px}a.btn{display:inline-block;background:#1e293b;color:#f8fafc;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600}</style></head><body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Already Unsubscribed</h1><p>You are already unsubscribed from The Daily Briefing.</p><a href="/" class="btn">Return to Newsroom</a></div></body></html>`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, status: 'unsubscribed', message: 'You are already unsubscribed from The Daily Briefing.', alreadyUnsubscribed: true }));
          return;
        }

        // Active subscriber: render confirmation landing page with POST button
        const actionUrl = `/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
        const confirmHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Confirm Unsubscribe — Samachar Daily</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; }
    .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    button.btn-unsub { background: #C81E2C; color: #fff; border: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button.btn-unsub:hover { background: #991b1b; }
    .cancel-link { display: block; margin-top: 16px; color: #64748b; font-size: 13px; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">SAMACHAR DAILY</div>
    <h1>Confirm Unsubscribe</h1>
    <p>Are you sure you want to stop receiving The Daily Briefing in your inbox?</p>
    <form method="POST" action="${actionUrl}">
      <button type="submit" class="btn-unsub">Confirm Unsubscribe</button>
    </form>
    <a href="/" class="cancel-link">Never mind, keep my subscription</a>
  </div>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(confirmHtml);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Unsubscribe failed.' }));
      }
    })();
    return;
  }

  // 3I. AUTHENTICATED ADMIN NEWSLETTER ENDPOINTS (Phase J)
  if (pathname.startsWith('/api/admin/newsletter/')) {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);

    // GET /api/admin/newsletter/subscribers
    if (pathname === '/api/admin/newsletter/subscribers' && req.method === 'GET') {
      const page = urlObj.searchParams.get('page') || 1;
      const limit = urlObj.searchParams.get('limit') || 50;
      const search = urlObj.searchParams.get('search') || '';
      const status = urlObj.searchParams.get('status') || 'all';

      (async () => {
        try {
          const nl = await getNewsletterModule();
          const result = await nl.listSubscribers(getLocalGSCEnv(), { page, limit, search, status });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // GET /api/admin/newsletter/stats
    if (pathname === '/api/admin/newsletter/stats' && req.method === 'GET') {
      (async () => {
        try {
          const nl = await getNewsletterModule();
          const result = await nl.getNewsletterStats(getLocalGSCEnv());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // POST /api/admin/newsletter/subscribers/status
    if (pathname === '/api/admin/newsletter/subscribers/status' && req.method === 'POST') {
      (async () => {
        try {
          const body = await parseJsonBody(req);
          const nl = await getNewsletterModule();
          const result = await nl.updateSubscriberStatus(getLocalGSCEnv(), { id: body.id, status: body.status });
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // POST /api/admin/newsletter/subscribers/delete
    if (pathname === '/api/admin/newsletter/subscribers/delete' && req.method === 'POST') {
      (async () => {
        try {
          const body = await parseJsonBody(req);
          const nl = await getNewsletterModule();
          const result = await nl.deleteSubscriber(getLocalGSCEnv(), { id: body.id });
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // GET /api/admin/newsletter/campaigns
    if (pathname === '/api/admin/newsletter/campaigns' && req.method === 'GET') {
      (async () => {
        try {
          const nl = await getNewsletterModule();
          const campaigns = await nl.getCampaignsIndex(getLocalGSCEnv());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, campaigns }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // POST /api/admin/newsletter/campaigns OR /api/admin/newsletter/campaigns/draft
    if ((pathname === '/api/admin/newsletter/campaigns' || pathname === '/api/admin/newsletter/campaigns/draft') && req.method === 'POST') {
      (async () => {
        try {
          const body = await parseJsonBody(req);
          const nl = await getNewsletterModule();
          const result = await nl.saveCampaignDraft(getLocalGSCEnv(), {
            id: body.id,
            title: body.title || body.subject || 'Draft Campaign',
            subject: body.subject,
            preheader: body.preheader,
            bodyContent: body.bodyContent || body.content,
            targetAudience: body.targetAudience,
            author: session.username || 'Editor'
          });
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // GET or POST /api/admin/newsletter/campaigns/preview
    if (pathname === '/api/admin/newsletter/campaigns/preview' && (req.method === 'GET' || req.method === 'POST')) {
      (async () => {
        try {
          let postBody = {};
          if (req.method === 'POST') {
            postBody = await parseJsonBody(req);
          }
          const campId = postBody.id || urlObj.searchParams.get('id');
          const nl = await getNewsletterModule();
          let campaign = null;
          if (campId) {
            campaign = await nl.getCampaignById(getLocalGSCEnv(), campId);
          }
          const renderedHtml = nl.renderCampaignHtml({
            title: postBody.title || (campaign ? campaign.title : (urlObj.searchParams.get('title') || 'The Daily Briefing')),
            subject: postBody.subject || (campaign ? campaign.subject : (urlObj.searchParams.get('subject') || "Today's Top Verified Dispatches")),
            preheader: postBody.preheader || (campaign ? campaign.preheader : (urlObj.searchParams.get('preheader') || '')),
            bodyContent: postBody.bodyContent || postBody.content || (campaign ? campaign.bodyContent : (urlObj.searchParams.get('body') || '')),
            subscriberEmail: 'editor-preview@thesamachardaily.in',
            unsubscribeUrl: 'https://thesamachardaily.in/api/newsletter/unsubscribe?preview=1'
          });

          if (urlObj.searchParams.get('raw') === 'true') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderedHtml);
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, previewHtml: renderedHtml, html: renderedHtml }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // POST /api/admin/newsletter/campaigns/send
    if (pathname === '/api/admin/newsletter/campaigns/send' && req.method === 'POST') {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        deliveryConfigured: false,
        error: 'Email delivery provider is unconfigured. Real campaign delivery is deferred to Phase M.',
        message: 'Email delivery provider is unconfigured. Real campaign delivery is deferred to Phase M.',
        deliveryProvider: null,
        isSimulation: true
      }));
      return;
    }

    // GET /api/admin/newsletter/digest/preview (Phase M)
    if (pathname === '/api/admin/newsletter/digest/preview' && req.method === 'GET') {
      (async () => {
        try {
          const nl = await getNewsletterModule();
          let articles = [];
          const searchIndexPath = path.resolve(__dirname, '../_site/search-index.json');
          const qualityIndexPath = path.resolve(__dirname, 'editorial-control-center/article-quality-index.json');
          if (fs.existsSync(searchIndexPath)) {
            try { articles = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8')); } catch (_) {}
          } else if (fs.existsSync(qualityIndexPath)) {
            try {
              const q = JSON.parse(fs.readFileSync(qualityIndexPath, 'utf8'));
              articles = q.articles || [];
            } catch (_) {}
          }

          const digestDate = urlObj.searchParams.get('date') || undefined;
          const digest = nl.buildDailyDigest(articles, { digestDate });
          const previewHtml = nl.renderDigestHtml(digest, { subscriberEmail: 'editor-preview@thesamachardaily.in' });
          const previewText = nl.renderDigestPlainText(digest, { subscriberEmail: 'editor-preview@thesamachardaily.in' });

          if (urlObj.searchParams.get('raw') === 'true') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(previewHtml);
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, digest, previewHtml, previewText }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // POST /api/admin/newsletter/digest/test-run (Phase M)
    if (pathname === '/api/admin/newsletter/digest/test-run' && req.method === 'POST') {
      (async () => {
        try {
          const nl = await getNewsletterModule();
          let articles = [];
          const searchIndexPath = path.resolve(__dirname, '../_site/search-index.json');
          const qualityIndexPath = path.resolve(__dirname, 'editorial-control-center/article-quality-index.json');
          if (fs.existsSync(searchIndexPath)) {
            try { articles = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8')); } catch (_) {}
          } else if (fs.existsSync(qualityIndexPath)) {
            try {
              const q = JSON.parse(fs.readFileSync(qualityIndexPath, 'utf8'));
              articles = q.articles || [];
            } catch (_) {}
          }

          const body = await parseJsonBody(req);
          const digest = nl.buildDailyDigest(articles, { digestDate: body.digestDate });
          const subscribers = await nl.getSubscribersIndex(getLocalGSCEnv());
          const runResult = await nl.executeDailyDigestRun({ env: getLocalGSCEnv(), digest, subscribers });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, runResult }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // GET /api/admin/newsletter/digest/status (Phase M)
    if (pathname === '/api/admin/newsletter/digest/status' && req.method === 'GET') {
      (async () => {
        try {
          const nl = await getNewsletterModule();
          const digestDate = urlObj.searchParams.get('date') || new Date().toISOString().slice(0, 10);
          const runStatus = await getLocalGSCEnv().AUTH_KV.get(`newsletter:digest_run:${digestDate}`, 'json');
          const deliveryConfig = nl.getDeliveryConfig(getLocalGSCEnv());

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            digestDate,
            runStatus: runStatus || { status: 'idle', digestDate },
            deliveryConfig
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }
  }

  // 3J. AUTHENTICATED ADMIN MEMBERS ENDPOINTS (Local Dev Parity)
  if (pathname.startsWith('/api/admin/members')) {
    const session = validateSession(req);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }));
      return;
    }

    // GET /api/admin/members
    if (pathname === '/api/admin/members' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        count: localMembers.length,
        members: localMembers
      }));
      return;
    }

    // GET /api/admin/members/invitations
    if (pathname === '/api/admin/members/invitations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        count: localInvitations.length,
        invitations: localInvitations
      }));
      return;
    }

    // POST /api/admin/members/invite
    if (pathname === '/api/admin/members/invite' && req.method === 'POST') {
      (async () => {
        try {
          const body = await parseJsonBody(req);
          const email = (body.email || '').trim().toLowerCase();
          const role = (body.role || '').trim().toLowerCase();

          if (!email || !/^[a-zA-Z0-9._%+-]+@(gmail\.com|googlemail\.com)$/i.test(email)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Invitation email must be a valid Google / Gmail address (@gmail.com or @googlemail.com).'
            }));
            return;
          }

          if (role !== 'admin' && role !== 'editor') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Invalid role. Assignable roles are "admin" or "editor".'
            }));
            return;
          }

          const existingMember = localMembers.find(m => m.email.toLowerCase() === email);
          if (existingMember) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: `Member with email "${email}" already exists.`
            }));
            return;
          }

          const invitation = {
            id: 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
            email,
            role,
            status: 'pending',
            invited_by: session.username || 'admin',
            created_at: Date.now(),
            expires_at: Date.now() + 48 * 3600 * 1000
          };
          localInvitations.push(invitation);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Invitation created (local simulation).',
            invitation
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message || 'Failed to process invitation.' }));
        }
      })();
      return;
    }

    // POST /api/admin/members/invite/cancel
    if (pathname === '/api/admin/members/invite/cancel' && req.method === 'POST') {
      (async () => {
        try {
          const body = await parseJsonBody(req);
          const invitationId = (body.invitationId || '').trim();
          const inv = localInvitations.find(i => i.id === invitationId);
          if (!inv) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invitation not found.' }));
            return;
          }
          inv.status = 'cancelled';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Invitation cancelled.' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }

    // POST /api/admin/members/invite/delete
    if (pathname === '/api/admin/members/invite/delete' && req.method === 'POST') {
      (async () => {
        try {
          const body = await parseJsonBody(req);
          const invitationId = (body.invitationId || '').trim();
          const idx = localInvitations.findIndex(i => i.id === invitationId);
          if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invitation not found.' }));
            return;
          }
          localInvitations.splice(idx, 1);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Invitation deleted.' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      })();
      return;
    }
  }


  // 4. Route Guard: Protected Editorial Surface (/admin/editorial/*)
  if (pathname.startsWith('/admin/editorial')) {
    const session = validateSession(req);
    if (!session) {
      recordSecurityAudit('UNAUTHORIZED_ACCESS_BLOCKED', { path: pathname, ip });
      // Redirect unauthenticated visitor to the Login portal
      res.writeHead(302, {
        'Location': '/admin/',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end();
      return;
    }
    // Authenticated: Proceed to Eleventy static file serving
    return next();
  }

  // 5. Login Portal: /admin/ or /admin/index.html
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html') {
    const session = validateSession(req);
    if (session) {
      // If already authenticated, redirect straight to the dashboard
      res.writeHead(302, {
        'Location': '/admin/editorial/',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end();
      return;
    }
    // Unauthenticated: Proceed to serve the Login Page
    return next();
  }

  // Non-admin routes: proceed normally
  return next();
}

module.exports = {
  adminAuthMiddleware,
  verifyPassword,
  validateSession,
  createSession,
  invalidateSession,
  recordSecurityAudit,
  auditLog,
  getLocalGSCEnv
};

if (require.main === module) {
  const http = require('http');
  const url = require('url');
  const siteDir = path.resolve(__dirname, '..', '_site');
  const server = http.createServer((req, res) => {
    adminAuthMiddleware(req, res, () => {
      let rawPath = req.url ? req.url.split('?')[0] : '/';
      let decodedPath = '';
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
      }
      if (decodedPath.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      if (decodedPath.endsWith('/')) decodedPath += 'index.html';
      const safePath = path.resolve(siteDir, '.' + path.normalize(decodedPath));
      const rel = path.relative(siteDir, safePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const contentTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml'
        };
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(safePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  });
  const port = parseInt(process.env.PORT || '8080', 10);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Standalone local admin server running at http://127.0.0.1:${port}`);
  });
}
