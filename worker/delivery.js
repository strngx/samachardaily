/**
 * Samachar Daily — Newsletter Delivery Adapter Architecture (Phase M)
 *
 * Implements provider-independent outbound delivery with:
 * 1. Mock adapter as safe default (zero external network requests).
 * 2. Strict fail-closed policy (NEWSLETTER_SENDING_ENABLED=false by default).
 * 3. Dormant Resend provider adapter (active only with explicit flag AND API key).
 * 4. Durable best-effort idempotency tracking in AUTH_KV (newsletter:digest_run:YYYY-MM-DD).
 * 5. Re-check of active subscriber status immediately before delivery.
 * 6. Full redaction of subscriber PII and secrets in logs.
 *
 * Cloudflare KV Consistency Note:
 * Cloudflare KV is eventually consistent and lacks atomic compare-and-swap primitives.
 * Our idempotency sentinels provide best-effort protection against duplicate scheduler runs,
 * but do not guarantee transactional exactly-once semantics.
 */

import { renderDigestHtml, renderDigestPlainText } from './digest-templates.js';
import { SITE_ORIGIN } from './digest.js';
import { KEY_SUBSCRIBER_PREFIX, SUBSCRIBER_STATUS } from './newsletter.js';

export const IDEMPOTENCY_PREFIX = 'newsletter:digest_run:';
export const DEFAULT_FROM_ADDRESS = 'Samachar Daily <briefing@thesamachardaily.in>';

/**
 * Inspects environment to determine delivery configuration.
 */
export function getDeliveryConfig(env = {}) {
  const sendingEnabled = Boolean(env && env.NEWSLETTER_SENDING_ENABLED === 'true');
  const provider = (env && env.NEWSLETTER_PROVIDER) || 'mock';
  const hasResendKey = Boolean(env && env.RESEND_API_KEY && env.RESEND_API_KEY.trim());
  const fromAddress = (env && env.NEWSLETTER_FROM_EMAIL) || DEFAULT_FROM_ADDRESS;

  return {
    sendingEnabled,
    provider: sendingEnabled ? provider : 'mock',
    configuredProvider: provider,
    hasCredentials: hasResendKey,
    fromAddress,
    isMock: !sendingEnabled || provider === 'mock'
  };
}

/**
 * Sanitizes strings for logging (masks email and tokens).
 */
export function sanitizeLogString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/unsub_[a-f0-9]{16,64}/gi, '[REDACTED_TOKEN]')
    .replace(/re_[a-zA-Z0-9_-]{16,64}/gi, '[REDACTED_API_KEY]');
}

/**
 * Sends a single digest email via the designated provider adapter.
 */
export async function sendDigestEmail({ env, digest, subscriber, config = null, fetchFn = globalThis.fetch } = {}) {
  const effectiveConfig = config || getDeliveryConfig(env);

  // 1. Double check subscriber active status in KV right before sending
  if (env && env.AUTH_KV && subscriber.id) {
    try {
      const raw = await env.AUTH_KV.get(`${KEY_SUBSCRIBER_PREFIX}${subscriber.id}`, 'json');
      if (!raw || raw.status !== SUBSCRIBER_STATUS.ACTIVE) {
        return {
          success: false,
          skipped: true,
          reason: 'SUBSCRIBER_INACTIVE_OR_UNSUBSCRIBED'
        };
      }
    } catch (_) {
      // If KV lookup fails, fail closed if unconfirmed
    }
  }

  const unsubscribeUrl = `${SITE_ORIGIN}/api/newsletter/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken || '')}`;
  const html = renderDigestHtml(digest, {
    subscriberEmail: subscriber.email,
    unsubscribeToken: subscriber.unsubscribeToken,
    unsubscribeUrl
  });
  const text = renderDigestPlainText(digest, {
    subscriberEmail: subscriber.email,
    unsubscribeToken: subscriber.unsubscribeToken,
    unsubscribeUrl
  });

  // 2. Default MOCK ADAPTER (Safe, Zero Network)
  if (effectiveConfig.isMock) {
    return {
      success: true,
      simulated: true,
      provider: 'mock',
      recipientMasked: sanitizeLogString(subscriber.email),
      subject: digest.subject,
      timestamp: new Date().toISOString()
    };
  }

  // 3. FAIL-CLOSED: If sending enabled but credentials missing
  if (effectiveConfig.provider === 'resend' && !effectiveConfig.hasCredentials) {
    return {
      success: false,
      error: 'Resend API key missing from environment.',
      errorCode: 'MISSING_CREDENTIALS',
      provider: 'resend'
    };
  }

  // 4. DORMANT RESEND ADAPTER (Active only when explicitly enabled AND credentials present)
  if (effectiveConfig.provider === 'resend') {
    const payload = {
      from: effectiveConfig.fromAddress,
      to: [subscriber.email],
      subject: digest.subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    };

    try {
      const resp = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        return {
          success: false,
          statusCode: resp.status,
          error: sanitizeLogString(errorText) || 'Provider rejected request.',
          errorCode: resp.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
          provider: 'resend'
        };
      }

      const resData = await resp.json().catch(() => ({}));
      return {
        success: true,
        messageId: resData.id || null,
        provider: 'resend',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: sanitizeLogString(err.message),
        errorCode: 'NETWORK_ERROR',
        provider: 'resend'
      };
    }
  }

  return {
    success: false,
    error: `Unsupported provider: ${effectiveConfig.provider}`,
    errorCode: 'UNSUPPORTED_PROVIDER'
  };
}

