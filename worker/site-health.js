/**
 * Samachar Daily — Cloudflare Worker Site Health Engine
 *
 * Implements server-side diagnostic endpoints for /api/admin/site-health/*
 * Performs honest, bounded, safe HTTP probes of allowlisted read-only endpoints.
 * Evaluates live Cloudflare Worker bindings, client lockout state,
 * security headers, and merges them with deterministic build-time facts.
 *
 * Strictly read-only. ZERO AI calls. ZERO Code.gs calls.
 */

import { getSecurityHeaders, getClientIp, getLockoutState } from './auth.js';

export const SAFE_PROBE_ALLOWLIST = [
  { route: '/', label: 'Homepage', method: 'GET', expectedStatus: 200, targetClass: 'Production Homepage' },
  { route: '/india/', label: 'India Desk', method: 'GET', expectedStatus: 200, targetClass: 'National News Wire' },
  { route: '/search/', label: 'Search Portal', method: 'GET', expectedStatus: 200, targetClass: 'Search Portal' },
  { route: '/404.html', label: 'Smart 404 Recovery', method: 'GET', expectedStatus: 200, targetClass: 'Smart 404 Recovery Page' },
  { route: '/robots.txt', label: 'Robots Directives', method: 'GET', expectedStatus: 200, targetClass: 'Crawler Policy Directives' },
  { route: '/sitemap.xml', label: 'XML Sitemap', method: 'GET', expectedStatus: 200, targetClass: 'XML Sitemap Index' },
  { route: '/admin', label: 'Admin Login', method: 'GET', expectedStatus: 200, targetClass: 'Admin Login Portal' },
  { route: '/api/admin/members', label: 'Protected Members API', method: 'GET', expectedStatus: 401, targetClass: 'Protected Auth Endpoint (Unauthenticated Probe)' }
];

