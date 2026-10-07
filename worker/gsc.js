/**
 * Samachar Daily — Google Search Console API Engine (Phase 2)
 *
 * Implements server-side, read-only integration with official Google Search Console API:
 * 1. Read-only search analytics (Clicks, Impressions, CTR, Position)
 * 2. Dimensions breakdown (queries, pages, dates)
 * 3. Secure token storage in Cloudflare KV (AUTH_KV)
 * 4. Automatic token refresh before expiration
 * 5. Server-side caching & rate-limit protection
 * 6. Sitemaps query for indexing & coverage metrics
 * 7. Strictly isolated from client-side JavaScript (Zero credentials in browser)
 */

import {
  base64UrlEncode,
  base64UrlDecode,
  base64UrlDecodeToString
} from './auth.js';

// Default Search Console property identifier for SamacharDaily
export const DEFAULT_GSC_PROPERTY = 'https://thesamachardaily.in/';

// Read-only Search Console scopes
export const GSC_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'openid',
  'email',
  'profile'
].join(' ');

// Storage keys in AUTH_KV
export const KEY_GSC_TOKENS = 'gsc:tokens';
export const KEY_GSC_CONFIG = 'gsc:config';
export const KEY_GSC_CACHE_PREFIX = 'gsc:cache:';

// Cache TTL: 15 minutes (Search Console data updates daily/every few days)
export const GSC_CACHE_TTL_SECONDS = 15 * 60;

/**
 * Resolves Google OAuth credentials and property configuration from Worker environment.
 */
export function getGSCConfig(env) {
  const clientId = env?.GSC_CLIENT_ID || env?.GOOGLE_CLIENT_ID || null;
  const clientSecret = env?.GSC_CLIENT_SECRET || env?.GOOGLE_CLIENT_SECRET || null;
  const propertyId = env?.GSC_PROPERTY_ID || DEFAULT_GSC_PROPERTY;

  const configured = Boolean(clientId && clientSecret);
  const missing = [];
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');

  return {
    configured,
    clientId,
    clientSecret,
    propertyId,
    missing
  };
}

/**
 * Retrieves stored GSC token record from AUTH_KV or environment variables.
 */
export async function getGSCTokens(env) {
  if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const raw = await env.AUTH_KV.get(KEY_GSC_TOKENS);
      if (raw) {
        const tokens = JSON.parse(raw);
        if (tokens && (tokens.access_token || tokens.refresh_token)) {
          return tokens;
        }
      }
    } catch (_) {}
  }

  // Fallback to environment variable refresh token if bound
  if (env?.GSC_REFRESH_TOKEN) {
    return {
      refresh_token: env.GSC_REFRESH_TOKEN,
      access_token: null,
      expires_at: 0,
      connected_at: '2026-01-01T00:00:00.000Z',
      connected_by: 'Environment Variable (GSC_REFRESH_TOKEN)',
      source: 'env'
    };
  }

  return null;
}

/**
 * Saves GSC tokens securely to AUTH_KV.
 */
export async function saveGSCTokens(env, tokenData) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  await env.AUTH_KV.put(KEY_GSC_TOKENS, JSON.stringify(tokenData));
}

/**
 * Disconnects GSC: removes tokens and clears cache from AUTH_KV.
 */
export async function deleteGSCTokens(env) {
  if (env && env.AUTH_KV && typeof env.AUTH_KV.delete === 'function') {
    await env.AUTH_KV.delete(KEY_GSC_TOKENS);
    await clearGSCCache(env);
  }
}

/**
 * Clears cached GSC API responses.
 */
export async function clearGSCCache(env) {
  if (!env || !env.AUTH_KV || typeof env.AUTH_KV.list !== 'function') return;
  try {
    const listRes = await env.AUTH_KV.list({ prefix: KEY_GSC_CACHE_PREFIX });
    if (listRes && Array.isArray(listRes.keys)) {
      for (const k of listRes.keys) {
        await env.AUTH_KV.delete(k.name);
      }
    }
  } catch (_) {}
}