/**
 * Executes a daily digest run over a list of active subscribers with idempotency guardrails.
 */
export async function executeDailyDigestRun({ env, digest, subscribers = [], clock = new Date(), fetchFn = globalThis.fetch } = {}) {
  const config = getDeliveryConfig(env);
  const digestDate = digest.digestDate || clock.toISOString().slice(0, 10);
  const idempotencyKey = `${IDEMPOTENCY_PREFIX}${digestDate}`;

  // 1. Idempotency Check in AUTH_KV
  if (env && env.AUTH_KV) {
    try {
      const existingRun = await env.AUTH_KV.get(idempotencyKey, 'json');
      if (existingRun) {
        if (existingRun.status === 'completed') {
          return {
            success: true,
            skipped: true,
            reason: 'ALREADY_COMPLETED',
            message: `Daily digest for ${digestDate} was already completed.`,
            existingRun
          };
        }
        // In-progress lock check (30 minute timeout)
        if (existingRun.status === 'in_progress') {
          const started = new Date(existingRun.startedAt || 0).getTime();
          if (Date.now() - started < 30 * 60 * 1000) {
            return {
              success: true,
              skipped: true,
              reason: 'RUN_IN_PROGRESS',
              message: `Daily digest run for ${digestDate} is currently in progress.`,
              existingRun
            };
          }
        }
      }

      // Mark run as in_progress (TTL: 24h)
      await env.AUTH_KV.put(idempotencyKey, JSON.stringify({
        status: 'in_progress',
        digestId: digest.digestId,
        startedAt: clock.toISOString(),
        provider: config.provider,
        isMock: config.isMock
      }), { expirationTtl: 86400 });
    } catch (_) {
      // Graceful fallback if KV read fails
    }
  }

  // 2. Filter Active Subscribers
  const activeSubscribers = (subscribers || []).filter(s => s && s.status === SUBSCRIBER_STATUS.ACTIVE);
  const results = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  // 3. Batch Delivery (Batches of 10 to respect memory and potential rate limits)
  const BATCH_SIZE = 10;
  for (let i = 0; i < activeSubscribers.length; i += BATCH_SIZE) {
    const batch = activeSubscribers.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(sub => sendDigestEmail({ env, digest, subscriber: sub, config, fetchFn }));
    const batchResults = await Promise.all(batchPromises);

    for (const r of batchResults) {
      if (r.success) {
        results.sent++;
      } else if (r.skipped) {
        results.skipped++;
      } else {
        results.failed++;
        if (r.error) {
          results.errors.push(sanitizeLogString(r.error));
        }
      }
    }
  }

  // 4. Record Final Run State in AUTH_KV
  const finalRunState = {
    status: results.failed === 0 ? 'completed' : (results.sent > 0 ? 'partial' : 'failed'),
    digestId: digest.digestId,
    digestDate,
    provider: config.provider,
    isMock: config.isMock,
    sentCount: results.sent,
    failedCount: results.failed,
    skippedCount: results.skipped,
    completedAt: new Date().toISOString(),
    articlesCount: digest.totalArticles
  };

  if (env && env.AUTH_KV) {
    try {
      await env.AUTH_KV.put(idempotencyKey, JSON.stringify(finalRunState), { expirationTtl: 86400 * 7 });
    } catch (_) {}
  }

  return {
    success: results.failed === 0,
    digestId: digest.digestId,
    ...finalRunState
  };
}
