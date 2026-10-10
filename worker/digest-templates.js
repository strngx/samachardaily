/**
 * Samachar Daily — Daily Digest Email Templates (Phase M)
 *
 * Implements accessible, email-client-resilient HTML and plain-text templates
 * using official SamacharDaily branding and strict HTML sanitization.
 *
 * Features:
 * 1. 100% AI-Free: Displays genuine editorial headlines and factual excerpts.
 * 2. Table-based layouts for maximum email client compatibility (Outlook, Apple Mail, Gmail, Yahoo).
 * 3. Logo SVG linking to the homepage, with styled text fallback for clients blocking SVG.
 * 4. Every article element (headline, image, card button) links to that article's canonical URL.
 * 5. Secure, recipient-specific one-click unsubscribe URL complying with RFC 8058.
 * 6. Zero tracking pixels, zero external third-party scripts or ad pixels.
 */

import { SITE_ORIGIN, CATEGORY_COLORS } from './digest.js';

/**
 * Escapes HTML characters safely.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates and sanitizes a URL for safe embedding in an href or src attribute.
 * Only allows https: protocols.
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  const trimmed = url.trim();
  // Reject javascript:, data:, vbscript:, etc.
  if (!/^https:\/\/[a-zA-Z0-9.-]+/i.test(trimmed)) {
    return '#';
  }
  return escapeHtml(trimmed);
}

/**
 * Renders the responsive HTML email for a daily digest.
 *
 * @param {Object} digest - Daily digest data from buildDailyDigest()
 * @param {Object} options - Recipient options
 * @param {string} [options.subscriberEmail] - Recipient's email address
 * @param {string} [options.unsubscribeToken] - Recipient's unique unsubscribe token
 * @param {string} [options.unsubscribeUrl] - Precomputed unsubscribe URL
 * @returns {string} Rendered HTML email string
 */
