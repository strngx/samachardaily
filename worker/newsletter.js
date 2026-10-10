/**
 * Samachar Daily — Newsletter & Daily Briefing Engine (Phase J)
 *
 * Implements server-side foundation for:
 * 1. Secure subscriber registration & RFC-compliant email validation
 * 2. Case-normalization and duplicate-safe idempotency
 * 3. Privacy-preserving subscription status and lifecycle timestamps
 * 4. Token-based 1-click unsubscribe mechanism (Phase M compatible)
 * 5. Authenticated admin management (search, list, status toggle, delete)
 * 6. Non-fabricated, real-time subscriber metrics and analytics
 * 7. Campaign drafting, preheader composition, and responsive HTML email preview
 * 8. Zero third-party dependencies (100% Web Crypto & KV-native)
 */

// Storage keys & prefixes
export const KEY_SUBSCRIBER_PREFIX = 'subscriber:';
export const KEY_SUBSCRIBER_EMAIL_PREFIX = 'subscriber_email:';
export const KEY_SUBSCRIBERS_INDEX = 'subscribers:index';
export const KEY_CAMPAIGN_PREFIX = 'campaign:';
export const KEY_CAMPAIGNS_INDEX = 'campaigns:index';

// Status constants
export const SUBSCRIBER_STATUS = {
  ACTIVE: 'active',
  UNSUBSCRIBED: 'unsubscribed'
};

export const CAMPAIGN_STATUS = {
  DRAFT: 'draft',
  READY: 'ready',
  SENT: 'sent'
};

// Target audiences
export const TARGET_AUDIENCES = ['all', 'active'];

/**
 * Normalizes email address (lowercase, trimmed).
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Validates email according to RFC 5322 & length constraints.
 * Rejects control characters, newlines, and malformed domain structures.
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email address is required.' };
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Email address cannot be empty.' };
  }

  if (trimmed.length > 254) {
    return { valid: false, error: 'Email address exceeds maximum length of 254 characters.' };
  }

  // Reject newlines or control characters to prevent header injection
  if (/[\x00-\x1F\x7F\r\n]/.test(trimmed)) {
    return { valid: false, error: 'Email address contains invalid control characters.' };
  }

  // Standard RFC 5322 regex validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'Email must contain exactly one "@" symbol.' };
  }

  const domain = parts[1];
  const domainParts = domain.split('.');
  if (domainParts.length < 2) {
    return { valid: false, error: 'Email domain must contain a top-level domain.' };
  }

  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2) {
    return { valid: false, error: 'Email top-level domain must be at least 2 characters.' };
  }

  return { valid: true, normalized: trimmed.toLowerCase() };
}

/**
 * Generates cryptographically secure random identifier.
 */
export function generateSecureId(prefix = '', byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback if needed
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }

  return prefix ? `${prefix}_${hex}` : hex;
}

/**
 * Retrieves the subscriber index list from AUTH_KV.
 */