/**
 * Retrieves a valid Google access token, automatically refreshing if expired or expiring soon.
 */
export async function getValidAccessToken(env) {
  const tokens = await getGSCTokens(env);
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    return null;
  }

  const nowMs = Date.now();
  // If access token exists and has > 60 seconds of validity remaining, return it
  if (tokens.access_token && tokens.expires_at && tokens.expires_at > (nowMs + 60000)) {
    return tokens.access_token;
  }

  // Refresh token is required to get a new access token
  if (!tokens.refresh_token) {
    return null;
  }

  const config = getGSCConfig(env);
  if (!config.configured) {
    throw new Error('Google OAuth client credentials are not configured in Cloudflare Workers.');
  }

  // Exchange refresh token for fresh access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    }).toString()
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    let isInvalidGrant = false;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error === 'invalid_grant') isInvalidGrant = true;
    } catch (_) {}

    if (isInvalidGrant) {
      // Refresh token revoked or expired -> invalidate local record
      await deleteGSCTokens(env);
      throw new Error('Google Search Console authorization expired or revoked. Please reconnect.');
    }
    throw new Error(`Failed to refresh Google access token (${tokenResp.status}): ${errText}`);
  }

  const tokenData = await tokenResp.json();
  const freshAccessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;

  tokens.access_token = freshAccessToken;
  tokens.expires_at = nowMs + (expiresIn * 1000);
  if (tokenData.refresh_token) {
    tokens.refresh_token = tokenData.refresh_token;
  }

  await saveGSCTokens(env, tokens);
  return freshAccessToken;
}

/**
 * Canonicalizes Google OAuth redirect URI to prevent redirect_uri_mismatch errors.
 * Respects explicit GSC_REDIRECT_URI environment override if configured,
 * canonicalizes production domain (including www aliases) to https://thesamachardaily.in/api/admin/gsc/auth/callback,
 * and preserves localhost/dev origin for local testing.
 */
export function resolveGSCRedirectUri(url, env) {
  if (env?.GSC_REDIRECT_URI) {
    return env.GSC_REDIRECT_URI;
  }
  const u = typeof url === 'string' ? new URL(url) : url;
  const host = (u.hostname || '').toLowerCase();
  if (host === 'thesamachardaily.in' || host === 'www.thesamachardaily.in') {
    return 'https://thesamachardaily.in/api/admin/gsc/auth/callback';
  }
  return `${u.origin}/api/admin/gsc/auth/callback`;
}

/**
 * Builds Google OAuth authorization URL for Search Console connection.
 */
export function buildGSCAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GSC_SCOPES,
    state: state,
    access_type: 'offline', // Requests refresh_token
    prompt: 'consent',      // Forces prompt to guarantee refresh_token
    include_granted_scopes: 'true'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges Google authorization code for Search Console tokens and user info.
 */