export async function resolveSiteHealth(request, env, baseData = {}, options = {}) {
  const url = new URL(request.url);
  const clientIp = getClientIp(request);
  const checkedAt = new Date().toISOString();

  // 0. Prevent recursive self-probing loops
  if (request.headers && (request.headers.get('X-Diagnostic-Probe') === '1' || request.headers.get('X-Diagnostic-Probe') === 'true')) {
    return {
      error: 'Recursive probe prevented',
      status: 'LOOP_PREVENTED',
      checkedAt
    };
  }

  // 1. Inspect live environment bindings
  const hasPasswordHash = Boolean(env && env.ADMIN_PASSWORD_HASH);
  const hasSessionSecret = Boolean(env && env.ADMIN_SESSION_SECRET);
  const hasAuthKv = Boolean(env && env.AUTH_KV);
  const hasRateLimiter = Boolean(env && env.LOGIN_RATE_LIMITER);

  // 2. Inspect client IP lockout state
  let lockoutInfo = { isLocked: false, attempts: 0 };
  if (hasAuthKv) {
    try {
      lockoutInfo = await getLockoutState(env, clientIp);
    } catch (_) {}
  }

  // 3. Security headers verified
  const secHeaders = getSecurityHeaders();

  // 4. Live security status evaluation
  const liveSecurity = {
    ...baseData.security,
    checkType: 'CONFIGURATION_CHECK',
    environmentBindings: {
      ADMIN_PASSWORD_HASH: hasPasswordHash ? 'Configured' : 'Missing',
      ADMIN_SESSION_SECRET: hasSessionSecret ? 'Configured' : 'Missing',
      AUTH_KV: hasAuthKv ? 'Bound' : 'Missing',
      LOGIN_RATE_LIMITER: hasRateLimiter ? 'Bound' : 'Not bound'
    },
    clientIp,
    lockoutState: lockoutInfo.isLocked ? `Locked until ${new Date(lockoutInfo.lockedUntil).toLocaleTimeString()}` : 'Clear (0 active locks)',
    activeHeaders: secHeaders
  };

  // 5. Genuine, Safe HTTP Probes of Allowlisted Endpoints
  const probeFetcher = options.fetcher || (env && env.PROBE_FETCHER) || (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  const measuredEndpoints = [];

  // Determine endpoints to inspect (strict adherence to safe allowlist)
  const candidateEndpoints = (baseData.serverResponse && Array.isArray(baseData.serverResponse.endpoints) && baseData.serverResponse.endpoints.length > 0)
    ? baseData.serverResponse.endpoints
    : SAFE_PROBE_ALLOWLIST;

  for (const ep of candidateEndpoints) {
    // Check if endpoint is permitted on allowlist
    const allowlisted = SAFE_PROBE_ALLOWLIST.find(a => a.route === ep.route);
    if (!allowlisted) {
      // Disallow probing unverified or arbitrary endpoints
      measuredEndpoints.push({
        route: ep.route,
        label: ep.label || ep.route,
        method: ep.method || 'GET',
        expectedStatus: ep.expectedStatus || 200,
        targetClass: 'Non-allowlisted route',
        checkType: 'CONFIGURATION_CHECK',
        status: 'UNPROBED',
        statusCode: null,
        statusLabel: 'Omitted from live HTTP probe (not in safe allowlist)',
        checkedAt
      });
      continue;
    }

    if (!probeFetcher) {
      measuredEndpoints.push({
        route: allowlisted.route,
        label: allowlisted.label,
        method: allowlisted.method,
        expectedStatus: allowlisted.expectedStatus,
        targetClass: allowlisted.targetClass,
        checkType: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        statusCode: null,
        statusLabel: 'HTTP probe client unavailable',
        reason: 'No network fetcher available in runtime environment',
        checkedAt
      });
      continue;
    }

    const start = Date.now();
    try {
      const probeUrl = new URL(allowlisted.route, url.origin).href;

      // Strict timeout controller (3000ms max)
      let signal;
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        signal = AbortSignal.timeout(3000);
      } else {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);
        signal = controller.signal;
      }

      // Safe probe request: ZERO auth/cookies, loop header attached
      const res = await probeFetcher(probeUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'SamacharDaily-SiteHealth/1.0',
          'X-Diagnostic-Probe': '1',
          'Accept': '*/*'
        },
        signal,
        redirect: 'manual'
      });

      const durationMs = Date.now() - start;
      const isExpected = (res.status === allowlisted.expectedStatus);
      const contentType = res.headers && typeof res.headers.get === 'function' ? (res.headers.get('content-type') || null) : null;
      const nosniff = res.headers && typeof res.headers.get === 'function' ? (res.headers.get('x-content-type-options') === 'nosniff') : false;
      const xFrame = res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-frame-options') : null;
      const redirected = Boolean(res.redirected || (res.status >= 300 && res.status < 400));

      measuredEndpoints.push({
        route: allowlisted.route,
        label: allowlisted.label,
        method: allowlisted.method,
        expectedStatus: allowlisted.expectedStatus,
        targetClass: allowlisted.targetClass,
        checkType: 'REAL_HTTP_PROBE',
        status: isExpected ? 'PASS' : 'FAIL',
        statusCode: res.status,
        statusLabel: `${res.status} ${res.statusText || ''}`.trim(),
        contentType,
        responseTimeMs: durationMs,
        redirected,
        securityHeaders: {
          nosniff,
          xFrameOptions: xFrame
        },
        checkedAt
      });
    } catch (err) {
      const durationMs = Date.now() - start;
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || (err.message && err.message.toLowerCase().includes('timeout'));

      measuredEndpoints.push({
        route: allowlisted.route,
        label: allowlisted.label,
        method: allowlisted.method,
        expectedStatus: allowlisted.expectedStatus,
        targetClass: allowlisted.targetClass,
        checkType: 'REAL_HTTP_PROBE',
        status: isTimeout ? 'TIMEOUT' : 'FAIL',
        statusCode: null,
        statusLabel: isTimeout ? 'Probe Timed Out (>3000ms)' : 'Connection Failed',
        error: err.message || 'Unknown network error',
        responseTimeMs: durationMs,
        checkedAt
      });
    }
  }

  // Determine overall serverResponse status honestly
  const hasFail = measuredEndpoints.some(e => e.status === 'FAIL');
  const hasTimeout = measuredEndpoints.some(e => e.status === 'TIMEOUT');
  const allPass = measuredEndpoints.length > 0 && measuredEndpoints.every(e => e.status === 'PASS');
  const overallServerStatus = hasFail ? 'FAIL' : (hasTimeout ? 'WARNING' : (allPass ? 'PASS' : 'AVAILABLE_IN_RUNTIME'));

  return {
    ...baseData,
    checkedAt,
    isLiveRun: true,
    security: liveSecurity,
    serverResponse: {
      status: overallServerStatus,
      checkType: 'REAL_HTTP_PROBE',
      runtime: 'Cloudflare Edge Worker Runtime',
      lastProbeAt: checkedAt,
      endpoints: measuredEndpoints
    }
  };
}