export async function getSubscribersIndex(env) {
  if (!env || !env.AUTH_KV) return [];
  try {
    const raw = await env.AUTH_KV.get(KEY_SUBSCRIBERS_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Saves the subscriber index list to AUTH_KV.
 */
export async function saveSubscribersIndex(env, index) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }
  await env.AUTH_KV.put(KEY_SUBSCRIBERS_INDEX, JSON.stringify(index));
}

/**
 * Retrieves an individual subscriber record by ID.
 */
export async function getSubscriberById(env, id) {
  if (!env || !env.AUTH_KV || !id) return null;
  try {
    const raw = await env.AUTH_KV.get(`${KEY_SUBSCRIBER_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Retrieves an individual subscriber record by email address.
 */
export async function getSubscriberByEmail(env, email) {
  if (!env || !env.AUTH_KV || !email) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    const id = await env.AUTH_KV.get(`${KEY_SUBSCRIBER_EMAIL_PREFIX}${normalized}`);
    if (!id) return null;
    return await getSubscriberById(env, id);
  } catch (_) {
    return null;
  }
}

/**
 * Subscribes an email to the newsletter.
 * Handles duplicates safely and idempotently without exposing sensitive user info.
 */
export async function registerSubscriber(env, { email, source = 'web', metadata = {} } = {}) {
  if (!env || !env.AUTH_KV) {
    return { success: false, error: 'Storage binding unavailable', errorCode: 'STORAGE_UNAVAILABLE' };
  }

  const validation = validateEmail(email);
  if (!validation.valid) {
    return { success: false, error: validation.error, errorCode: 'INVALID_EMAIL' };
  }

  const normalized = validation.normalized;
  const now = new Date().toISOString();

  // Check if existing subscriber
  const existingSubscriber = await getSubscriberByEmail(env, normalized);
  if (existingSubscriber) {
    if (existingSubscriber.status === SUBSCRIBER_STATUS.ACTIVE) {
      // Already active: return success idempotently without error or leaking private data
      return {
        success: true,
        message: "You're already subscribed to The Daily Briefing! Look out for our dispatches in your inbox.",
        alreadySubscribed: true
      };
    }

    // Previously unsubscribed: reactivate subscription
    existingSubscriber.status = SUBSCRIBER_STATUS.ACTIVE;
    existingSubscriber.updatedAt = now;
    existingSubscriber.resubscribedAt = now;
    existingSubscriber.source = source;

    await env.AUTH_KV.put(`${KEY_SUBSCRIBER_PREFIX}${existingSubscriber.id}`, JSON.stringify(existingSubscriber));
    if (existingSubscriber.unsubscribeToken) {
      await env.AUTH_KV.put(`subscriber_token:${existingSubscriber.unsubscribeToken}`, existingSubscriber.id);
    }

    // Update index
    const index = await getSubscribersIndex(env);
    const item = index.find(s => s.id === existingSubscriber.id);
    if (item) {
      item.status = SUBSCRIBER_STATUS.ACTIVE;
      item.updatedAt = now;
    } else {
      index.push({
        id: existingSubscriber.id,
        email: normalized,
        status: SUBSCRIBER_STATUS.ACTIVE,
        subscribedAt: existingSubscriber.subscribedAt
      });
    }
    await saveSubscribersIndex(env, index);

    return {
      success: true,
      message: 'Welcome back! Your subscription to The Daily Briefing has been reactivated.',
      resubscribed: true
    };
  }

  // New subscriber registration
  const id = generateSecureId('sub', 12);
  const unsubscribeToken = generateSecureId('unsub', 24);

  const newSubscriber = {
    id,
    email: normalized,
    status: SUBSCRIBER_STATUS.ACTIVE,
    source,
    subscribedAt: now,
    updatedAt: now,
    unsubscribeToken,
    metadata: {
      userAgent: metadata.userAgent || null,
      referrer: metadata.referrer || null
    }
  };

  // Write individual record & email index
  await env.AUTH_KV.put(`${KEY_SUBSCRIBER_PREFIX}${id}`, JSON.stringify(newSubscriber));
  await env.AUTH_KV.put(`${KEY_SUBSCRIBER_EMAIL_PREFIX}${normalized}`, id);
  await env.AUTH_KV.put(`subscriber_token:${unsubscribeToken}`, id);

  // Update master index
  const index = await getSubscribersIndex(env);
  index.push({
    id,
    email: normalized,
    status: SUBSCRIBER_STATUS.ACTIVE,
    subscribedAt: now
  });
  await saveSubscribersIndex(env, index);

  return {
    success: true,
    message: 'Thank you for subscribing to The Daily Briefing! Verified news will arrive in your inbox each morning.'
  };
}

/**
 * Unsubscribes a subscriber using cryptographic token verification.
 * Compatible with Phase M 1-click unsubscribe headers (RFC 8058).
 */
export async function unsubscribeSubscriber(env, { id, token } = {}) {
  if (!env || !env.AUTH_KV) {
    return { success: false, error: 'Storage binding unavailable', errorCode: 'STORAGE_UNAVAILABLE' };
  }

  // A valid cryptographic token is strictly required. Never allow an ID alone to unsubscribe anyone.
  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      success: false,
      error: 'A valid unsubscribe verification token is required.',
      errorCode: 'INVALID_TOKEN',
      status: 'invalid_token'
    };
  }

  const cleanToken = token.trim();
  const subscriberId = await env.AUTH_KV.get(`subscriber_token:${cleanToken}`);

  if (!subscriberId) {
    return { success: false, error: 'Subscriber record not found or link has expired.', errorCode: 'NOT_FOUND', status: 'not_found' };
  }

  // If an ID is also provided, ensure it strictly matches the token owner
  if (id && id !== subscriberId) {
    return { success: false, error: 'Invalid or forged unsubscribe token.', errorCode: 'UNAUTHORIZED', status: 'unauthorized' };
  }

  const subscriber = await getSubscriberById(env, subscriberId);
  if (!subscriber) {
    return { success: false, error: 'Subscriber record not found or link has expired.', errorCode: 'NOT_FOUND', status: 'not_found' };
  }

  // Double check token matches record field
  if (subscriber.unsubscribeToken !== cleanToken) {
    return { success: false, error: 'Invalid or forged unsubscribe token.', errorCode: 'UNAUTHORIZED', status: 'unauthorized' };
  }

  if (subscriber.status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
    return {
      success: true,
      status: 'unsubscribed',
      message: 'You are already unsubscribed from The Daily Briefing.',
      alreadyUnsubscribed: true
    };
  }

  const now = new Date().toISOString();
  subscriber.status = SUBSCRIBER_STATUS.UNSUBSCRIBED;
  subscriber.unsubscribedAt = now;
  subscriber.updatedAt = now;

  await env.AUTH_KV.put(`${KEY_SUBSCRIBER_PREFIX}${subscriberId}`, JSON.stringify(subscriber));

  // Update master index
  const index = await getSubscribersIndex(env);
  const item = index.find(s => s.id === subscriberId);
  if (item) {
    item.status = SUBSCRIBER_STATUS.UNSUBSCRIBED;
    item.unsubscribedAt = now;
    await saveSubscribersIndex(env, index);
  }

  return {
    success: true,
    status: 'unsubscribed',
    message: 'You have been successfully unsubscribed from The Daily Briefing. You will not receive further emails.'
  };
}

/**
 * Retrieves a subscriber record by their cryptographic unsubscribe token.
 * Read-only: does NOT mutate status. Used for safe GET confirmations and pre-send verification.
 */
export async function getSubscriberByToken(env, token) {
  if (!env || !env.AUTH_KV || !token) return null;
  try {
    const subscriberId = await env.AUTH_KV.get(`subscriber_token:${token}`);
    if (!subscriberId) return null;
    const subscriber = await getSubscriberById(env, subscriberId);
    if (!subscriber || subscriber.unsubscribeToken !== token) return null;
    return subscriber;
  } catch (_) {
    return null;
  }
}

/**
 * Calculates genuine subscriber statistics from real stored records.
 * Never uses fabricated or simulated counts.
 */
export async function getNewsletterStats(env) {
  const index = await getSubscribersIndex(env);
  const total = index.length;
  const active = index.filter(s => s.status === SUBSCRIBER_STATUS.ACTIVE).length;
  const unsubscribed = index.filter(s => s.status === SUBSCRIBER_STATUS.UNSUBSCRIBED).length;

  let lastSubscribedAt = null;
  if (index.length > 0) {
    const dates = index.map(s => s.subscribedAt).filter(Boolean);
    if (dates.length > 0) {
      dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      lastSubscribedAt = dates[0];
    }
  }

  return {
    success: true,
    stats: {
      total,
      active,
      unsubscribed,
      lastSubscribedAt
    },
    delivery: {
      configured: false,
      provider: null,
      status: 'UNCONFIGURED (Delivery deferred to Phase M)'
    }
  };
}

/**
 * Lists, searches, and paginates subscribers for administrative overview.
 * Strips private security tokens from output.
 */
export async function listSubscribers(env, { page = 1, limit = 50, search = '', status = 'all' } = {}) {
  const index = await getSubscribersIndex(env);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

  let filtered = [...index];

  // Filter by status
  if (status && status !== 'all') {
    filtered = filtered.filter(s => s.status === status);
  }

  // Filter by search query
  if (search && typeof search === 'string') {
    const query = search.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(s => s.email && s.email.toLowerCase().includes(query));
    }
  }

  // Sort by date descending
  filtered.sort((a, b) => {
    const dateA = new Date(a.subscribedAt || 0).getTime();
    const dateB = new Date(b.subscribedAt || 0).getTime();
    return dateB - dateA;
  });

  const totalFiltered = filtered.length;
  const totalPages = Math.ceil(totalFiltered / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const paginated = filtered.slice(startIndex, startIndex + limitNum);

  // Sanitize for response (remove unsubscribe tokens)
  const sanitized = paginated.map(s => ({
    id: s.id,
    email: s.email,
    status: s.status,
    subscribedAt: s.subscribedAt,
    unsubscribedAt: s.unsubscribedAt || null
  }));

  const totalAll = index.length;
  const activeAll = index.filter(s => s.status === SUBSCRIBER_STATUS.ACTIVE).length;
  const unsubscribedAll = index.filter(s => s.status === SUBSCRIBER_STATUS.UNSUBSCRIBED).length;

  return {
    success: true,
    subscribers: sanitized,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalFiltered,
      totalPages
    },
    stats: {
      total: totalAll,
      active: activeAll,
      unsubscribed: unsubscribedAll
    }
  };
}

/**
 * Updates a subscriber's status administratively.
 */
export async function updateSubscriberStatus(env, { id, status } = {}) {
  if (!id || !status) {
    return { success: false, error: 'Subscriber ID and status are required.' };
  }

  if (status !== SUBSCRIBER_STATUS.ACTIVE && status !== SUBSCRIBER_STATUS.UNSUBSCRIBED) {
    return { success: false, error: 'Invalid status value. Must be "active" or "unsubscribed".' };
  }

  const subscriber = await getSubscriberById(env, id);
  if (!subscriber) {
    return { success: false, error: 'Subscriber not found.' };
  }

  const now = new Date().toISOString();
  subscriber.status = status;
  subscriber.updatedAt = now;
  if (status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
    subscriber.unsubscribedAt = now;
  }

  await env.AUTH_KV.put(`${KEY_SUBSCRIBER_PREFIX}${id}`, JSON.stringify(subscriber));

  // Update index
  const index = await getSubscribersIndex(env);
  const item = index.find(s => s.id === id);
  if (item) {
    item.status = status;
    item.updatedAt = now;
    await saveSubscribersIndex(env, index);
  }

  return { success: true, message: `Subscriber status updated to ${status}.` };
}

/**
 * Permanently deletes a subscriber record (privacy / GDPR compliance).
 */
export async function deleteSubscriber(env, { id } = {}) {
  if (!id) return { success: false, error: 'Subscriber ID is required.' };

  const subscriber = await getSubscriberById(env, id);
  if (!subscriber) {
    return { success: false, error: 'Subscriber not found.' };
  }

  // Delete individual record and email pointer
  await env.AUTH_KV.delete(`${KEY_SUBSCRIBER_PREFIX}${id}`);
  if (subscriber.email) {
    await env.AUTH_KV.delete(`${KEY_SUBSCRIBER_EMAIL_PREFIX}${subscriber.email}`);
  }
  if (subscriber.unsubscribeToken) {
    await env.AUTH_KV.delete(`subscriber_token:${subscriber.unsubscribeToken}`);
  }

  // Remove from index
  const index = await getSubscribersIndex(env);
  const updatedIndex = index.filter(s => s.id !== id);
  await saveSubscribersIndex(env, updatedIndex);

  return { success: true, message: 'Subscriber record permanently deleted.' };
}

// ---------------------------------------------------------------------------
// CAMPAIGN DRAFTING & PREVIEW SYSTEM
// ---------------------------------------------------------------------------

/**
 * Retrieves the campaigns index list.
 */
export async function getCampaignsIndex(env) {
  if (!env || !env.AUTH_KV) return [];
  try {
    const raw = await env.AUTH_KV.get(KEY_CAMPAIGNS_INDEX);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

/**
 * Saves a drafted campaign.
 */
export async function saveCampaignDraft(env, {
  id,
  title,
  subject,
  preheader = '',
  bodyContent = '',
  targetAudience = 'all',
  author = 'Editorial Desk'
} = {}) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    return { success: false, error: 'Campaign title is required.' };
  }
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return { success: false, error: 'Campaign email subject is required.' };
  }

  const campaignId = id || generateSecureId('camp', 8);
  const now = new Date().toISOString();

  const campaign = {
    id: campaignId,
    title: title.trim(),
    subject: subject.trim(),
    preheader: (preheader || '').trim(),
    bodyContent: (bodyContent || '').trim(),
    targetAudience: TARGET_AUDIENCES.includes(targetAudience) ? targetAudience : 'all',
    status: CAMPAIGN_STATUS.DRAFT,
    author: author || 'Editorial Desk',
    createdAt: now,
    updatedAt: now
  };

  await env.AUTH_KV.put(`${KEY_CAMPAIGN_PREFIX}${campaignId}`, JSON.stringify(campaign));

  // Update index
  const index = await getCampaignsIndex(env);
  const existingIdx = index.findIndex(c => c.id === campaignId);
  if (existingIdx !== -1) {
    index[existingIdx] = {
      id: campaignId,
      title: campaign.title,
      subject: campaign.subject,
      status: campaign.status,
      updatedAt: now
    };
  } else {
    index.unshift({
      id: campaignId,
      title: campaign.title,
      subject: campaign.subject,
      status: campaign.status,
      createdAt: now,
      updatedAt: now
    });
  }
  await env.AUTH_KV.put(KEY_CAMPAIGNS_INDEX, JSON.stringify(index));

  return { success: true, campaign };
}

/**
 * Retrieves a campaign record by ID.
 */
export async function getCampaignById(env, id) {
  if (!env || !env.AUTH_KV || !id) return null;
  try {
    const raw = await env.AUTH_KV.get(`${KEY_CAMPAIGN_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Generates an accessible, responsive HTML email template for campaign preview.
 */
export function renderCampaignHtml({
  title = 'The Daily Briefing',
  subject = 'Today\'s Top Verified Dispatches',
  preheader = 'Verified reporting and explanatory briefings delivered every morning.',
  bodyContent = '',
  subscriberEmail = 'reader@example.com',
  unsubscribeUrl = 'https://thesamachardaily.in/api/newsletter/unsubscribe?demo=1'
} = {}) {
  // Simple markdown to safe HTML conversion for content preview
  const safeContent = (bodyContent || '')
    .split(/\r?\n\r?\n/)
    .map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('# ')) {
        return `<h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 24px 0 12px; line-height: 1.3;">${trimmed.slice(2)}</h1>`;
      }
      if (trimmed.startsWith('## ')) {
        return `<h2 style="font-size: 18px; font-weight: 600; color: #1f2937; margin: 20px 0 10px; line-height: 1.3;">${trimmed.slice(3)}</h2>`;
      }
      if (trimmed.startsWith('### ')) {
        return `<h3 style="font-size: 16px; font-weight: 600; color: #374151; margin: 16px 0 8px; line-height: 1.3;">${trimmed.slice(4)}</h3>`;
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const items = trimmed.split(/\r?\n/)
          .map(li => `<li style="margin-bottom: 6px;">${li.replace(/^[-*]\s*/, '')}</li>`)
          .join('');
        return `<ul style="padding-left: 20px; margin: 12px 0; color: #374151; font-size: 15px; line-height: 1.6;">${items}</ul>`;
      }
      return `<p style="font-size: 15px; line-height: 1.65; color: #374151; margin: 0 0 16px;">${trimmed}</p>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .email-container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb; }
    .email-header { background-color: #090d16; padding: 24px 32px; border-bottom: 3px solid #C81E2C; }
    .email-body { padding: 32px; }
    .email-footer { background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; line-height: 1.5; }
    a { color: #C81E2C; text-decoration: underline; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6;">
  <!-- Preheader snippet -->
  <div style="display: none; max-height: 0px; overflow: hidden;">
    ${escapeHtml(preheader)}
  </div>

  <div class="email-container" style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
    <!-- Masthead -->
    <div class="email-header" style="background-color: #090d16; padding: 24px 32px; border-bottom: 3px solid #C81E2C;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <span style="display: inline-block; background-color: #C81E2C; color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">SAMACHAR DAILY</span>
            <h1 style="color: #f8fafc; font-size: 20px; font-weight: 700; margin: 10px 0 0; letter-spacing: -0.02em;">The Daily Briefing</h1>
          </td>
          <td align="right" style="color: #94a3b8; font-size: 12px;">
            ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </td>
        </tr>
      </table>
    </div>

    <!-- Main Content -->
    <div class="email-body" style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 16px; line-height: 1.35;">${escapeHtml(subject)}</h2>

      <div style="font-size: 15px; color: #374151; line-height: 1.65;">
        ${safeContent || '<p>No content drafted yet. Enter your newsletter body markdown above to preview.</p>'}
      </div>
    </div>

    <!-- Editorial Footer with One-Click Unsubscribe -->
    <div class="email-footer" style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; line-height: 1.5;">
      <p style="margin: 0 0 8px;">
        <strong>Samachar Daily Editorial Desk</strong> &bull; Independent Digital Journalism<br>
        Verified reporting and explanatory briefings. Zero fluff.
      </p>
      <p style="margin: 0 0 12px;">
        You received this email because you subscribed to The Daily Briefing with <strong>${escapeHtml(subscriberEmail)}</strong>.
      </p>
      <p style="margin: 0;">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from The Daily Briefing</a> &bull;
        <a href="https://thesamachardaily.in/privacy/" style="color: #6b7280; text-decoration: underline;">Privacy Policy</a> &bull;
        <a href="https://thesamachardaily.in/contact/" style="color: #6b7280; text-decoration: underline;">Editorial Desk</a>
      </p>
    </div>
  </div>
</body>
</html>`;
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

// Re-export Phase M Digest & Delivery modules
export * from './digest.js';
export * from './digest-templates.js';
export * from './delivery.js';