export async function exchangeGSCCode({ code, clientId, clientSecret, redirectUri }) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google token exchange failed (${resp.status}): ${errText}`);
  }

  const tokenData = await resp.json();
  let userEmail = null;
  let userName = null;
  let userPicture = null;

  // Retrieve user info to identify the connected Google Account
  if (tokenData.access_token) {
    try {
      const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      if (userResp.ok) {
        const u = await userResp.json();
        userEmail = u.email || null;
        userName = u.name || null;
        userPicture = u.picture || null;
      }
    } catch (_) {}
  }

  // Fallback: Check id_token payload if userinfo didn't provide picture
  if (!userPicture && tokenData.id_token && typeof tokenData.id_token === 'string') {
    try {
      const parts = tokenData.id_token.split('.');
      if (parts.length >= 2) {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = (typeof atob === 'function')
          ? atob(b64)
          : Buffer.from(b64, 'base64').toString('utf8');
        const claims = JSON.parse(jsonStr);
        if (claims.picture) userPicture = claims.picture;
        if (!userEmail && claims.email) userEmail = claims.email;
        if (!userName && claims.name) userName = claims.name;
      }
    } catch (_) {}
  }

  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_in: tokenData.expires_in || 3600,
    scope: tokenData.scope || '',
    userEmail,
    userName,
    userPicture
  };
}

/**
 * Calculates start and end dates based on standard reporting windows with GSC reporting latency.
 * Google Search Console typically publishes finalized performance data with 2–3 days latency.
 */
export function calculateDateRange(rangeKey, customStart = null, customEnd = null) {
  const now = new Date();
  // Safe end date: 2 days ago (latest finalized GSC data)
  const safeEnd = new Date(now.getTime() - (2 * 86400000));
  const endDateStr = safeEnd.toISOString().split('T')[0];

  if (rangeKey === 'custom' && customStart && customEnd) {
    return {
      startDate: customStart,
      endDate: customEnd,
      rangeKey: 'custom'
    };
  }

  let daysBack = 28;
  if (rangeKey === '7days') daysBack = 7;
  else if (rangeKey === '28days') daysBack = 28;
  else if (rangeKey === '3months') daysBack = 90;
  else if (rangeKey === '6months') daysBack = 180;

  const startDate = new Date(safeEnd.getTime() - (daysBack * 86400000)).toISOString().split('T')[0];

  return {
    startDate,
    endDate: endDateStr,
    rangeKey: rangeKey || '28days'
  };
}

/**
 * Queries Google Search Console Search Analytics API with caching and error handling.
 */
export async function querySearchAnalytics(env, {
  propertyId,
  startDate,
  endDate,
  dimensions = [],
  rowLimit = 100,
  startRow = 0,
  searchType = 'web',
  forceRefresh = false
}) {
  const prop = propertyId || getGSCConfig(env).propertyId;
  const cacheKey = `${KEY_GSC_CACHE_PREFIX}analytics:${encodeURIComponent(prop)}:${startDate}:${endDate}:${dimensions.join('_')}:${searchType}:${startRow}_${rowLimit}`;

  // Check KV cache if not force refreshing
  if (!forceRefresh && env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const cachedRaw = await env.AUTH_KV.get(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.data) {
          return {
            ...cached.data,
            cached: true,
            lastSynced: cached.timestamp
          };
        }
      }
    } catch (_) {}
  }

  const accessToken = await getValidAccessToken(env);
  if (!accessToken) {
    return {
      success: false,
      connected: false,
      error: 'Google Search Console is not connected.'
    };
  }

  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`;
  const payload = {
    startDate,
    endDate,
    rowLimit,
    startRow
  };

  if (dimensions && dimensions.length > 0) {
    payload.dimensions = dimensions;
  }
  if (searchType && searchType !== 'web') {
    payload.type = searchType; // 'news', 'image', 'video', 'discover'
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    let userMsg = `Search Console API error (${resp.status})`;
    let errorCode = 'API_ERROR';

    try {
      const errJson = JSON.parse(errorText);
      const errDetail = errJson.error?.message || '';
      if (resp.status === 403) {
        userMsg = `Permission denied for Search Console property "${prop}". Verify that the connected Google Account has permission.`;
        errorCode = 'PERMISSION_DENIED';
      } else if (resp.status === 404) {
        userMsg = `Search Console property "${prop}" was not found in the connected Google Account.`;
        errorCode = 'PROPERTY_NOT_FOUND';
      } else if (resp.status === 429) {
        userMsg = 'Google Search Console API quota or rate limit reached. Please retry in a few moments.';
        errorCode = 'RATE_LIMITED';
      } else if (errDetail) {
        userMsg = `Search Console API error: ${errDetail}`;
      }
    } catch (_) {}

    return {
      success: false,
      connected: true,
      error: userMsg,
      errorCode
    };
  }

  const data = await resp.json();
  const nowIso = new Date().toISOString();

  const result = {
    success: true,
    connected: true,
    property: prop,
    dateRange: { startDate, endDate },
    rows: data.rows || [],
    responseAggregationType: data.responseAggregationType || 'byPage',
    cached: false,
    lastSynced: nowIso
  };

  // Cache in AUTH_KV with TTL
  if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
    try {
      await env.AUTH_KV.put(
        cacheKey,
        JSON.stringify({ data: result, timestamp: nowIso }),
        { expirationTtl: GSC_CACHE_TTL_SECONDS }
      );
    } catch (_) {}
  }

  return result;
}

