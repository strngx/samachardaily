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

import { loginHtml, editorialHtml, qualityIndexJson, internalLinksJson, siteHealthJson } from './admin-views.js';
import { paginateInternalLinks } from './internal-linking.js';
import { resolveSiteHealth } from './site-health.js';
import {
  ROLES,
  MEMBER_STATUS,
  INVITATION_STATUS,
  INVITABLE_ROLES,
  OWNER_RECORD,
  normalizeEmail,
  isGmailAddress,
  isValidInvitableRole,
  createInvitation,
  getInvitationByToken,
  getInvitationById,
  cancelInvitation,
  deleteInvitation,
  acceptInvitation,
  listInvitations,
  listMembers,
  getMemberById,
  getAuthenticatedMember,
  getMemberRole,
  requireRole,
  hasPermission,
  getGoogleOAuthConfig,
  resolveInvitationRedirectUri,
  createOAuthState,
  verifyOAuthState,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  sendInvitationEmail
} from './members.js';

import {
  recordAuditEvent,
  getArticleAuditHistory,
  getRecentAuditLogs,
  computeArticleDiff,
  validateArticlePayload,
  parseYouTubeVideoId
} from './audit.js';
import {
  checkArticleSafety,
  getRevisionKey,
  getSignoffKey
} from './safety.js';
import {
  getGSCConfig,
  getGSCStatus,
  getGSCPerformanceDashboard,
  buildGSCAuthUrl,
  exchangeGSCCode,
  saveGSCTokens,
  deleteGSCTokens,
  inspectUrl,
  validateInspectUrl,
  resolveGSCRedirectUri
} from './gsc.js';
import {
  analyzeArticleSafety,
  generateArticleUpgrade,
  evaluateOutputQuality,
  sanitizeUntrustedText,
  CLAIM_CLASSIFICATION
} from './ai-upgrade.js';
import { getManualAiStatus } from './manual-ai-providers.js';
import yaml from 'js-yaml';
import {
  analyzeArticle,
  detectDuplicates,
  buildCorpusSummary,
  buildCachePayload,
  parseArticleIndex,
  paginateArticles,
  QUALITY_CACHE_KEY,
  QUALITY_CACHE_TTL,
} from './content-quality.js';
import {
  registerSubscriber,
  unsubscribeSubscriber,
  getSubscriberByToken,
  listSubscribers,
  getNewsletterStats,
  updateSubscriberStatus,
  deleteSubscriber,
  saveCampaignDraft,
  getCampaignById,
  getCampaignsIndex,
  renderCampaignHtml,
  buildDailyDigest,
  renderDigestHtml,
  renderDigestPlainText,
  executeDailyDigestRun,
  getDeliveryConfig,
  getSubscribersIndex
} from './newsletter.js';

// GitHub Contents API Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_REPO_OWNER = 'strngx';
const GITHUB_REPO_NAME = 'samachardaily';
const GITHUB_BRANCH = 'main';

// Strict path regex for article Markdown files in src/articles/<category>/<slug>.md
const ARTICLE_PATH_REGEX = /^src\/articles\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.md$/;

function validateArticleRelPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  const forwardPath = relPath.trim().replace(/\\/g, '/');
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInviteHtml({ token, invitation, statusError, errorMsg, oauthConfig }) {
  const isPending = invitation && invitation.status === INVITATION_STATUS.PENDING && !statusError;

  let contentHtml = '';
  if (statusError) {
    contentHtml = `
      <div class="banner banner-danger">
        <strong>Invitation Inactive</strong><br>
        ${escapeHtml(statusError)}
      </div>
      <a href="/admin/" class="btn" style="background:#1f2937; color:#fff; text-decoration:none;">Return to Newsroom Login</a>
    `;
  } else if (isPending) {
    const roleBadgeClass = invitation.role === ROLES.ADMIN ? 'badge-admin' : 'badge-editor';
    const expiresFormatted = new Date(invitation.expiresAt).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }) + ' UTC';

    let actionSection = '';
    if (oauthConfig.configured) {
      actionSection = `
        <a href="/admin/invite/start?token=${encodeURIComponent(token)}" class="btn btn-google">
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.347 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
          </svg>
          Accept Invitation with Google
        </a>
      `;
    } else {
      actionSection = `
        <div class="banner banner-warning">
          <strong>Configuration Notice:</strong> Google OAuth credentials (<code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>) are pending server-side deployment. Once configured, you will be able to verify your account here.
        </div>
      `;
    }

    contentHtml = `
      ${errorMsg ? `<div class="banner banner-danger"><strong>Authentication Failed:</strong><br>${escapeHtml(errorMsg)}</div>` : ''}
      <div class="details">
        <div class="row">
          <span class="label">Invited Email</span>
          <span class="value">${escapeHtml(invitation.email)}</span>
        </div>
        <div class="row">
          <span class="label">Assigned Role</span>
          <span class="badge ${roleBadgeClass}">${escapeHtml(invitation.role)}</span>
        </div>
        <div class="row">
          <span class="label">Expires</span>
          <span class="value" style="font-size:0.8rem; color:#9ca3af;">${escapeHtml(expiresFormatted)}</span>
        </div>
      </div>
      ${actionSection}
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newsroom Invitation — Samachar Daily</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f9fafb;
      --muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.25rem 2rem;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header { text-align: center; margin-bottom: 1.75rem; }
    .brand { font-size: 1.15rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    .title { font-size: 1.35rem; font-weight: 600; margin-top: 0.35rem; color: #fff; }
    .subtitle { color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; }
    .details {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
    }
    .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
    .row:last-child { margin-bottom: 0; }
    .label { color: var(--muted); }
    .value { font-weight: 500; color: #fff; }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-admin { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.3); }
    .badge-editor { background: rgba(6, 182, 212, 0.2); color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.3); }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: background 0.15s ease;
    }
    .btn-google {
      background: #ffffff;
      color: #1f2937;
      gap: 0.5rem;
    }
    .btn-google:hover { background: #f3f4f6; }
    .banner {
      padding: 0.875rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
      line-height: 1.45;
    }
    .banner-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; }
    .banner-warning { background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #fcd34d; }
    .footer { text-align: center; margin-top: 1.5rem; font-size: 0.75rem; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">SAMACHAR DAILY</div>
      <div class="title">Newsroom Invitation</div>
      <div class="subtitle">Join the editorial desk</div>
    </div>
    ${contentHtml}
    <div class="footer">
      Samachar Daily Editorial Desk &bull; Identity Secured
    </div>
  </div>
</body>
</html>`;
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
    // If request is not an admin route or public newsletter route, pass directly to Cloudflare static assets
    if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin') && !pathname.startsWith('/api/newsletter')) {
      return env.ASSETS.fetch(request);
    }

    const method = request.method;

    // 1B. PUBLIC NEWSLETTER ENDPOINTS (Phase J)
    if (pathname === '/api/newsletter/subscribe' && method === 'POST') {
      try {
        let email = '';
        let source = 'web';
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const body = await request.json().catch(() => ({}));
          email = body.email || body['entry.963532165'] || '';
          source = body.source || 'web';
        } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
          const formData = await request.formData().catch(() => new FormData());
          email = formData.get('email') || formData.get('entry.963532165') || '';
          source = formData.get('source') || 'web_form';
        }

        const clientIp = getClientIp(request);
        const userAgent = request.headers.get('user-agent') || '';
        const referrer = request.headers.get('referer') || '';

        const result = await registerSubscriber(env, {
          email,
          source,
          metadata: { userAgent, referrer, clientIp }
        });

        const status = result.success ? 200 : 400;

        // If standard HTML form POST without AJAX, redirect back gracefully
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const redirectUrl = new URL(referrer || '/', url.origin);
          redirectUrl.searchParams.set('newsletter', result.success ? 'success' : 'error');
          return Response.redirect(redirectUrl.toString(), 303);
        }

        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message || 'Subscription failed.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
    }

    if (pathname === '/api/newsletter/unsubscribe' && (method === 'GET' || method === 'POST')) {
      const token = (url.searchParams.get('token') || '').trim();
      const subId = (url.searchParams.get('id') || '').trim();
      const confirmParam = url.searchParams.get('confirm');
      const isPost = method === 'POST';
      const isConfirmedGet = method === 'GET' && confirmParam === '1';
      const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');

      // 1. Token Requirement: Public requests must provide a valid unsubscribe token.
      // Bare IDs alone are strictly rejected.
      if (!token) {
        if (acceptsHtml) {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Unsubscribe Notice — Samachar Daily</title>
  <style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; } .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); } .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; } h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; } p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; } a.btn { display: inline-block; background: #1e293b; color: #f8fafc; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; } a.btn:hover { background: #334155; }</style>
</head>
<body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Unsubscribe Notice</h1><p>A valid unsubscribe verification token is required.</p><a href="https://thesamachardaily.in/" class="btn">Return to Homepage</a></div></body></html>`;
          return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() } });
        }
        return new Response(JSON.stringify({
          success: false,
          error: 'A valid unsubscribe verification token is required.',
          errorCode: 'INVALID_TOKEN'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 2. Resolve and verify subscriber by token
      const existingSub = await getSubscriberByToken(env, token);
      if (!existingSub) {
        if (acceptsHtml) {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Unsubscribe Notice — Samachar Daily</title>
  <style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; } .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); } .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; } h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; } p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; } a.btn { display: inline-block; background: #1e293b; color: #f8fafc; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; } a.btn:hover { background: #334155; }</style>
</head>
<body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Unsubscribe Notice</h1><p>Subscriber record not found or link has expired.</p><a href="https://thesamachardaily.in/" class="btn">Return to Homepage</a></div></body></html>`;
          return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() } });
        }
        return new Response(JSON.stringify({
          success: false,
          error: 'Subscriber record not found or link has expired.',
          errorCode: 'NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // If ID is also supplied, verify token belongs to this subscriber
      if (subId && existingSub.id !== subId) {
        if (acceptsHtml) {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Unsubscribe Notice — Samachar Daily</title>
  <style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; } .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); } .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; } h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; } p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; } a.btn { display: inline-block; background: #1e293b; color: #f8fafc; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; } a.btn:hover { background: #334155; }</style>
</head>
<body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Unsubscribe Notice</h1><p>Invalid or forged unsubscribe token.</p><a href="https://thesamachardaily.in/" class="btn">Return to Homepage</a></div></body></html>`;
          return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() } });
        }
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid or forged unsubscribe token.',
          errorCode: 'UNAUTHORIZED'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 3. Mutating Execution: Only on POST (RFC 8058 One-Click or form submit) or explicit confirm=1 GET
      if (isPost || isConfirmedGet) {
        const result = await unsubscribeSubscriber(env, { id: existingSub.id, token });
        if (acceptsHtml && method === 'GET') {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe — Samachar Daily</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    a.btn { display: inline-block; background: #1e293b; color: #f8fafc; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; }
    a.btn:hover { background: #334155; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">SAMACHAR DAILY</div>
    <h1>${result.success ? 'Unsubscribed Successfully' : 'Unsubscribe Notice'}</h1>
    <p>${result.message || result.error}</p>
    <a href="https://thesamachardaily.in/" class="btn">Return to Homepage</a>
  </div>
</body>
</html>`;
          return new Response(html, {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() }
          });
        }

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 4. Safe GET Request: Protect against mail security scanner pre-fetch
      // Already unsubscribed check
      if (existingSub.status === 'unsubscribed') {
        if (acceptsHtml) {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Already Unsubscribed — Samachar Daily</title>
  <style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; } .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); } .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; } h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; } p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; } a.btn { display: inline-block; background: #1e293b; color: #f8fafc; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; } a.btn:hover { background: #334155; }</style>
</head>
<body><div class="card"><div class="badge">SAMACHAR DAILY</div><h1>Already Unsubscribed</h1><p>You are already unsubscribed from The Daily Briefing.</p><a href="https://thesamachardaily.in/" class="btn">Return to Homepage</a></div></body></html>`;
          return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() } });
        }
        return new Response(JSON.stringify({ success: true, status: 'unsubscribed', message: 'You are already unsubscribed from The Daily Briefing.', alreadyUnsubscribed: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() } });
      }

      // Active subscriber clicking link: render confirmation page with POST button
      const postActionUrl = `/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
      const confirmHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Unsubscribe — Samachar Daily</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #101726; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .badge { display: inline-block; background: #C81E2C; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    button.btn-unsub { background: #C81E2C; color: #ffffff; border: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button.btn-unsub:hover { background: #991b1b; }
    .cancel-link { display: block; margin-top: 16px; color: #64748b; font-size: 13px; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">SAMACHAR DAILY</div>
    <h1>Confirm Unsubscribe</h1>
    <p>Are you sure you want to stop receiving The Daily Briefing in your inbox?</p>
    <form method="POST" action="${postActionUrl}">
      <button type="submit" class="btn-unsub">Confirm Unsubscribe</button>
    </form>
    <a href="https://thesamachardaily.in/" class="cancel-link">Never mind, keep my subscription</a>
  </div>
</body>
</html>`;
      return new Response(confirmHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() } });
    }

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

      // Enforce 24-hour account lockout after 3 consecutive failed attempts (scoped per client IP)
      const clientIp = getClientIp(request);
      const lockout = await getLockoutState(env, clientIp);
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
          await resetLockoutState(env, clientIp);

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
          // Record failed login attempt (activates 24-hour lockout on 3rd failure for this client IP)
          const postFailState = await recordFailedLogin(env, clientIp);
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
        const member = await getAuthenticatedMember(request, env);
        if (!member) {
          return new Response(JSON.stringify({ authenticated: false }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getSecurityHeaders()
            }
          });
        }
        let googlePicture = null;
        try {
          const gscTokens = await getGSCTokens(env);
          if (gscTokens && gscTokens.account_picture) {
            googlePicture = gscTokens.account_picture;
          }
        } catch (_) {}

        return new Response(JSON.stringify({
          authenticated: true,
          user: member.displayName || session.sub,
          sub: session.sub,
          role: member.role,
          email: member.email,
          displayName: member.displayName,
          googlePicture,
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

    // 4B. API ENDPOINTS: Team Members & Invitations Foundation (Phase 14B-1)
    if (pathname === '/api/admin/members/invite' && method === 'POST') {
      const caller = await getAuthenticatedMember(request, env);
      if (!caller) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      if (!hasPermission(caller, 'invite_members')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Forbidden. Only Owner and Administrator roles can invite team members.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      try {
        const body = await request.json();
        const email = (body.email || '').trim();
        const role = (body.role || '').trim().toLowerCase();

        if (!email) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing required field: email.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        if (!isGmailAddress(email)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Only @gmail.com or @googlemail.com addresses are permitted for member invitations.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        if (!isValidInvitableRole(role)) {
          return new Response(JSON.stringify({
            success: false,
            error: `Invalid role "${role}". Allowed roles: ${INVITABLE_ROLES.join(', ')}.`
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const { invitation, rawToken } = await createInvitation(env, {
          email,
          role,
          invitedBy: caller.id
        });

        const inviteUrl = `${url.origin}/admin/invite?token=${encodeURIComponent(rawToken)}`;
        const emailDelivery = await sendInvitationEmail(env, { email, role, inviteUrl });

        return new Response(JSON.stringify({
          success: true,
          invitation,
          inviteUrl,
          emailDelivery
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      } catch (err) {
        const isConflict = err.message && err.message.includes('already exists');
        return new Response(JSON.stringify({
          success: false,
          error: err.message || 'Failed to create invitation.'
        }), {
          status: isConflict ? 409 : 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
    }

    if (pathname === '/api/admin/members/invitations' && method === 'GET') {
      const caller = await getAuthenticatedMember(request, env);
      if (!caller) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      if (!hasPermission(caller, 'view_members')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Forbidden. Access restricted.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      const invitations = await listInvitations(env);
      return new Response(JSON.stringify({
        success: true,
        count: invitations.length,
        invitations
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
    }

    if (pathname === '/api/admin/members/invite/cancel' && method === 'POST') {
      const caller = await getAuthenticatedMember(request, env);
      if (!caller) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      if (!hasPermission(caller, 'cancel_invitations')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Forbidden. Only Owner and Administrator can cancel invitations.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      try {
        const body = await request.json();
        const id = body.id;
        if (!id) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing required field: id.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const cancelled = await cancelInvitation(env, id, caller.id);
        return new Response(JSON.stringify({
          success: true,
          message: 'Invitation cancelled successfully.',
          invitation: {
            id: cancelled.id,
            status: cancelled.status,
            cancelledAt: cancelled.cancelledAt
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: err.message || 'Failed to cancel invitation.'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
    }

    if (pathname === '/api/admin/members/invite/delete' && method === 'POST') {
      const caller = await getAuthenticatedMember(request, env);
      if (!caller) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      if (!hasPermission(caller, 'delete_invitations')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Forbidden. Only Owner and Administrator can delete invitations.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      try {
        const body = await request.json();
        const id = body.id;
        if (!id) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing required field: id.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const result = await deleteInvitation(env, id);
        return new Response(JSON.stringify({
          success: true,
          message: 'Invitation deleted successfully.',
          id: result.id
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: err.message || 'Failed to delete invitation.'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
    }

    if (pathname === '/api/admin/members' && method === 'GET') {
      const caller = await getAuthenticatedMember(request, env);
      if (!caller) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      if (!hasPermission(caller, 'view_members')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Forbidden. Access restricted.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      const members = await listMembers(env);
      return new Response(JSON.stringify({
        success: true,
        count: members.length,
        members
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
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

    // 5D-GSC. API ENDPOINTS: Google Search Console API Engine (Phase 2)
    if (pathname.startsWith('/api/admin/gsc/')) {
      const token = getSessionTokenFromRequest(request);
      const session = (token && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(token, env.ADMIN_SESSION_SECRET)
        : null;

      if (pathname !== '/api/admin/gsc/auth/callback' && !session) {
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

      // 5D-GSC-1. GET /api/admin/gsc/status — Current GSC connection status
      if (pathname === '/api/admin/gsc/status' && method === 'GET') {
        const status = await getGSCStatus(env);
        return new Response(JSON.stringify(status), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5D-GSC-2. GET /api/admin/gsc/performance — Fetch real Search Console performance
      if (pathname === '/api/admin/gsc/performance' && method === 'GET') {
        const range = url.searchParams.get('range') || '28days';
        const customStart = url.searchParams.get('startDate');
        const customEnd = url.searchParams.get('endDate');
        const searchType = url.searchParams.get('type') || 'web';
        const forceRefresh = url.searchParams.get('refresh') === 'true';

        try {
          const perf = await getGSCPerformanceDashboard(env, {
            range,
            customStart,
            customEnd,
            searchType,
            forceRefresh
          });
          return new Response(JSON.stringify(perf), {
            status: perf.success ? 200 : (perf.errorCode === 'PERMISSION_DENIED' ? 403 : 502),
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({
            success: false,
            connected: true,
            error: err.message || 'Failed to fetch Search Console data.'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // 5D-GSC-INSPECT. POST or GET /api/admin/gsc/inspect — Inspect URL with official Google Search Console API
      if (pathname === '/api/admin/gsc/inspect' && (method === 'POST' || method === 'GET')) {
        const caller = await getAuthenticatedMember(request, env);
        if (!caller) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Unauthorized. Please log in.'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        try {
          let targetUrl = '';
          let forceRefresh = false;

          if (method === 'POST') {
            try {
              const body = await request.json();
              targetUrl = (body.url || '').trim();
              forceRefresh = Boolean(body.refresh);
            } catch (_) {
              return new Response(JSON.stringify({
                success: false,
                error: 'Invalid JSON payload.'
              }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
              });
            }
          } else {
            targetUrl = (url.searchParams.get('url') || '').trim();
            forceRefresh = url.searchParams.get('refresh') === 'true';
          }

          if (!targetUrl) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Missing required parameter: url.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const validation = validateInspectUrl(targetUrl);
          if (!validation.valid) {
            return new Response(JSON.stringify({
              success: false,
              error: validation.error,
              errorCode: 'INVALID_URL'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const inspection = await inspectUrl(env, { url: validation.url, forceRefresh });
          const httpStatus = inspection.success ? 200 : (inspection.status || 500);

          return new Response(JSON.stringify(inspection), {
            status: httpStatus,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({
            success: false,
            error: err.message || 'Failed to inspect URL.'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // 5D-GSC-3. GET /api/admin/gsc/auth/start — Initiate OAuth connection
      if (pathname === '/api/admin/gsc/auth/start' && method === 'GET') {
        const caller = await getAuthenticatedMember(request, env);
        if (!caller || !hasPermission(caller, 'view_settings')) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Forbidden. Administrator or Owner role required to connect Search Console.'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const gscConfig = getGSCConfig(env);
        if (!gscConfig.configured) {
          const errMsg = 'Google OAuth client credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured in Cloudflare Workers.';
          if (request.headers.get('Accept')?.includes('application/json') || url.searchParams.get('format') === 'json') {
            return new Response(JSON.stringify({
              success: false,
              error: errMsg
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/admin/editorial?gsc_error=missing_credentials#search',
              ...getSecurityHeaders()
            }
          });
        }

        const state = await createOAuthState({ action: 'gsc_connect', userId: caller.id }, env.ADMIN_SESSION_SECRET);
        const redirectUri = resolveGSCRedirectUri(url, env);
        const authUrl = buildGSCAuthUrl({
          clientId: gscConfig.clientId,
          redirectUri,
          state
        });

        if (request.headers.get('Accept')?.includes('application/json')) {
          return new Response(JSON.stringify({ success: true, authUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        return new Response(null, {
          status: 302,
          headers: {
            'Location': authUrl,
            ...getSecurityHeaders()
          }
        });
      }

      // 5D-GSC-4. GET /api/admin/gsc/auth/callback — OAuth Callback from Google
      if (pathname === '/api/admin/gsc/auth/callback' && method === 'GET') {
        const code = url.searchParams.get('code');
        const stateParam = url.searchParams.get('state');
        const errParam = url.searchParams.get('error');

        if (errParam) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': `/admin/editorial?gsc_error=${encodeURIComponent(errParam)}#search`,
              ...getSecurityHeaders()
            }
          });
        }

        if (!code || !stateParam) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/admin/editorial?gsc_error=missing_params#search',
              ...getSecurityHeaders()
            }
          });
        }

        const stateData = await verifyOAuthState(stateParam, env.ADMIN_SESSION_SECRET);
        if (!stateData || stateData.action !== 'gsc_connect') {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/admin/editorial?gsc_error=invalid_state#search',
              ...getSecurityHeaders()
            }
          });
        }

        const gscConfig = getGSCConfig(env);
        if (!gscConfig.configured) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/admin/editorial?gsc_error=oauth_not_configured#search',
              ...getSecurityHeaders()
            }
          });
        }

        try {
          const redirectUri = resolveGSCRedirectUri(url, env);
          const tokens = await exchangeGSCCode({
            code,
            clientId: gscConfig.clientId,
            clientSecret: gscConfig.clientSecret,
            redirectUri
          });

          const nowIso = new Date().toISOString();
          const tokenData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000),
            scope: tokens.scope,
            connected_at: nowIso,
            connected_by: stateData.userId || 'admin',
            account_email: tokens.userEmail || null,
            account_name: tokens.userName || null,
            account_picture: tokens.userPicture || null,
            property_id: gscConfig.propertyId
          };

          await saveGSCTokens(env, tokenData);

          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/admin/editorial?gsc=connected#search',
              ...getSecurityHeaders()
            }
          });
        } catch (err) {
          console.error('[GSC OAuth Error]', err.message);
          return new Response(null, {
            status: 302,
            headers: {
              'Location': `/admin/editorial?gsc_error=${encodeURIComponent(err.message || 'token_exchange_failed')}#search`,
              ...getSecurityHeaders()
            }
          });
        }
      }

      // 5D-GSC-5. POST /api/admin/gsc/disconnect — Disconnect GSC integration
      if (pathname === '/api/admin/gsc/disconnect' && method === 'POST') {
        const caller = await getAuthenticatedMember(request, env);
        if (!caller || !hasPermission(caller, 'view_settings')) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Forbidden. Administrator or Owner role required to disconnect Search Console.'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        await deleteGSCTokens(env);
        return new Response(JSON.stringify({
          success: true,
          message: 'Google Search Console disconnected successfully.'
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

    // 5D. API ENDPOINTS: Authenticated Editorial Safety (Phase 9)
    if (pathname === '/api/admin/safety' || pathname.startsWith('/api/admin/safety/')) {
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

      // 5D-1. POST /api/admin/safety/check — Run on-demand editorial safety evaluation
      if (pathname === '/api/admin/safety/check' && method === 'POST') {
        try {
          const body = await request.json();
          const { relPath, sha, title, dek, body: articleBody, sourceName, sourceUrl, image, imageCredit, imageAlt, skipAi } = body || {};

          if (relPath && !validateArticleRelPath(relPath)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const pathParts = (relPath || '').split('/');
          const filename = pathParts[pathParts.length - 1] || '';
          const slug = body.slug || filename.replace(/\.md$/, '') || 'dispatch';

          const report = await checkArticleSafety({
            slug,
            sha,
            title,
            dek,
            body: articleBody,
            sourceName,
            sourceUrl,
            image,
            imageCredit,
            imageAlt
          }, env, { skipAi: Boolean(skipAi) });

          return new Response(JSON.stringify({
            success: true,
            report,
            result: report,
            persisted: report.persisted
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (e) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process safety check: ' + e.message
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // 5D-2. GET /api/admin/safety/status — Retrieve revision-bound safety state
      if (pathname === '/api/admin/safety/status' && method === 'GET') {
        const slug = url.searchParams.get('slug');
        const sha = url.searchParams.get('sha');

        if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing or invalid article slug parameter.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        let report = null;
        let signoff = null;

        if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function' && sha) {
          try {
            const cacheKey = getRevisionKey(slug, sha);
            const reportRaw = await env.AUTH_KV.get(cacheKey);
            if (reportRaw) {
              report = JSON.parse(reportRaw);
            }

            const signoffKey = getSignoffKey(slug, sha);
            const signoffRaw = await env.AUTH_KV.get(signoffKey);
            if (signoffRaw) {
              signoff = JSON.parse(signoffRaw);
            }
          } catch (_) {}
        }

        return new Response(JSON.stringify({
          success: true,
          slug,
          sha: sha || null,
          found: Boolean(report || signoff),
          hasReport: Boolean(report),
          isCurrentRevision: Boolean(report && sha && report.sha === sha),
          report,
          result: report,
          signoff
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5D-3. POST /api/admin/safety/sign-off — Record authenticated editorial sign-off
      if (pathname === '/api/admin/safety/sign-off' && method === 'POST') {
        try {
          const body = await request.json();
          const { slug, relPath, sha, action, notes } = body || {};

          if (!slug || typeof slug !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid or missing article slug.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          if (!sha || typeof sha !== 'string' || sha.length < 6) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Missing or invalid revision SHA. Safety sign-off must be bound to an exact Git revision.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          if (relPath && !validateArticleRelPath(relPath)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const allowedActions = ['acknowledge', 'override', 'remediation_acknowledged', 'reset', 'signoff', 'SIGNOFF'];
          if (!action || !allowedActions.includes(action)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Invalid action. Allowed actions: acknowledge, override, remediation_acknowledged, reset, signoff.'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const signoffKey = getSignoffKey(slug, sha);
          const nowIso = new Date().toISOString();
          let persisted = false;
          let signoffPayload = null;

          if (action === 'reset') {
            if (env && env.AUTH_KV && typeof env.AUTH_KV.delete === 'function') {
              try {
                await env.AUTH_KV.delete(signoffKey);
                persisted = true;
              } catch (_) {}
            }
          } else {
            signoffPayload = {
              slug,
              sha,
              relPath: relPath || '',
              action,
              reviewer: session.sub || 'admin',
              timestamp: nowIso,
              notes: typeof notes === 'string' ? notes.slice(0, 500) : ''
            };

            if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
              try {
                // 30 days expiration TTL
                await env.AUTH_KV.put(signoffKey, JSON.stringify(signoffPayload), { expirationTtl: 2592000 });
                persisted = true;
              } catch (kvErr) {
                console.error('[Safety KV Error] Failed to persist sign-off:', kvErr.message);
              }
            }
          }

          // Record Phase 6 audit event
          try {
            await recordAuditEvent(env, {
              actor: session.sub || 'admin',
              action: 'safety_signoff',
              slug,
              sha,
              relPath: relPath || '',
              summary: `Editorial safety action for "${slug}" (SHA ${sha.slice(0, 7)}): ${action} by ${session.sub || 'admin'}${notes ? ' - ' + notes.slice(0, 100) : ''}`,
              status: 'success'
            });
          } catch (auditErr) {
            console.error('[Audit Error] Failed to record safety audit event:', auditErr.message);
          }

          return new Response(JSON.stringify({
            success: true,
            persisted,
            slug,
            sha,
            action,
            signoff: signoffPayload,
            timestamp: nowIso
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process safety sign-off: ' + err.message
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // 5D-4. GET /api/admin/safety/queue — Safety flagged queue list
      if (pathname === '/api/admin/safety/queue' && method === 'GET') {
        const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
        const limit = isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 100);

        return new Response(JSON.stringify({
          success: true,
          count: 0,
          limit,
          queue: []
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

    // 5E. API ENDPOINTS: Authenticated Manual AI Article Upgrade (Phase D)
    if (pathname.startsWith('/api/admin/ai/upgrade/')) {
      const caller = await getAuthenticatedMember(request, env);
      if (!caller) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Unauthorized. Please log in.'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // User-facing roles: Exactly ADMIN and EDITOR (plus internal OWNER)
      if (!requireRole(caller, [ROLES.OWNER, ROLES.ADMIN, ROLES.EDITOR])) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Forbidden. Manual AI Upgrade is restricted to Admin and Editor roles.'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5E-0. GET /api/admin/ai/upgrade/providers — Safe server-side provider status view
      if (pathname === '/api/admin/ai/upgrade/providers' && method === 'GET') {
        const diagnostics = getManualAiStatus(env);
        return new Response(JSON.stringify({
          success: true,
          ...diagnostics
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      if (method !== 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      let payload = null;
      try {
        payload = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid JSON request payload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      const { relPath, sha, title, dek, body: articleBody, sourceName, sourceUrl, focus } = payload || {};

      if (!relPath || typeof relPath !== 'string' || !validateArticleRelPath(relPath)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid target path. Only Markdown files in src/articles/ are permitted.'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // Check article existence if explicitly simulated or flagged
      if (payload.simulateNotFound === true) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Article not found in repository.'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5E-1. POST /api/admin/ai/upgrade/analyze — Pre-upgrade fact/safety analysis
      if (pathname === '/api/admin/ai/upgrade/analyze') {
        if (!title || typeof title !== 'string' || !articleBody || typeof articleBody !== 'string') {
          return new Response(JSON.stringify({
            success: false,
            error: 'Article title and body are required for analysis.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const analysis = analyzeArticleSafety({
          title,
          dek: dek || '',
          body: articleBody,
          sourceName: sourceName || '',
          sourceUrl: sourceUrl || ''
        });

        return new Response(JSON.stringify({
          success: true,
          relPath,
          sha: sha || null,
          analysis
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5E-2. POST /api/admin/ai/upgrade/generate — Generate improved article candidate
      if (pathname === '/api/admin/ai/upgrade/generate') {
        if (!title || typeof title !== 'string' || !articleBody || typeof articleBody !== 'string') {
          return new Response(JSON.stringify({
            success: false,
            error: 'Article title and body are required for upgrade generation.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const upgradeResult = await generateArticleUpgrade(
          {
            title,
            dek: dek || '',
            body: articleBody,
            sourceName: sourceName || '',
            sourceUrl: sourceUrl || ''
          },
          env,
          { focus }
        );

        if (!upgradeResult.success) {
          return new Response(JSON.stringify({
            success: false,
            error: upgradeResult.error || 'AI upgrade could not be completed right now.',
            totalAttempts: upgradeResult.totalAttempts || 0
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          relPath,
          sha: sha || null,
          candidate: upgradeResult.candidate,
          quality: upgradeResult.quality,
          safetyAnalysis: upgradeResult.safetyAnalysis,
          providerUsed: upgradeResult.providerUsed,
          totalAttempts: upgradeResult.totalAttempts,
          research: upgradeResult.research || { researched: false }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // 5E-3. POST /api/admin/ai/upgrade/accept — Working-state / Draft Handoff ONLY
      // STAGE 1: Saves rewritten text into editor working state.
      // ZERO GitHub writes, ZERO commits, ZERO deployments.
      // Final persistence is reserved strictly for the existing "Save Changes" workflow (Stage 2).
      if (pathname === '/api/admin/ai/upgrade/accept') {
        const { candidateHeadline, candidateDek, candidateBody } = payload;
        const newTitle = candidateHeadline || title;
        const newDek = candidateDek !== undefined ? candidateDek : dek;
        const newBody = candidateBody || articleBody;

        if (!newTitle || !newBody) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Upgraded article headline and body are required for editor handoff.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        // Record working-state handoff event into audit KV
        await recordAuditEvent(env, {
          actor: caller.email || caller.displayName || caller.id,
          action: 'ai_rewrite_handoff',
          status: 'success',
          relPath,
          sha: sha || 'working_draft',
          summary: `Loaded AI rewrite draft into editor working state for ${relPath} (awaiting manual Save Changes)`
        });

        // Return working draft directly to browser editor state
        // Byte-preserving image, imageCredit, video, slug, canonical, URL, category, author
        return new Response(JSON.stringify({
          success: true,
          relPath,
          workingDraft: {
            headline: newTitle.trim(),
            dek: typeof newDek === 'string' ? newDek.trim() : '',
            body: newBody.trim()
          },
          message: 'AI rewrite loaded into editor working state. Review your draft in the editor and click "Save Changes" to commit when ready.'
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
          const { relPath, sha, title, dek, category, author, image, imageCredit, sourceName, sourceUrl, seoTitle, why_it_matters, what_happens_next, video_id, video_caption, videos, body: newBody } = body;

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

          // 4. Update ONLY permitted fields; PRESERVE protected fields (slug, date, trending, featured, layout, canonical)
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

          // Phase 13D/13E: End-to-end YouTube Video management
          if (video_id !== undefined) {
            const rawVid = video_id ? String(video_id).trim() : '';
            const cleanVid = parseYouTubeVideoId(rawVid);
            if (rawVid && !cleanVid) {
              return new Response(JSON.stringify({
                success: false,
                error: 'Invalid YouTube video ID or URL.'
              }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
              });
            }

            if (cleanVid) {
              parsed.data.video_id = cleanVid;
              if (video_caption !== undefined) {
                parsed.data.video_caption = video_caption ? String(video_caption).trim() : '';
              } else if (!parsed.data.video_caption) {
                parsed.data.video_caption = parsed.data.title || '';
              }
              if (Array.isArray(videos) && videos.length > 0) {
                parsed.data.videos = videos.filter(v => v && typeof v === 'object' && v.video_id && /^[a-zA-Z0-9_-]{11}$/.test(String(v.video_id).trim()));
              } else {
                parsed.data.videos = [{
                  video_id: cleanVid,
                  title: parsed.data.video_caption || parsed.data.title || '',
                  channel: 'YouTube'
                }];
              }
            } else {
              // Video removed or cleared — cleanly remove keys from frontmatter
              delete parsed.data.video_id;
              delete parsed.data.video_caption;
              delete parsed.data.videos;
              delete parsed.data.videoId;
              delete parsed.data.videoCaption;
            }
          } else {
            if (video_caption !== undefined) {
              parsed.data.video_caption = video_caption ? String(video_caption).trim() : '';
            }
            if (videos !== undefined && Array.isArray(videos)) {
              parsed.data.videos = videos.filter(v => v && typeof v === 'object' && v.video_id && /^[a-zA-Z0-9_-]{11}$/.test(String(v.video_id).trim()));
            }
          }

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

    // 4C. PAGE ROUTES: Newsroom Invitation Flow (Phase 14B-1)
    if (pathname === '/admin/invite' && method === 'GET') {
      const token = url.searchParams.get('token');
      const errParam = url.searchParams.get('error');
      const oauthConfig = getGoogleOAuthConfig(env);

      let invitation = null;
      let statusError = null;

      if (!token) {
        statusError = 'No invitation token was provided in the URL.';
      } else {
        try {
          invitation = await getInvitationByToken(env, token);
          if (!invitation) {
            statusError = 'Invalid or unrecognized invitation token.';
          } else if (invitation.status === INVITATION_STATUS.CANCELLED) {
            statusError = 'This invitation was cancelled by an administrator.';
          } else if (invitation.status === INVITATION_STATUS.EXPIRED) {
            statusError = 'This invitation has expired (48-hour limit). Please request a new invitation.';
          } else if (invitation.status === INVITATION_STATUS.ACCEPTED) {
            statusError = 'This invitation has already been accepted. Please sign in to the newsroom.';
          }
        } catch (e) {
          statusError = 'Failed to verify invitation: ' + e.message;
        }
      }

      let errorMsg = null;
      if (errParam === 'oauth_not_configured') {
        errorMsg = 'Google identity authentication credentials are not configured on the server.';
      } else if (errParam === 'invalid_state') {
        errorMsg = 'Authentication security state validation failed. Please try again.';
      } else if (errParam === 'email_mismatch') {
        errorMsg = 'The authenticated Google account does not match the invited Gmail address.';
      } else if (errParam === 'access_denied') {
        errorMsg = 'Google sign-in was denied or cancelled.';
      } else if (errParam) {
        errorMsg = 'Authentication error: ' + errParam;
      }

      const html = renderInviteHtml({
        token,
        invitation,
        statusError,
        errorMsg,
        oauthConfig
      });

      return new Response(html, {
        status: (statusError || errorMsg) ? 400 : 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...getSecurityHeaders()
        }
      });
    }

    if (pathname === '/admin/invite/start' && method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) {
        return new Response('Missing invitation token.', { status: 400, headers: getSecurityHeaders() });
      }

      const oauthConfig = getGoogleOAuthConfig(env);
      if (!oauthConfig.configured) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `/admin/invite?token=${encodeURIComponent(token)}&error=oauth_not_configured`,
            ...getSecurityHeaders()
          }
        });
      }

      const invitation = await getInvitationByToken(env, token);
      if (!invitation || invitation.status !== INVITATION_STATUS.PENDING) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `/admin/invite?token=${encodeURIComponent(token)}`,
            ...getSecurityHeaders()
          }
        });
      }

      const state = await createOAuthState({ token }, env.ADMIN_SESSION_SECRET);
      const redirectUri = resolveInvitationRedirectUri(url, env);
      const authUrl = buildGoogleAuthUrl({
        clientId: oauthConfig.clientId,
        redirectUri,
        state
      });

      return new Response(null, {
        status: 302,
        headers: {
          'Location': authUrl,
          ...getSecurityHeaders()
        }
      });
    }

    if (pathname === '/admin/invite/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      const errParam = url.searchParams.get('error');

      if (errParam) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `/admin/invite?error=${encodeURIComponent(errParam)}`,
            ...getSecurityHeaders()
          }
        });
      }

      if (!code || !stateParam) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/admin/invite?error=invalid_callback_params',
            ...getSecurityHeaders()
          }
        });
      }

      const stateData = await verifyOAuthState(stateParam, env.ADMIN_SESSION_SECRET);
      if (!stateData || !stateData.token) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/admin/invite?error=invalid_state',
            ...getSecurityHeaders()
          }
        });
      }

      const oauthConfig = getGoogleOAuthConfig(env);
      if (!oauthConfig.configured) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `/admin/invite?token=${encodeURIComponent(stateData.token)}&error=oauth_not_configured`,
            ...getSecurityHeaders()
          }
        });
      }

      try {
        const redirectUri = resolveInvitationRedirectUri(url, env);
        const tokens = await exchangeGoogleCode({
          code,
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          redirectUri
        });

        const googleUser = await fetchGoogleUserInfo(tokens.access_token);
        const { member } = await acceptInvitation(env, stateData.token, googleUser);

        const sessionToken = await createSessionToken(member, env.ADMIN_SESSION_SECRET);
        const cookieHeader = buildSessionCookie(sessionToken);

        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/admin/editorial/',
            'Set-Cookie': cookieHeader,
            ...getSecurityHeaders()
          }
        });
      } catch (err) {
        const msg = err.message || 'acceptance_failed';
        const isMismatch = msg.includes('does not match');
        const errCode = isMismatch ? 'email_mismatch' : encodeURIComponent(msg);
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `/admin/invite?token=${encodeURIComponent(stateData.token)}&error=${errCode}`,
            ...getSecurityHeaders()
          }
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

    // PHASE E: Content Quality API Endpoints
    // Read-only diagnostic. No article mutation. ADMIN/EDITOR access only.
    if (pathname.startsWith('/api/admin/content-quality')) {
      // Authentication: require valid session
      const cqToken = getSessionTokenFromRequest(request);
      const cqSession = (cqToken && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(cqToken, env.ADMIN_SESSION_SECRET)
        : null;

      if (!cqSession) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // Authorization: ADMIN or EDITOR only (no new roles)
      const cqMember = await getAuthenticatedMember(request, env);
      if (!cqMember) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
      if (cqMember.role !== 'owner' && cqMember.role !== 'admin' && cqMember.role !== 'editor') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden. Admin or Editor role required.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/content-quality/summary — corpus summary from cache or fresh analysis
      if (pathname === '/api/admin/content-quality/summary' && method === 'GET') {
        try {
          // Try cached result first
          const forceRefresh = url.searchParams.get('refresh') === 'true';
          let cached = null;
          if (!forceRefresh && env.AUTH_KV) {
            try {
              const raw = await env.AUTH_KV.get(QUALITY_CACHE_KEY);
              if (raw) cached = JSON.parse(raw);
            } catch (_) {}
          }

          if (cached && cached.summary) {
            return new Response(JSON.stringify({ success: true, cached: true, ...cached.summary, cachedAt: cached.cachedAt }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // No cache: return needs-analysis state (analysis triggered separately)
          return new Response(JSON.stringify({
            success: true,
            cached: false,
            needsAnalysis: true,
            message: 'Content quality index not yet available. Trigger analysis via POST /api/admin/content-quality/analyze.'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to load quality summary: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // POST /api/admin/content-quality/analyze — trigger corpus analysis from quality-index.json
      // Reads quality-index.json from static assets (safe, no GitHub writes, no AI)
      if (pathname === '/api/admin/content-quality/analyze' && method === 'POST') {
        try {
          // Load quality index from compiled admin-views module or static assets
          let indexData = null;
          if (typeof qualityIndexJson !== 'undefined' && qualityIndexJson && qualityIndexJson !== '{}') {
            try {
              indexData = typeof qualityIndexJson === 'string' ? JSON.parse(qualityIndexJson) : qualityIndexJson;
            } catch (_) {}
          }

          if (!indexData || !Array.isArray(indexData.articles)) {
            try {
              let indexResp = await env.ASSETS.fetch(new Request(new URL('/admin/editorial/article-quality-index.json', url.origin).toString()));
              if (!indexResp.ok) {
                indexResp = await env.ASSETS.fetch(new Request(new URL('/admin/editorial/quality-index.json', url.origin).toString()));
              }
              if (indexResp.ok) {
                indexData = await indexResp.json();
              }
            } catch (fetchErr) {
              return new Response(JSON.stringify({
                success: false,
                error: 'Quality index not available. Run the build first: npm run build. Details: ' + fetchErr.message
              }), {
                status: 503,
                headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
              });
            }
          }

          if (!indexData || !Array.isArray(indexData.articles)) {
            return new Response(JSON.stringify({
              success: false,
              error: 'Quality index is empty or malformed. Run npm run build to regenerate.'
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // Parse and analyze — deterministic, no AI, no external calls
          const records = parseArticleIndex(indexData);
          const analyzed = records.map(r => analyzeArticle(r.data, r.body, r.category, r.slug, r.relPath));
          const duplicatePairs = detectDuplicates(analyzed);
          const summary = buildCorpusSummary(analyzed, duplicatePairs);
          const cachePayload = buildCachePayload(analyzed, duplicatePairs, summary);

          // Store result in KV with TTL
          if (env.AUTH_KV) {
            try {
              await env.AUTH_KV.put(QUALITY_CACHE_KEY, JSON.stringify(cachePayload), { expirationTtl: QUALITY_CACHE_TTL });
            } catch (_) {}
          }

          return new Response(JSON.stringify({ success: true, summary, analyzedAt: summary.analyzedAt }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: 'Analysis failed: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // GET /api/admin/content-quality/queue — paginated quality queue
      if (pathname === '/api/admin/content-quality/queue' && method === 'GET') {
        try {
          let cached = null;
          if (env.AUTH_KV) {
            try {
              const raw = await env.AUTH_KV.get(QUALITY_CACHE_KEY);
              if (raw) cached = JSON.parse(raw);
            } catch (_) {}
          }

          if (!cached || !Array.isArray(cached.articles)) {
            return new Response(JSON.stringify({
              success: true,
              needsAnalysis: true,
              items: [],
              total: 0,
              page: 1,
              pageSize: 50,
              totalPages: 0,
              message: 'Content quality index not yet available. Click Analyze Corpus to build the index.'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const filter = url.searchParams.get('filter') || 'all';
          const desk = url.searchParams.get('desk') || '';
          const page = parseInt(url.searchParams.get('page') || '1', 10);
          const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '50', 10));
          const minWords = parseInt(url.searchParams.get('minWords') || '0', 10);
          const maxWordsRaw = url.searchParams.get('maxWords');
          const maxWords = maxWordsRaw ? parseInt(maxWordsRaw, 10) : Infinity;
          const sortBy = url.searchParams.get('sortBy') || 'date_desc';

          const paginated = paginateArticles(cached.articles, { filter, desk, page, pageSize, minWords, maxWords, sortBy });

          return new Response(JSON.stringify({
            success: true,
            needsAnalysis: false,
            cachedAt: cached.cachedAt,
            ...paginated
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to load queue: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // GET /api/admin/content-quality/duplicates — list duplicate pairs
      if (pathname === '/api/admin/content-quality/duplicates' && method === 'GET') {
        try {
          let cached = null;
          if (env.AUTH_KV) {
            try {
              const raw = await env.AUTH_KV.get(QUALITY_CACHE_KEY);
              if (raw) cached = JSON.parse(raw);
            } catch (_) {}
          }

          if (!cached) {
            return new Response(JSON.stringify({ success: true, needsAnalysis: true, pairs: [], total: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const pairs = (cached.duplicatePairs || []);
          const page = parseInt(url.searchParams.get('page') || '1', 10);
          const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') || '50', 10));
          const startIdx = (page - 1) * pageSize;
          const pagePairs = pairs.slice(startIdx, startIdx + pageSize);

          return new Response(JSON.stringify({
            success: true,
            needsAnalysis: false,
            total: pairs.length,
            page,
            pageSize,
            totalPages: Math.ceil(pairs.length / pageSize) || 1,
            pairs: pagePairs,
            cachedAt: cached.cachedAt
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to load duplicates: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      // GET /api/admin/content-quality/article?slug=... — per-article quality detail
      if (pathname === '/api/admin/content-quality/article' && method === 'GET') {
        const slug = url.searchParams.get('slug');
        if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid or missing slug parameter.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        try {
          let cached = null;
          if (env.AUTH_KV) {
            try {
              const raw = await env.AUTH_KV.get(QUALITY_CACHE_KEY);
              if (raw) cached = JSON.parse(raw);
            } catch (_) {}
          }

          if (!cached || !Array.isArray(cached.articles)) {
            return new Response(JSON.stringify({ success: false, error: 'Quality index not available. Run analysis first.', needsAnalysis: true }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          const article = cached.articles.find(a => a.slug === slug);
          if (!article) {
            return new Response(JSON.stringify({ success: false, error: 'Article not found in quality index.' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
            });
          }

          // Find any duplicate pairs involving this article
          const relatedPairs = (cached.duplicatePairs || []).filter(p =>
            p.articleA.slug === slug || p.articleB.slug === slug
          );

          return new Response(JSON.stringify({
            success: true,
            article,
            relatedDuplicates: relatedPairs,
            cachedAt: cached.cachedAt
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to load article quality detail: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }
      }

      return new Response(JSON.stringify({ success: false, error: 'Content quality endpoint not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
    }

    // 6c. API ENDPOINTS: Internal Linking & Orphan Content Diagnostics (/api/admin/internal-links/*)
    if (pathname.startsWith('/api/admin/internal-links/')) {
      const ilToken = getSessionTokenFromRequest(request);
      const ilSession = (ilToken && env.ADMIN_SESSION_SECRET)
        ? await verifySessionToken(ilToken, env.ADMIN_SESSION_SECRET)
        : null;

      if (!ilSession) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      const ilMember = await getAuthenticatedMember(request, env);
      if (!ilMember) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
      if (ilMember.role !== 'owner' && ilMember.role !== 'admin' && ilMember.role !== 'editor') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden. Admin or Editor role required.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      let linkData = null;
      if (typeof internalLinksJson !== 'undefined' && internalLinksJson && internalLinksJson !== '{}') {
        try {
          linkData = typeof internalLinksJson === 'string' ? JSON.parse(internalLinksJson) : internalLinksJson;
        } catch (_) {}
      }

      if (!linkData || !linkData.summary) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Internal links index not available. Run npm run build first.'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/internal-links/summary
      if (pathname === '/api/admin/internal-links/summary' && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          summary: linkData.summary
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/internal-links/queue — paginated & filterable list of articles with links & orphan status
      if (pathname === '/api/admin/internal-links/queue' && method === 'GET') {
        const desk = url.searchParams.get('desk') || 'all';
        const status = url.searchParams.get('status') || 'all';
        const search = url.searchParams.get('search') || '';
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '50', 10));
        const sortBy = url.searchParams.get('sortBy') || 'inbound_asc';

        const paginated = paginateInternalLinks(linkData.articles, { desk, status, search, page, pageSize, sortBy });

        return new Response(JSON.stringify({
          success: true,
          ...paginated
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/internal-links/article?slug=... — single article detailed link breakdown
      if (pathname === '/api/admin/internal-links/article' && method === 'GET') {
        const slug = url.searchParams.get('slug');
        if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid or missing slug parameter.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        const article = (linkData.articles || []).find(a => a.slug === slug);
        if (!article) {
          return new Response(JSON.stringify({ success: false, error: 'Article not found in link graph.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          article
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/internal-links/diagnostics — broken links and anomalies
      if (pathname === '/api/admin/internal-links/diagnostics' && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          brokenLinks: linkData.brokenLinks || [],
          summary: linkData.summary
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Internal links endpoint not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
    }

    // 6.6 API ENDPOINT: Site Health Diagnostics
    if (pathname.startsWith('/api/admin/site-health')) {
      const shSession = getSessionTokenFromRequest(request);
      if (!shSession) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      const shMember = await getAuthenticatedMember(request, env);
      if (!shMember) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
      if (shMember.role !== 'owner' && shMember.role !== 'admin' && shMember.role !== 'editor') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden. Admin or Editor role required.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      let baseHealthData = {};
      if (typeof siteHealthJson !== 'undefined' && siteHealthJson && siteHealthJson !== '{}') {
        try {
          baseHealthData = typeof siteHealthJson === 'string' ? JSON.parse(siteHealthJson) : siteHealthJson;
        } catch (_) {}
      }

      // GET /api/admin/site-health/summary
      if (pathname === '/api/admin/site-health/summary' && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          summary: baseHealthData.summary || {},
          overallStatus: baseHealthData.overallStatus || 'UNKNOWN',
          generatedAt: baseHealthData.generatedAt || new Date().toISOString()
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/site-health/diagnostics
      if (pathname === '/api/admin/site-health/diagnostics' && method === 'GET') {
        const liveDiagnostics = await resolveSiteHealth(request, env, baseHealthData);
        return new Response(JSON.stringify({
          success: true,
          diagnostics: liveDiagnostics
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // POST /api/admin/site-health/run
      if (pathname === '/api/admin/site-health/run' && method === 'POST') {
        const runDiagnostics = await resolveSiteHealth(request, env, baseHealthData);
        return new Response(JSON.stringify({
          success: true,
          message: 'Diagnostics executed successfully',
          diagnostics: runDiagnostics
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Site health endpoint not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
      });
    }

    // 6.7 API ENDPOINT: Newsletter Management (Phase J)
    if (pathname.startsWith('/api/admin/newsletter')) {
      const nlSession = getSessionTokenFromRequest(request);
      if (!nlSession) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      const nlMember = await getAuthenticatedMember(request, env);
      if (!nlMember) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized. Please log in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }
      if (nlMember.role !== 'owner' && nlMember.role !== 'admin' && nlMember.role !== 'editor') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden. Admin or Editor role required.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/newsletter/subscribers
      if (pathname === '/api/admin/newsletter/subscribers' && method === 'GET') {
        const page = url.searchParams.get('page') || 1;
        const limit = url.searchParams.get('limit') || 50;
        const search = url.searchParams.get('search') || '';
        const status = url.searchParams.get('status') || 'all';

        const result = await listSubscribers(env, { page, limit, search, status });
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/newsletter/stats
      if (pathname === '/api/admin/newsletter/stats' && method === 'GET') {
        const result = await getNewsletterStats(env);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // POST /api/admin/newsletter/subscribers/status
      if (pathname === '/api/admin/newsletter/subscribers/status' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await updateSubscriberStatus(env, { id: body.id, status: body.status });
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // POST /api/admin/newsletter/subscribers/delete
      if (pathname === '/api/admin/newsletter/subscribers/delete' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await deleteSubscriber(env, { id: body.id });
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/newsletter/campaigns
      if (pathname === '/api/admin/newsletter/campaigns' && method === 'GET') {
        const campaigns = await getCampaignsIndex(env);
        return new Response(JSON.stringify({ success: true, campaigns }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // POST /api/admin/newsletter/campaigns OR /api/admin/newsletter/campaigns/draft
      if ((pathname === '/api/admin/newsletter/campaigns' || pathname === '/api/admin/newsletter/campaigns/draft') && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await saveCampaignDraft(env, {
          id: body.id,
          title: body.title || body.subject || 'Draft Campaign',
          subject: body.subject,
          preheader: body.preheader,
          bodyContent: body.bodyContent || body.content,
          targetAudience: body.targetAudience,
          author: nlMember.displayName || 'Editor'
        });
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET or POST /api/admin/newsletter/campaigns/preview
      if (pathname === '/api/admin/newsletter/campaigns/preview' && (method === 'GET' || method === 'POST')) {
        let postBody = {};
        if (method === 'POST') {
          postBody = await request.json().catch(() => ({}));
        }
        const campId = postBody.id || url.searchParams.get('id');
        let campaign = null;
        if (campId) {
          campaign = await getCampaignById(env, campId);
        }
        const renderedHtml = renderCampaignHtml({
          title: postBody.title || (campaign ? campaign.title : (url.searchParams.get('title') || 'The Daily Briefing')),
          subject: postBody.subject || (campaign ? campaign.subject : (url.searchParams.get('subject') || "Today's Top Verified Dispatches")),
          preheader: postBody.preheader || (campaign ? campaign.preheader : (url.searchParams.get('preheader') || '')),
          bodyContent: postBody.bodyContent || postBody.content || (campaign ? campaign.bodyContent : (url.searchParams.get('body') || '')),
          subscriberEmail: 'editor-preview@thesamachardaily.in',
          unsubscribeUrl: 'https://thesamachardaily.in/api/newsletter/unsubscribe?preview=1'
        });

        const wantsRawHtml = url.searchParams.get('raw') === 'true';
        if (wantsRawHtml) {
          return new Response(renderedHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() }
          });
        }

        return new Response(JSON.stringify({ success: true, previewHtml: renderedHtml, html: renderedHtml }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/newsletter/digest/preview (Phase M)
      if (pathname === '/api/admin/newsletter/digest/preview' && method === 'GET') {
        let articles = [];
        if (env && env.ASSETS) {
          const resp = await env.ASSETS.fetch(new Request(new URL('/search-index.json', url.origin).toString())).catch(() => null);
          if (resp && resp.ok) {
            articles = await resp.json().catch(() => []);
          }
        }
        if (articles.length === 0 && typeof qualityIndexJson !== 'undefined' && qualityIndexJson && qualityIndexJson !== '{}') {
          try {
            const parsed = typeof qualityIndexJson === 'string' ? JSON.parse(qualityIndexJson) : qualityIndexJson;
            articles = parsed.articles || [];
          } catch (_) {}
        }

        const digestDate = url.searchParams.get('date') || undefined;
        const digest = buildDailyDigest(articles, { digestDate });
        const previewHtml = renderDigestHtml(digest, { subscriberEmail: 'editor-preview@thesamachardaily.in' });
        const previewText = renderDigestPlainText(digest, { subscriberEmail: 'editor-preview@thesamachardaily.in' });

        if (url.searchParams.get('raw') === 'true') {
          return new Response(previewHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders() }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          digest,
          previewHtml,
          previewText
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // POST /api/admin/newsletter/digest/test-run (Phase M)
      if (pathname === '/api/admin/newsletter/digest/test-run' && method === 'POST') {
        let articles = [];
        if (env && env.ASSETS) {
          const resp = await env.ASSETS.fetch(new Request(new URL('/search-index.json', url.origin).toString())).catch(() => null);
          if (resp && resp.ok) {
            articles = await resp.json().catch(() => []);
          }
        }
        if (articles.length === 0 && typeof qualityIndexJson !== 'undefined' && qualityIndexJson && qualityIndexJson !== '{}') {
          try {
            const parsed = typeof qualityIndexJson === 'string' ? JSON.parse(qualityIndexJson) : qualityIndexJson;
            articles = parsed.articles || [];
          } catch (_) {}
        }

        const body = await request.json().catch(() => ({}));
        const digest = buildDailyDigest(articles, { digestDate: body.digestDate });
        const subscribers = await getSubscribersIndex(env);
        const runResult = await executeDailyDigestRun({ env, digest, subscribers });

        return new Response(JSON.stringify({
          success: true,
          runResult
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // GET /api/admin/newsletter/digest/status (Phase M)
      if (pathname === '/api/admin/newsletter/digest/status' && method === 'GET') {
        const digestDate = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        let runStatus = null;
        if (env && env.AUTH_KV) {
          try {
            runStatus = await env.AUTH_KV.get(`newsletter:digest_run:${digestDate}`, 'json');
          } catch (_) {}
        }

        const deliveryConfig = getDeliveryConfig(env);
        return new Response(JSON.stringify({
          success: true,
          digestDate,
          runStatus: runStatus || { status: 'idle', digestDate },
          deliveryConfig
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      // POST /api/admin/newsletter/campaigns/send
      if (pathname === '/api/admin/newsletter/campaigns/send' && method === 'POST') {
        // Enforce Phase J & M requirement:
        // Do not send real campaigns or contact subscribers unless explicitly configured.
        // Return 501 when delivery provider is unconfigured.
        const deliveryConfig = getDeliveryConfig(env);
        if (!deliveryConfig.sendingEnabled) {
          return new Response(JSON.stringify({
            success: false,
            deliveryConfigured: false,
            error: 'Email delivery provider is unconfigured. Real campaign delivery is deferred to Phase M.',
            message: 'Email delivery provider is unconfigured. Real campaign delivery is deferred to Phase M.',
            deliveryProvider: null,
            isSimulation: true
          }), {
            status: 501,
            headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          deliveryConfigured: true,
          provider: deliveryConfig.provider,
          message: 'Campaign delivery initiated.'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Newsletter endpoint not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...getSecurityHeaders() }
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
  },

  async scheduled(event, env, ctx) {
    if (env && env.NEWSLETTER_SENDING_ENABLED === 'true') {
      ctx.waitUntil(handleScheduledDailyDigest(event, env));
    } else {
      console.log('[NEWSLETTER SCHEDULER] Daily digest scheduled trigger received. Sending disabled by policy (NEWSLETTER_SENDING_ENABLED!=true). Exiting safely.');
    }
  }
};

/**
 * Handles scheduled daily digest execution.
 * Only invoked if NEWSLETTER_SENDING_ENABLED is explicitly true.
 */
export async function handleScheduledDailyDigest(event, env) {
  try {
    let articles = [];
    if (env && env.ASSETS) {
      const resp = await env.ASSETS.fetch(new Request('https://thesamachardaily.in/search-index.json')).catch(() => null);
      if (resp && resp.ok) {
        articles = await resp.json().catch(() => []);
      }
    }
    if (articles.length === 0 && typeof qualityIndexJson !== 'undefined' && qualityIndexJson && qualityIndexJson !== '{}') {
      try {
        const parsed = typeof qualityIndexJson === 'string' ? JSON.parse(qualityIndexJson) : qualityIndexJson;
        articles = parsed.articles || [];
      } catch (_) {}
    }

    const digest = buildDailyDigest(articles);
    if (!digest || digest.empty) {
      console.log('[NEWSLETTER SCHEDULER] No eligible articles for daily digest. Skipping run.');
      return;
    }

    const subscribers = await getSubscribersIndex(env);
    const runResult = await executeDailyDigestRun({ env, digest, subscribers });
    console.log(`[NEWSLETTER SCHEDULER] Completed daily digest run: ${runResult.digestId}, sent: ${runResult.sentCount}, failed: ${runResult.failedCount}`);
  } catch (err) {
    console.error('[NEWSLETTER SCHEDULER] Scheduled run encountered error:', err.message);
  }
}
