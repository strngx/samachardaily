/**
 * Samachar Daily — Cloudflare Worker Entry Point
 *
 * Implements server-side authentication and routing for /admin/* and /api/admin/*
 * while delegating all public traffic directly to static assets (env.ASSETS).
 */

import {
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  getSessionTokenFromRequest,
  buildSessionCookie,
  buildClearCookie,
  getSecurityHeaders,
  getClientIp,
  getLockoutState,
  recordFailedLogin,
  resetLockoutState
} from './auth.js';

import { loginHtml, editorialHtml } from './admin-views.js';
import {
  recordAuditEvent,
  getArticleAuditHistory,
  getRecentAuditLogs,
  computeArticleDiff,
  validateArticlePayload
} from './audit.js';
import yaml from 'js-yaml';

// GitHub Contents API Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_REPO_OWNER = 'strngx';
const GITHUB_REPO_NAME = 'samachardaily';
const GITHUB_BRANCH = 'main';

// Strict path regex for article Markdown files in src/articles/<category>/<slug>.md
const ARTICLE_PATH_REGEX = /^src\/articles\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.md$/;

function validateArticleRelPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  const forwardPath = relPath.replace(/\\/g, '/');
  return ARTICLE_PATH_REGEX.test(forwardPath);
}

function decodeBase64ToUtf8(b64) {
  const cleanB64 = (b64 || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(cleanB64, 'base64').toString('utf8');
  }
  const binary = atob(cleanB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function encodeUtf8ToBase64(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parseFrontmatter(markdown) {
  const match = (markdown || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: markdown || '' };
  }
  try {
    const data = yaml.load(match[1]) || {};
    return { data, content: match[2] };
  } catch (e) {
    return { data: {}, content: markdown || '' };
  }
}

function stringifyFrontmatter(content, data) {
  const yamlStr = yaml.dump(data, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  const trimmed = (content || '').trim();
  return `---\n${yamlStr}---\n\n${trimmed}\n`;
}

function countWords(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(w => w.length > 0).length;
}

async function fetchFromGitHub(relPath, token) {
  const forwardPath = relPath.replace(/\\/g, '/');
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${forwardPath}?ref=${GITHUB_BRANCH}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SamacharDaily-Newsroom-Worker'
    }
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    let msg = `GitHub API error (${resp.status})`;
    try {
      const errJson = JSON.parse(errorText);
      if (errJson.message) msg += `: ${errJson.message}`;
    } catch (_) {}
    const error = new Error(msg);
    error.status = resp.status;
    throw error;
  }
  return await resp.json();
}

async function putToGitHub(relPath, base64Content, sha, commitMessage, token) {
  const forwardPath = relPath.replace(/\\/g, '/');
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${forwardPath}`;
  const payload = {
    message: commitMessage,
    content: base64Content,
    branch: GITHUB_BRANCH
  };
  if (sha) {
    payload.sha = sha;
  }
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SamacharDaily-Newsroom-Worker',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    let msg = `GitHub API error (${resp.status})`;
    try {
      const errJson = JSON.parse(errorText);
      if (errJson.message) msg += `: ${errJson.message}`;
    } catch (_) {}
    const error = new Error(msg);
    error.status = resp.status;
    throw error;
  }
  return await resp.json();
}

async function deleteFromGitHub(relPath, sha, commitMessage, token) {
  const forwardPath = relPath.replace(/\\/g, '/');
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${forwardPath}`;
  const payload = {
    message: commitMessage,
    sha: sha,
    branch: GITHUB_BRANCH
  };
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SamacharDaily-Newsroom-Worker',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    let msg = `GitHub API error (${resp.status})`;
    try {
      const errJson = JSON.parse(errorText);
      if (errJson.message) msg += `: ${errJson.message}`;
    } catch (_) {}
    const error = new Error(msg);
    error.status = resp.status;
    throw error;
  }
  return await resp.json();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. PUBLIC ROUTING:
    // If request is not an admin route, pass directly to Cloudflare static assets
    if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
      return env.ASSETS.fetch(request);
    }

    const method = request.method;

    // 2. API ENDPOINT: Login
    if (pathname === '/api/admin/login' && method === 'POST') {
      // Enforce edge rate limiting if bound (using stable resource identifier)
      if (env.LOGIN_RATE_LIMITER) {
        const { success } = await env.LOGIN_RATE_LIMITER.limit({ key: 'admin-login-endpoint' });
        if (!success) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Too many login attempts. Please wait 60 seconds.'
          }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              ...getSecurityHeaders()
            }
          });
        }
      }

      // Verify Cloudflare Worker Secrets and KV Lockout Binding are configured
      if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_SESSION_SECRET || !env.AUTH_KV) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Server authentication or lockout storage is not configured. Please ensure ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET, and AUTH_KV binding are configured in Cloudflare Workers.'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      }

      // Enforce 24-hour account lockout after 3 consecutive failed attempts
      const lockout = await getLockoutState(env);
      if (lockout.isLocked) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Too many failed login attempts. Try again later.'
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '86400',
            ...getSecurityHeaders()
          }
        });
      }

      try {
        const body = await request.json();
        const username = (body.username || '').trim();
        const password = body.password || '';

        if (!username || !password) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Please provide both username and password.'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...getSecurityHeaders()
            }
          });
        }

        const isPasswordValid = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
        if (username.toLowerCase() === 'admin' && isPasswordValid) {
          // Reset consecutive failure counter upon successful authentication
          await resetLockoutState(env);

          const sessionToken = await createSessionToken('admin', env.ADMIN_SESSION_SECRET);
          const cookieHeader = buildSessionCookie(sessionToken);

          return new Response(JSON.stringify({
            success: true,
            redirect: '/admin/editorial/'
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': cookieHeader,
              ...getSecurityHeaders()
            }
          });
        } else {
          // Record failed login attempt (activates 24-hour lockout on 3rd failure)
          const postFailState = await recordFailedLogin(env);
          if (postFailState.isLocked) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Too many failed login attempts. Try again later.'
            }), {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': '86400',
                ...getSecurityHeaders()
              }
            });
          }

          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid administrator credentials.'
          }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...getSecurityHeaders()
            }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Malformed JSON payload.'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      }
    }

    // 3. API ENDPOINT: Logout
    if (pathname === '/api/admin/logout' && method === 'POST') {
      const clearCookie = buildClearCookie();
      return new Response(JSON.stringify({
        success: true,
        message: 'Logged out successfully.'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearCookie,
          ...getSecurityHeaders()
        }
      });
    }

    // 4. API ENDPOINT: Session Liveness Check
    if (pathname === '/api/admin/session' && method === 'GET') {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (session) {
        return new Response(JSON.stringify({
          authenticated: true,
          user: session.sub,
          exp: session.exp
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      } else {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      }
    }

    // 5. API ENDPOINTS: Authenticated Audit Operations (Phase 6)
    if (pathname === '/api/admin/audit' || pathname.startsWith('/api/admin/audit/')) {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (!session) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      }

      // 5A. GET /api/admin/audit — Article-specific audit history
      if (pathname === '/api/admin/audit' && method === 'GET') {
        const relPath = url.searchParams.get('relPath');
        if (!validateArticleRelPath(relPath)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const history = await getArticleAuditHistory(env, relPath);
        return new Response(JSON.stringify({
          success: true,
          relPath,
          count: history.length,
          history
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5B. GET /api/admin/audit/recent — Global recent audit logs
      if (pathname === '/api/admin/audit/recent' && method === 'GET') {
        const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
        const limit = isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 100);

        const recent = await getRecentAuditLogs(env, limit);
        return new Response(JSON.stringify({
          success: true,
          count: recent.length,
          recent
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Endpoint not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
    }

    // 5C. API ENDPOINTS: Authenticated Thin Content Queue (Phase 8)
    if (pathname === '/api/admin/thin-queue' || pathname.startsWith('/api/admin/thin-queue/')) {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (!session) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      }

      // 5C-1. POST /api/admin/thin-queue/review — Mark item as reviewed or dismissed
      if (pathname === '/api/admin/thin-queue/review' && method === 'POST') {
        try {
          const body = await request.json();
          const { slug, relPath, action, notes } = body || {};

          if (!slug || typeof slug !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid or missing article slug.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const allowedActions = ['reviewed', 'dismissed', 'reset'];
          if (!action || !allowedActions.includes(action)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid action. Allowed actions: reviewed, dismissed, reset.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const reviewKey = `thin_queue:rev:${slug}`;
          const nowIso = new Date().toISOString();

          let persisted = false;

          if (action === 'reset') {
            if (env && env.AUTH_KV && typeof env.AUTH_KV.delete === 'function') {
              try {
                await env.AUTH_KV.delete(reviewKey);
                persisted = true;
              } catch (kvErr) {
                console.error('[Thin Queue KV Error] Failed to delete review state:', kvErr.message);
              }
            }
          } else {
            const reviewPayload = {
              slug,
              status: action,
              reviewer: session.email || 'admin',
              timestamp: nowIso,
              notes: typeof notes === 'string' ? notes.slice(0, 500) : ''
            };

            if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
              try {
                await env.AUTH_KV.put(reviewKey, JSON.stringify(reviewPayload));
                persisted = true;
              } catch (kvErr) {
                console.error('[Thin Queue KV Error] Failed to persist review state:', kvErr.message);
              }
            }
          }

          // Record Phase 6 audit event
          try {
            await recordAuditEvent(env, {
              actor: session.email || 'admin',
              action: 'thin_queue_review',
              slug,
              relPath: relPath || '',
              summary: `Editorial action in Thin Content Queue: marked "${slug}" as ${action}`,
              status: 'success'
            });
          } catch (auditErr) {
            console.error('[Audit Error] Failed to record queue review audit event:', auditErr.message);
          }

          return new Response(JSON.stringify({
            success: true,
            persisted,
            slug,
            action,
            timestamp: nowIso
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (e) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process request: ' + e.message
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // 5C-2. GET /api/admin/thin-queue/reviews — Batch fetch review states for active queue
      if (pathname === '/api/admin/thin-queue/reviews' && method === 'GET') {
        const slugsParam = url.searchParams.get('slugs') || '';
        const slugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);

        const reviews = {};
        if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
          for (const s of slugs) {
            if (/^[a-zA-Z0-9_-]+$/.test(s)) {
              try {
                const val = await env.AUTH_KV.get(`thin_queue:rev:${s}`);
                if (val) {
                  reviews[s] = JSON.parse(val);
                }
              } catch (_) {}
            }
          }
        }

        return new Response(JSON.stringify({
          success: true,
          count: Object.keys(reviews).length,
          reviews
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Endpoint not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
    }

    // 6. API ENDPOINTS: Authenticated Article Operations
    if (pathname.startsWith('/api/admin/articles/')) {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (!session) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...getSecurityHeaders()
          }
        });
      }

      // 5A. GET /api/admin/articles/get — Fetch article content and Git SHA on-demand
      if (pathname === '/api/admin/articles/get' && method === 'GET') {
        const relPath = url.searchParams.get('relPath');
        if (!validateArticleRelPath(relPath)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        if (!env.GITHUB_CONTENTS_TOKEN) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Server GitHub Contents integration is not configured. Please configure GITHUB_CONTENTS_TOKEN in Cloudflare Worker Secrets.'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        try {
          const ghFile = await fetchFromGitHub(relPath, env.GITHUB_CONTENTS_TOKEN);
          const rawMarkdown = decodeBase64ToUtf8(ghFile.content || '');
          const parsed = parseFrontmatter(rawMarkdown);

          return new Response(JSON.stringify({
            success: true,
            relPath: relPath,
            sha: ghFile.sha,
            data: parsed.data,
            body: (parsed.content || '').trim(),
            wordCount: countWords(parsed.content)
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          const status = err.status === 404 ? 404 : 500;
          return new Response(JSON.stringify({
            success: false,
            error: 'Failed to retrieve article from repository: ' + err.message
          }), {
            status: status,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      if (method !== 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      try {
        const body = await request.json();
        const nowIso = new Date().toISOString();

        // 5B. POST /api/admin/articles/save — Update editable fields with concurrency check
        if (pathname === '/api/admin/articles/save') {
          const { relPath, sha, title, dek, category, author, image, imageCredit, sourceName, sourceUrl, seoTitle, why_it_matters, what_happens_next, body: newBody } = body;

          if (!validateArticleRelPath(relPath)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          if (!env.GITHUB_CONTENTS_TOKEN) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Server GitHub Contents integration is not configured. Please configure GITHUB_CONTENTS_TOKEN in Cloudflare Worker Secrets.'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // Validate article payload constraints
          const validation = validateArticlePayload(body);
          if (!validation.valid) {
            await recordAuditEvent(env, {
              actor: session.sub || 'admin',
              action: 'save',
              status: 'failed',
              relPath,
              validation,
              summary: `Validation rejected: ${validation.errors.join('; ')}`
            });
            return new Response(JSON.stringify({
              success: false,
              error: validation.errors[0] || 'Validation failed',
              errors: validation.errors
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // 1. Fetch current file from GitHub
          let ghFile;
          try {
            ghFile = await fetchFromGitHub(relPath, env.GITHUB_CONTENTS_TOKEN);
          } catch (fetchErr) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Failed to fetch article from repository: ' + fetchErr.message
            }), {
              status: fetchErr.status || 500,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const currentSha = ghFile.sha;

          // 2. Concurrency check: compare client expected SHA with current SHA
          if (sha && sha !== currentSha) {
            await recordAuditEvent(env, {
              actor: session.sub || 'admin',
              action: 'save',
              status: 'conflict',
              relPath,
              sha: currentSha,
              validation: { valid: false, errors: ['Concurrency conflict: Git SHA mismatch'] },
              summary: 'Save conflict: Article was modified in GitHub by another process'
            });
            return new Response(JSON.stringify({
              success: false,
              error: 'This article changed in GitHub since you opened it. Reload before saving.',
              conflict: true,
              currentSha: currentSha
            }), {
              status: 409,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // 3. Decode existing Markdown and parse frontmatter
          const rawMarkdown = decodeBase64ToUtf8(ghFile.content || '');
          const parsed = parseFrontmatter(rawMarkdown);

          // Compute structured diff before updating
          const diff = computeArticleDiff(parsed.data, parsed.content, body);

          // 4. Update ONLY permitted fields; PRESERVE all protected fields (slug, date, videos, video_id, trending, featured, layout, canonical)
          if (typeof title === 'string' && title.trim()) parsed.data.title = title.trim();
          if (typeof dek === 'string') parsed.data.dek = dek.trim();
          if (typeof category === 'string' && category.trim()) parsed.data.category = category.trim();
          if (typeof author === 'string' && author.trim()) parsed.data.author = author.trim();
          if (image !== undefined) parsed.data.image = image ? String(image).trim() : null;
          if (imageCredit !== undefined) parsed.data.imageCredit = imageCredit ? String(imageCredit).trim() : null;
          if (sourceName !== undefined) parsed.data.sourceName = sourceName ? String(sourceName).trim() : null;
          if (sourceUrl !== undefined) parsed.data.sourceUrl = sourceUrl ? String(sourceUrl).trim() : null;
          if (seoTitle !== undefined) parsed.data.seoTitle = seoTitle ? String(seoTitle).trim() : null;
          if (why_it_matters !== undefined) parsed.data.why_it_matters = why_it_matters ? String(why_it_matters).trim() : null;
          if (what_happens_next !== undefined) parsed.data.what_happens_next = what_happens_next ? String(what_happens_next).trim() : null;

          // Update body content if provided
          if (typeof newBody === 'string') {
            parsed.content = '\n' + newBody.trim() + '\n';
          }

          const newWordCount = countWords(parsed.content);
          const updatedMarkdown = stringifyFrontmatter(parsed.content, parsed.data);
          const base64Content = encodeUtf8ToBase64(updatedMarkdown);

          // 5. Commit to GitHub main branch via PUT
          const commitMessage = `admin: update article ${relPath}`;
          const putRes = await putToGitHub(relPath, base64Content, currentSha, commitMessage, env.GITHUB_CONTENTS_TOKEN);
          const newSha = putRes.content ? putRes.content.sha : currentSha;

          // Record successful audit event into durable KV
          await recordAuditEvent(env, {
            actor: session.sub || 'admin',
            action: 'save',
            status: 'success',
            relPath,
            sha: newSha,
            commitMessage,
            validation: { valid: true },
            diff,
            summary: diff.changedFields.length > 0
              ? `Saved changes to ${diff.changedFields.join(', ')}`
              : 'Saved article without field modifications'
          });

          return new Response(JSON.stringify({
            success: true,
            message: 'Saved successfully',
            sha: newSha,
            modified: nowIso,
            wordCount: newWordCount
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        // 5C. POST /api/admin/articles/archive — Soft-prune article (noindex: true) with concurrency check
        if (pathname === '/api/admin/articles/archive') {
          const { relPath, sha } = body;

          if (!validateArticleRelPath(relPath)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          if (!env.GITHUB_CONTENTS_TOKEN) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Server GitHub Contents integration is not configured. Please configure GITHUB_CONTENTS_TOKEN in Cloudflare Worker Secrets.'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const ghFile = await fetchFromGitHub(relPath, env.GITHUB_CONTENTS_TOKEN);
          const currentSha = ghFile.sha;

          if (sha && sha !== currentSha) {
            await recordAuditEvent(env, {
              actor: session.sub || 'admin',
              action: 'archive',
              status: 'conflict',
              relPath,
              sha: currentSha,
              validation: { valid: false, errors: ['Concurrency conflict: Git SHA mismatch'] },
              summary: 'Archive conflict: Article changed in GitHub'
            });
            return new Response(JSON.stringify({
              success: false,
              error: 'This article changed in GitHub since you opened it. Reload before saving.',
              conflict: true,
              currentSha: currentSha
            }), {
              status: 409,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const rawMarkdown = decodeBase64ToUtf8(ghFile.content || '');
          const parsed = parseFrontmatter(rawMarkdown);

          parsed.data.noindex = true;
          const updatedMarkdown = stringifyFrontmatter(parsed.content, parsed.data);
          const base64Content = encodeUtf8ToBase64(updatedMarkdown);

          const commitMessage = `admin: archive article (set noindex: true) ${relPath}`;
          const putRes = await putToGitHub(relPath, base64Content, currentSha, commitMessage, env.GITHUB_CONTENTS_TOKEN);
          const newSha = putRes.content ? putRes.content.sha : currentSha;

          // Record archive action to audit store
          await recordAuditEvent(env, {
            actor: session.sub || 'admin',
            action: 'archive',
            status: 'success',
            relPath,
            sha: newSha,
            commitMessage,
            validation: { valid: true },
            diff: {
              changedFields: ['noindex'],
              fieldChanges: { noindex: { old: false, new: true } }
            },
            summary: 'Article archived (marked noindex: true)'
          });

          return new Response(JSON.stringify({
            success: true,
            message: 'Article archived successfully (set to noindex)',
            noindex: true,
            sha: newSha,
            modified: nowIso
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        // 5D. POST /api/admin/articles/restore — Revert noindex to active indexation with concurrency check
        if (pathname === '/api/admin/articles/restore') {
          const { relPath, sha } = body;

          if (!validateArticleRelPath(relPath)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          if (!env.GITHUB_CONTENTS_TOKEN) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Server GitHub Contents integration is not configured. Please configure GITHUB_CONTENTS_TOKEN in Cloudflare Worker Secrets.'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const ghFile = await fetchFromGitHub(relPath, env.GITHUB_CONTENTS_TOKEN);
          const currentSha = ghFile.sha;

          if (sha && sha !== currentSha) {
            await recordAuditEvent(env, {
              actor: session.sub || 'admin',
              action: 'restore',
              status: 'conflict',
              relPath,
              sha: currentSha,
              validation: { valid: false, errors: ['Concurrency conflict: Git SHA mismatch'] },
              summary: 'Restore conflict: Article changed in GitHub'
            });
            return new Response(JSON.stringify({
              success: false,
              error: 'This article changed in GitHub since you opened it. Reload before saving.',
              conflict: true,
              currentSha: currentSha
            }), {
              status: 409,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const rawMarkdown = decodeBase64ToUtf8(ghFile.content || '');
          const parsed = parseFrontmatter(rawMarkdown);

          delete parsed.data.noindex;
          const updatedMarkdown = stringifyFrontmatter(parsed.content, parsed.data);
          const base64Content = encodeUtf8ToBase64(updatedMarkdown);

          const commitMessage = `admin: restore article (active/indexable) ${relPath}`;
          const putRes = await putToGitHub(relPath, base64Content, currentSha, commitMessage, env.GITHUB_CONTENTS_TOKEN);
          const newSha = putRes.content ? putRes.content.sha : currentSha;

          // Record restore action to audit store
          await recordAuditEvent(env, {
            actor: session.sub || 'admin',
            action: 'restore',
            status: 'success',
            relPath,
            sha: newSha,
            commitMessage,
            validation: { valid: true },
            diff: {
              changedFields: ['noindex'],
              fieldChanges: { noindex: { old: true, new: false } }
            },
            summary: 'Article restored to active search indexation'
          });

          return new Response(JSON.stringify({
            success: true,
            message: 'Article restored successfully (active/indexable)',
            noindex: false,
            sha: newSha,
            modified: nowIso
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        // 5E. POST /api/admin/articles/delete — Guarded permanent deletion from repository
        if (pathname === '/api/admin/articles/delete') {
          const { relPath, confirmTitle, sha } = body;

          if (!validateArticleRelPath(relPath)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const entered = (confirmTitle || '').trim().toLowerCase();
          if (entered !== 'delete') {
            return new Response(JSON.stringify({
              success: false,
              error: 'Confirmation phrase mismatch. Please enter "DELETE" to confirm.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          if (!env.GITHUB_CONTENTS_TOKEN) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Server GitHub Contents integration is not configured. Please configure GITHUB_CONTENTS_TOKEN in Cloudflare Worker Secrets.'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const ghFile = await fetchFromGitHub(relPath, env.GITHUB_CONTENTS_TOKEN);
          const currentSha = ghFile.sha;

          if (sha && sha !== currentSha) {
            return new Response(JSON.stringify({
              success: false,
              error: 'This article changed in GitHub since you opened it. Reload before saving.',
              conflict: true,
              currentSha: currentSha
            }), {
              status: 409,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const rawMarkdown = decodeBase64ToUtf8(ghFile.content || '');
          const parsed = parseFrontmatter(rawMarkdown);

          // Safety Guard 1: Protect against deleting redirect stubs
          if (parsed.data.redirect || parsed.data.redirect_to || parsed.data.layout === 'redirect' || parsed.data.layout === 'layouts/redirect.njk') {
            return new Response(JSON.stringify({
              success: false,
              error: 'Cannot delete redirect stub. Redirect stubs protect canonical backlinks and prevent crawl penalties.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // Safety Guard 2: Protect against deleting protected articles
          if (parsed.data.protected === true) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Cannot delete protected article.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const commitMessage = `admin: delete article ${relPath}`;
          await deleteFromGitHub(relPath, currentSha, commitMessage, env.GITHUB_CONTENTS_TOKEN);

          // Record delete action to audit store
          await recordAuditEvent(env, {
            actor: session.sub || 'admin',
            action: 'delete',
            status: 'success',
            relPath,
            sha: currentSha,
            commitMessage,
            validation: { valid: true },
            summary: 'Article permanently deleted from corpus'
          });

          return new Response(JSON.stringify({
            success: true,
            message: 'Article permanently deleted from corpus.',
            relPath: relPath
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: 'Malformed request: ' + err.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
    }

    // 5. PAGE ROUTE: Editorial Control Center (/admin/editorial or /admin/editorial/*)
    if (pathname === '/admin/editorial' || pathname.startsWith('/admin/editorial/')) {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (!session) {
        // Unauthenticated access blocked -> 302 redirect to /admin/
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/admin/',
            ...getSecurityHeaders()
          }
        });
      }

      // Authenticated administrator -> serve Editorial Control Center
      return new Response(editorialHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...getSecurityHeaders()
        }
      });
    }

    // 6. PAGE ROUTE: Newsroom Login Portal (/admin or /admin/)
    if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html') {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (session) {
        // Already authenticated -> 302 redirect straight to control center
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/admin/editorial/',
            ...getSecurityHeaders()
          }
        });
      }

      // Unauthenticated visitor -> serve Login Portal
      return new Response(loginHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...getSecurityHeaders()
        }
      });
    }

    // 7. Any other unmatched /admin/* route
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...getSecurityHeaders()
      }
    });
  }
};