/**
 * Fetches Sitemaps data from Google Search Console API for index coverage verification.
 */
export async function querySitemaps(env, { propertyId, forceRefresh = false } = {}) {
  const prop = propertyId || getGSCConfig(env).propertyId;
  const cacheKey = `${KEY_GSC_CACHE_PREFIX}sitemaps:${encodeURIComponent(prop)}`;

  if (!forceRefresh && env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const cachedRaw = await env.AUTH_KV.get(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.data) {
          return { ...cached.data, cached: true, lastSynced: cached.timestamp };
        }
      }
    } catch (_) {}
  }

  const accessToken = await getValidAccessToken(env);
  if (!accessToken) {
    return { success: false, connected: false };
  }

  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/sitemaps`;
  const resp = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!resp.ok) {
    return { success: false, error: `Sitemaps API error (${resp.status})` };
  }

  const data = await resp.json();
  const sitemaps = data.sitemap || [];
  const nowIso = new Date().toISOString();

  let totalSubmitted = 0;
  let totalIndexed = 0;
  let hasValidCounts = false;

  for (const sm of sitemaps) {
    if (Array.isArray(sm.contents)) {
      for (const c of sm.contents) {
        if (typeof c.submitted === 'number') {
          totalSubmitted += c.submitted;
          hasValidCounts = true;
        }
        if (typeof c.indexed === 'number') {
          totalIndexed += c.indexed;
          hasValidCounts = true;
        }
      }
    }
  }

  const result = {
    success: true,
    sitemaps,
    hasValidCounts,
    totalSubmitted: hasValidCounts ? totalSubmitted : null,
    totalIndexed: hasValidCounts ? totalIndexed : null,
    lastSynced: nowIso
  };

  if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
    try {
      await env.AUTH_KV.put(
        cacheKey,
        JSON.stringify({ data: result, timestamp: nowIso }),
        { expirationTtl: GSC_CACHE_TTL_SECONDS }
      );
    } catch (_) {}
  }

  return result;
}

/**
 * Comprehensive Search Console Dashboard Data Aggregator:
 * Queries summary, date trend, top queries, and top pages in parallel.
 */
export async function getGSCPerformanceDashboard(env, {
  range = '28days',
  customStart = null,
  customEnd = null,
  searchType = 'web',
  forceRefresh = false
}) {
  const tokens = await getGSCTokens(env);
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    return {
      success: true,
      connected: false,
      message: 'Google Search Console is not connected.'
    };
  }

  const config = getGSCConfig(env);
  const dateRange = calculateDateRange(range, customStart, customEnd);
  const propertyId = config.propertyId;

  // Run analytics queries in parallel for efficiency
  const [summaryRes, queryRes, pageRes, sitemapsRes] = await Promise.all([
    // 1. Overall & Date trend
    querySearchAnalytics(env, {
      propertyId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['date'],
      rowLimit: 100,
      searchType,
      forceRefresh
    }),
    // 2. Top search queries
    querySearchAnalytics(env, {
      propertyId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['query'],
      rowLimit: 100,
      searchType,
      forceRefresh
    }),
    // 3. Top landing pages
    querySearchAnalytics(env, {
      propertyId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['page'],
      rowLimit: 100,
      searchType,
      forceRefresh
    }),
    // 4. Sitemaps info for indexing & coverage
    querySitemaps(env, { propertyId, forceRefresh })
  ]);

  if (!summaryRes.success) {
    return {
      success: false,
      connected: summaryRes.connected !== false,
      error: summaryRes.error || 'Failed to fetch Search Console data.',
      errorCode: summaryRes.errorCode || 'UNKNOWN_ERROR'
    };
  }

  // Calculate totals from date rows
  let totalClicks = 0;
  let totalImpressions = 0;
  let weightedPositionSum = 0;
  const dateRows = summaryRes.rows || [];

  dateRows.forEach(r => {
    totalClicks += (r.clicks || 0);
    totalImpressions += (r.impressions || 0);
    weightedPositionSum += ((r.position || 0) * (r.impressions || 0));
  });

  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;
  const avgPosition = totalImpressions > 0 ? (weightedPositionSum / totalImpressions) : 0;

  // Format queries
  const queries = (queryRes.rows || []).map(r => ({
    query: r.keys && r.keys[0] ? r.keys[0] : 'Unknown',
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: typeof r.position === 'number' ? Math.round(r.position * 10) / 10 : 0
  }));

  // Format pages
  const pages = (pageRes.rows || []).map(r => ({
    page: r.keys && r.keys[0] ? r.keys[0] : 'Unknown',
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: typeof r.position === 'number' ? Math.round(r.position * 10) / 10 : 0
  }));

  // Format chart time series sorted chronologically
  const chart = dateRows.map(r => ({
    date: r.keys && r.keys[0] ? r.keys[0] : '',
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: typeof r.position === 'number' ? Math.round(r.position * 10) / 10 : 0
  })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return {
    success: true,
    connected: true,
    property: propertyId,
    dateRange,
    summary: {
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: avgCtr,
      position: Math.round(avgPosition * 10) / 10
    },
    queries,
    pages,
    chart,
    indexing: {
      totalIndexed: sitemapsRes.totalIndexed,
      totalSubmitted: sitemapsRes.totalSubmitted,
      hasValidCounts: Boolean(sitemapsRes.hasValidCounts)
    },
    cached: Boolean(summaryRes.cached),
    lastSynced: summaryRes.lastSynced || new Date().toISOString()
  };
}

/**
 * Returns current GSC connection status for the UI.
 */
export async function getGSCStatus(env) {
  const config = getGSCConfig(env);
  const tokens = await getGSCTokens(env);

  const connected = Boolean(tokens && (tokens.access_token || tokens.refresh_token));

  return {
    success: true,
    connected,
    configured: config.configured,
    property: config.propertyId,
    accountEmail: tokens?.account_email || tokens?.email || tokens?.userEmail || null,
    accountName: tokens?.account_name || tokens?.userName || tokens?.name || null,
    accountPicture: tokens?.account_picture || tokens?.userPicture || tokens?.picture || null,
    connectedAt: tokens?.connected_at || null,
    connectedBy: tokens?.connected_by || null,
    source: tokens?.source || 'oauth'
  };
}

/**
 * Validates URLs for Google Search Console URL Inspection API.
 * Enforces HTTPS, domain whitelisting, and rejects malicious or external URLs.
 */
export function validateInspectUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string.' };
  }

  const trimmed = urlStr.trim();
  if (!trimmed.startsWith('https://')) {
    return { valid: false, error: 'Only secure HTTPS URLs are permitted for inspection.' };
  }

  // Reject dangerous protocols
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:')) {
    return { valid: false, error: 'Invalid URL scheme.' };
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isDomain = (host === 'thesamachardaily.in' || host === 'www.thesamachardaily.in');

    if (!isDomain) {
      return { valid: false, error: 'Inspection is restricted strictly to thesamachardaily.in domain.' };
    }

    return { valid: true, url: parsed.toString() };
  } catch (err) {
    return { valid: false, error: 'Malformed URL: ' + err.message };
  }
}

/**
 * Calls official Google Search Console URL Inspection API.
 * Endpoint: POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 * Provides caching, quota defense, and transparent verdict parsing.
 */
export async function inspectUrl(env, { url, forceRefresh = false } = {}) {
  const validation = validateInspectUrl(url);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      errorCode: 'INVALID_URL'
    };
  }

  const targetUrl = validation.url;
  const config = getGSCConfig(env);
  const propertyId = config.propertyId;
  const cacheKey = `${KEY_GSC_CACHE_PREFIX}inspect:${encodeURIComponent(targetUrl)}`;

  // Check KV cache if not forced
  if (!forceRefresh && env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const cachedRaw = await env.AUTH_KV.get(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.data) {
          return {
            ...cached.data,
            cached: true,
            lastChecked: cached.timestamp
          };
        }
      }
    } catch (_) {}
  }

  const accessToken = await getValidAccessToken(env);
  if (!accessToken) {
    return {
      success: false,
      connected: false,
      error: 'Google Search Console is not connected.',
      errorCode: 'NOT_CONNECTED'
    };
  }

  const endpoint = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
  const payload = {
    inspectionUrl: targetUrl,
    siteUrl: propertyId
  };

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      let userMsg = `URL Inspection API error (${resp.status})`;
      let errorCode = 'API_ERROR';

      try {
        const errJson = JSON.parse(errorText);
        const detail = errJson.error?.message || '';
        if (resp.status === 401) {
          userMsg = 'Google authentication expired. Please reconnect Search Console.';
          errorCode = 'UNAUTHORIZED';
        } else if (resp.status === 403) {
          userMsg = `Permission denied. Ensure the connected account has access to property "${propertyId}".`;
          errorCode = 'PERMISSION_DENIED';
        } else if (resp.status === 429) {
          userMsg = 'Google Search Console API quota limit reached. Please retry in a few moments.';
          errorCode = 'RATE_LIMITED';
        } else if (detail) {
          userMsg = `Search Console API error: ${detail}`;
        }
      } catch (_) {}

      return {
        success: false,
        connected: true,
        error: userMsg,
        errorCode,
        status: resp.status
      };
    }

    const data = await resp.json();
    const result = data.inspectionResult || {};
    const indexStatus = result.indexStatusResult || {};

    const nowIso = new Date().toISOString();
    const inspectionData = {
      success: true,
      connected: true,
      url: targetUrl,
      property: propertyId,
      verdict: indexStatus.verdict || 'NEUTRAL',
      coverageState: indexStatus.coverageState || 'Unknown',
      robotsTxtState: indexStatus.robotsTxtState || 'ALLOWED',
      indexingState: indexStatus.indexingState || 'INDEXING_ALLOWED',
      lastCrawlTime: indexStatus.lastCrawlTime || null,
      pageFetchState: indexStatus.pageFetchState || 'SUCCESSFUL',
      googleCanonical: indexStatus.googleCanonical || null,
      userCanonical: indexStatus.userCanonical || null,
      sitemap: indexStatus.sitemap || [],
      referringUrls: indexStatus.referringUrls || [],
      crawledAs: indexStatus.crawledAs || 'MOBILE',
      mobileUsability: result.mobileUsabilityResult?.verdict || null,
      richResults: (result.richResultsResult?.detectedItems || []).map(item => ({
        name: item.name || 'Rich Result',
        items: item.items || []
      })),
      cached: false,
      lastChecked: nowIso,
      source: 'Google URL Inspection API'
    };

    // Cache in AUTH_KV for 15 minutes
    if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
      try {
        await env.AUTH_KV.put(
          cacheKey,
          JSON.stringify({ data: inspectionData, timestamp: nowIso }),
          { expirationTtl: GSC_CACHE_TTL_SECONDS }
        );
      } catch (_) {}
    }

    return inspectionData;
  } catch (err) {
    return {
      success: false,
      error: 'Network error calling Google URL Inspection API: ' + err.message,
      errorCode: 'NETWORK_ERROR'
    };
  }
}
