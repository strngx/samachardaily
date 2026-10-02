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
  getClientIp
} from './auth.js';

import { loginHtml, editorialHtml } from './admin-views.js';

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

      // Verify Cloudflare Worker Secrets are configured
      if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_SESSION_SECRET) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Server authentication is not configured. Please configure ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET in Cloudflare Worker Secrets.'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
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
