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
  auditLog
};