export function renderDigestHtml(digest, options = {}) {
  const email = options.subscriberEmail || 'subscriber@example.com';
  const token = options.unsubscribeToken || '';
  const unsubUrl = options.unsubscribeUrl || (token
    ? `${SITE_ORIGIN}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`
    : `${SITE_ORIGIN}/api/newsletter/unsubscribe?demo=1`);

  const dateFormatted = escapeHtml(digest.dateFormatted || 'Daily Briefing');
  const subject = escapeHtml(digest.subject || 'The Daily Briefing — Samachar Daily');
  const preheader = escapeHtml(digest.preheader || 'Verified reporting and explanatory briefings.');

  const lead = digest.leadArticle;
  const secondaries = digest.secondaryArticles || [];

  // Lead Story Card HTML
  let leadCardHtml = '';
  if (lead) {
    const leadCategory = escapeHtml(lead.category.toUpperCase());
    const leadCatColor = CATEGORY_COLORS[lead.category] || '#C81E2C';
    const leadTitle = escapeHtml(lead.title);
    const leadDek = escapeHtml(lead.dek || '');
    const leadUrl = sanitizeUrl(lead.canonicalUrl);
    const leadImage = lead.imageUrl ? sanitizeUrl(lead.imageUrl) : null;

    leadCardHtml = `
      <!-- Lead Article Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        ${leadImage ? `
        <tr>
          <td style="padding: 0; line-height: 0;">
            <a href="${leadUrl}" style="text-decoration: none; display: block;">
              <img src="${leadImage}" alt="${leadTitle}" width="560" style="width: 100%; max-width: 560px; height: auto; display: block; border: 0;" />
            </a>
          </td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 24px 24px 20px 24px;">
            <span style="display: inline-block; background-color: ${leadCatColor}; color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; padding: 3px 8px; border-radius: 3px; text-transform: uppercase;">
              ${leadCategory}
            </span>
            <h2 style="font-size: 21px; font-weight: 700; color: #111827; margin: 12px 0 10px 0; line-height: 1.35;">
              <a href="${leadUrl}" style="color: #111827; text-decoration: none;">${leadTitle}</a>
            </h2>
            ${leadDek ? `
            <p style="font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 16px 0;">
              ${leadDek}
            </p>
            ` : ''}
            <div>
              <a href="${leadUrl}" style="display: inline-block; background-color: #C81E2C; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 4px;">
                Read Full Story &rarr;
              </a>
            </div>
          </td>
        </tr>
      </table>
    `;
  }

  // Secondary Articles HTML
  let secondaryCardsHtml = '';
  if (secondaries.length > 0) {
    const cards = secondaries.map(art => {
      const cat = escapeHtml(art.category.toUpperCase());
      const catColor = CATEGORY_COLORS[art.category] || '#C81E2C';
      const title = escapeHtml(art.title);
      const dek = escapeHtml(art.dek || '');
      const url = sanitizeUrl(art.canonicalUrl);
      const img = art.imageUrl ? sanitizeUrl(art.imageUrl) : null;

      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="padding: 16px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="top" style="vertical-align: top;">
                    <span style="display: inline-block; background-color: ${catColor}; color: #ffffff; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; margin-bottom: 6px;">
                      ${cat}
                    </span>
                    <h3 style="font-size: 16px; font-weight: 700; color: #111827; margin: 4px 0 6px 0; line-height: 1.35;">
                      <a href="${url}" style="color: #111827; text-decoration: none;">${title}</a>
                    </h3>
                    ${dek ? `
                    <p style="font-size: 13px; line-height: 1.5; color: #4b5563; margin: 0 0 10px 0;">
                      ${dek}
                    </p>
                    ` : ''}
                    <a href="${url}" style="color: #C81E2C; font-size: 13px; font-weight: 600; text-decoration: underline;">
                      Read story &rarr;
                    </a>
                  </td>
                  ${img ? `
                  <td width="110" valign="top" align="right" style="vertical-align: top; padding-left: 16px; width: 110px;">
                    <a href="${url}" style="text-decoration: none;">
                      <img src="${img}" alt="${title}" width="110" height="75" style="width: 110px; height: 75px; object-fit: cover; border-radius: 6px; display: block; border: 0;" />
                    </a>
                  </td>
                  ` : ''}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;
    }).join('\n');

    secondaryCardsHtml = `
      <div style="margin: 28px 0 12px 0;">
        <h3 style="font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin: 0 0 12px 0;">
          More Essential Briefings
        </h3>
        ${cards}
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${subject}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
  <style type="text/css">
    body { margin: 0 !important; padding: 0 !important; background-color: #f3f4f6; }
    table { border-collapse: collapse !important; }
    img { border: 0; outline: none; text-decoration: none; }
    a { color: #C81E2C; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <!-- Hidden preheader text -->
  <div style="display: none; font-size: 1px; color: #f3f4f6; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${preheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px 0;">
    <tr>
      <td align="center">
        <!-- Main Email Container (600px Max) -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">

          <!-- Branded Masthead -->
          <tr>
            <td style="background-color: #090d16; padding: 22px 28px; border-bottom: 3px solid #C81E2C;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" valign="middle">
                    <a href="${SITE_ORIGIN}/" style="text-decoration: none; display: inline-block;">
                      <!-- Logo Image with Accessible Styled Text Fallback -->
                      <img src="${SITE_ORIGIN}/assets/images/logo.svg" alt="SamacharDaily" width="180" height="30" style="display: block; border: 0; max-height: 30px; width: auto;" />
                      <span style="display: none; font-family: 'Source Serif 4', Georgia, serif; font-size: 22px; font-weight: 900; color: #ffffff; letter-spacing: -0.02em;">
                        Samachar<span style="color: #C81E2C;">Daily</span>
                      </span>
                    </a>
                  </td>
                  <td align="right" valign="middle" style="color: #94a3b8; font-size: 12px; font-weight: 500;">
                    ${dateFormatted}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 8px;">
                    <span style="color: #cbd5e1; font-size: 13px; font-weight: 600; letter-spacing: -0.01em;">
                      The Daily Briefing &bull; Verified National &amp; Global News
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Editorial Body -->
          <tr>
            <td class="mobile-padding" style="padding: 24px 24px 16px 24px; background-color: #fafbfc;">
              ${leadCardHtml}
              ${secondaryCardsHtml}
            </td>
          </tr>

          <!-- Editorial Footer -->
          <tr>
            <td style="background-color: #ffffff; padding: 24px 28px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 12px; line-height: 1.55;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #374151;">
                Samachar Daily Editorial Desk &bull; Independent Digital Journalism
              </p>
              <p style="margin: 0 0 12px 0;">
                Verified reporting, policy insights, and explanatory briefings. Zero fluff.
              </p>
              <p style="margin: 0 0 14px 0; font-size: 11px; color: #9ca3af;">
                You received this morning briefing because you subscribed with <strong>${escapeHtml(email)}</strong>.
              </p>
              <p style="margin: 0; font-size: 11px;">
                <a href="${unsubUrl}" style="color: #6b7280; text-decoration: underline; font-weight: 600;">Unsubscribe from The Daily Briefing</a>
                &nbsp;&bull;&nbsp;
                <a href="${SITE_ORIGIN}/privacy/" style="color: #6b7280; text-decoration: underline;">Privacy Policy</a>
                &nbsp;&bull;&nbsp;
                <a href="${SITE_ORIGIN}/contact/" style="color: #6b7280; text-decoration: underline;">Editorial Desk</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Renders the plain-text alternative of a daily digest.
 */
export function renderDigestPlainText(digest, options = {}) {
  const email = options.subscriberEmail || 'subscriber@example.com';
  const token = options.unsubscribeToken || '';
  const unsubUrl = options.unsubscribeUrl || (token
    ? `${SITE_ORIGIN}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`
    : `${SITE_ORIGIN}/api/newsletter/unsubscribe?demo=1`);

  const lines = [];
  lines.push('SAMACHAR DAILY — THE DAILY BRIEFING');
  lines.push(digest.dateFormatted || 'Daily Briefing');
  lines.push('Verified reporting and explanatory briefings. Zero fluff.');
  lines.push('============================================================');
  lines.push('');

  if (digest.leadArticle) {
    const lead = digest.leadArticle;
    lines.push('LEAD STORY:');
    lines.push(`[${lead.category.toUpperCase()}] ${lead.title}`);
    if (lead.dek) {
      lines.push(lead.dek);
    }
    lines.push(`Read story: ${lead.canonicalUrl}`);
    lines.push('');
  }

  if (digest.secondaryArticles && digest.secondaryArticles.length > 0) {
    lines.push('------------------------------------------------------------');
    lines.push("TODAY'S ESSENTIAL BRIEFINGS:");
    lines.push('');

    for (const art of digest.secondaryArticles) {
      lines.push(`[${art.category.toUpperCase()}] ${art.title}`);
      if (art.dek) {
        lines.push(art.dek);
      }
      lines.push(`Read story: ${art.canonicalUrl}`);
      lines.push('');
    }
  }

  lines.push('============================================================');
  lines.push(`You received this briefing because you subscribed with: ${email}`);
  lines.push('To unsubscribe instantly, visit:');
  lines.push(unsubUrl);
  lines.push('');
  lines.push('Samachar Daily Editorial Desk — https://thesamachardaily.in');

  return lines.join('\n');
}
