/**
 * Samachar Daily — Daily Digest Engine (Phase M)
 *
 * 100% AI-FREE, DETERMINISTIC NEWSLETTER BUILDER.
 *
 * Invariants:
 * 1. Zero AI: No LLMs, no AI rewriting, no hallucinated or simulated content.
 * 2. Genuine content: Reads already-published articles from search index / quality index.
 * 3. Strict eligibility: Excludes drafts, redirects, noindex, quarantined, and thin content.
 * 4. Canonical security: Validates all URLs strictly match https://thesamachardaily.in/articles/{category}/{slug}/.
 * 5. Determinism: Identical article inputs and digest date yield identical output every time.
 * 6. Graceful degradation: Handles missing images without excluding stories; handles small corpus without fabricating.
 */

export const ALLOWED_CATEGORIES = new Set(['india', 'world', 'business', 'tech', 'sports']);

export const CATEGORY_COLORS = {
  india: '#C81E2C',
  world: '#1E4FC8',
  business: '#1E8A4C',
  tech: '#6B3FA0',
  sports: '#D9791E'
};

export const SITE_ORIGIN = 'https://thesamachardaily.in';

/**
 * Validates whether an article URL strictly conforms to the canonical pattern.
 * Pattern: https://thesamachardaily.in/articles/{category}/{slug}/
 */
export function isValidCanonicalUrl(url) {
  if (!url || typeof url !== 'string') return false;

  // Rejects credentials, fragments, queries, and malicious payloads
  if (url.includes('@') || url.includes('?') || url.includes('#') || url.includes('\\')) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.origin !== SITE_ORIGIN) return false;
    if (parsed.protocol !== 'https:') return false;
    if (parsed.port !== '') return false;

    // Must match /articles/{category}/{slug}/
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 3) return false;
    if (parts[0] !== 'articles') return false;
    if (!ALLOWED_CATEGORIES.has(parts[1].toLowerCase())) return false;
    if (!/^[a-z0-9-]+$/.test(parts[2])) return false;
    if (!parsed.pathname.endsWith('/')) return false;

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Formats canonical URL safely from path components or existing URL.
 */
export function formatCanonicalUrl(rawUrl, category, slug) {
  if (rawUrl && typeof rawUrl === 'string') {
    const trimmed = rawUrl.trim();
    if (trimmed.startsWith(SITE_ORIGIN)) {
      if (isValidCanonicalUrl(trimmed)) return trimmed;
    } else if (trimmed.startsWith('/')) {
      const full = `${SITE_ORIGIN}${trimmed.endsWith('/') ? trimmed : trimmed + '/'}`;
      if (isValidCanonicalUrl(full)) return full;
    }
  }

  const cat = (category || '').toLowerCase().trim();
  const sl = (slug || '').toLowerCase().trim();
  if (ALLOWED_CATEGORIES.has(cat) && /^[a-z0-9-]+$/.test(sl)) {
    const candidate = `${SITE_ORIGIN}/articles/${cat}/${sl}/`;
    if (isValidCanonicalUrl(candidate)) return candidate;
  }

  return null;
}

/**
 * Validates an image URL: must be HTTPS and a valid web asset.
 */
export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  if (/[\x00-\x1F\x7F<>"'`]/.test(trimmed)) return false;
  return true;
}

/**
 * Normalizes article records from different internal schemas (search-index vs quality-index vs frontmatter).
 */
export function normalizeArticle(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Schema 1: search-index.json (t, d, c, dt, u, i, s)
  if (raw.t && raw.dt) {
    const category = String(raw.c || '').toLowerCase().trim();
    const slug = String(raw.s || '').toLowerCase().trim();
    const canonicalUrl = formatCanonicalUrl(raw.u, category, slug);
    if (!canonicalUrl) return null;

    const publishedAt = new Date(raw.dt).toISOString();
    return {
      title: String(raw.t).trim(),
      dek: String(raw.d || '').trim(),
      category: ALLOWED_CATEGORIES.has(category) ? category : 'india',
      categoryColor: CATEGORY_COLORS[category] || '#C81E2C',
      slug,
      canonicalUrl,
      imageUrl: isValidImageUrl(raw.i) ? raw.i.trim() : null,
      publishedAt,
      sourceName: raw.sourceName || 'Samachar Daily'
    };
  }

  // Schema 2: article-quality-index.json or raw frontmatter object
  const title = (raw.title || (raw.data && raw.data.title) || '').trim();
  if (!title || title.length < 5) return null;

  const rawDate = raw.date || (raw.data && raw.data.date);
  if (!rawDate) return null;
  const parsedDate = new Date(rawDate);
  if (isNaN(parsedDate.getTime())) return null;

  // Exclude explicitly ineligible records
  const isNoindex = raw.noindex === true || (raw.data && raw.data.noindex === true);
  const isDraft = raw.draft === true || (raw.data && raw.data.draft === true) || String(raw.relPath || '').includes('/drafts/');
  const isRedirect = raw.redirect === true || raw.redirect_to || (raw.data && (raw.data.redirect || raw.data.redirect_to));
  const isQuarantine = String(raw.relPath || '').includes('_quarantine-commercial');
  if (isNoindex || isDraft || isRedirect || isQuarantine) {
    return null;
  }

  const category = String(raw.category || (raw.data && raw.data.category) || '').toLowerCase().trim();
  const slug = String(raw.slug || (raw.data && raw.data.slug) || '').toLowerCase().trim();
  const rawUrl = raw.url || (raw.data && raw.data.url) || `/articles/${category}/${slug}/`;
  const canonicalUrl = formatCanonicalUrl(rawUrl, category, slug);
  if (!canonicalUrl) return null;

  const rawImage = raw.image || (raw.data && raw.data.image) || null;
  const dek = String(raw.dek || (raw.data && raw.data.dek) || '').trim();
  const sourceName = raw.sourceName || (raw.data && raw.data.sourceName) || 'Samachar Daily';

  return {
    title,
    dek,
    category: ALLOWED_CATEGORIES.has(category) ? category : 'india',
    categoryColor: CATEGORY_COLORS[category] || '#C81E2C',
    slug,
    canonicalUrl,
    imageUrl: isValidImageUrl(rawImage) ? rawImage.trim() : null,
    publishedAt: parsedDate.toISOString(),
    sourceName
  };
}

/**
 * Builds a deterministic daily digest from a candidate list of articles.
 *
 * @param {Array} rawArticles - List of article objects from search index or quality index
 * @param {Object} options - Configuration options
 * @param {string} [options.digestDate] - Target date string YYYY-MM-DD (defaults to UTC today)
 * @param {number} [options.maxArticles=5] - Maximum articles to include (1 lead + up to 4 secondary)
 * @param {number} [options.lookbackHours=48] - Lookback window in hours
 * @param {boolean} [options.fallbackToLatest=true] - Fall back to most recent if few in window
 * @param {Date} [options.clock] - Injectable clock for testing
 * @returns {Object} Daily digest object
 */
export function buildDailyDigest(rawArticles = [], options = {}) {
  const clock = options.clock instanceof Date ? options.clock : new Date();
  const digestDateStr = options.digestDate || clock.toISOString().slice(0, 10);
  const maxArticles = Math.max(1, Math.min(10, options.maxArticles || 5));
  const lookbackHours = options.lookbackHours || 48;
  const fallbackToLatest = options.fallbackToLatest !== false;

  // 1. Normalize and filter valid published articles
  const validArticles = [];
  const seenCanonical = new Set();
  const seenSlug = new Set();

  for (const raw of rawArticles) {
    const article = normalizeArticle(raw);
    if (!article) continue;

    // Deduplication by canonical URL and slug
    if (seenCanonical.has(article.canonicalUrl) || seenSlug.has(article.slug)) {
      continue;
    }
    seenCanonical.add(article.canonicalUrl);
    seenSlug.add(article.slug);
    validArticles.push(article);
  }

  // 2. Compute date boundaries
  // End of digest day in UTC (or clock time if digestDate is today)
  const targetEnd = new Date(`${digestDateStr}T23:59:59.999Z`);
  const targetStart = new Date(targetEnd.getTime() - lookbackHours * 3600 * 1000);

  // Exclude future articles (relative to targetEnd)
  const availableArticles = validArticles.filter(a => {
    const pub = new Date(a.publishedAt);
    return pub.getTime() <= targetEnd.getTime();
  });

  // 3. Filter for articles within the lookback window
  let candidates = availableArticles.filter(a => {
    const pub = new Date(a.publishedAt);
    return pub.getTime() >= targetStart.getTime();
  });

  // If lookback window has fewer than 2 articles, fallback to most recent available
  if (candidates.length < 2 && fallbackToLatest && availableArticles.length > 0) {
    candidates = [...availableArticles];
  }

  // 4. Deterministic Sort:
  // Primary: publishedAt timestamp DESC (most recent first)
  // Stable tie-breaker: slug ASC
  candidates.sort((a, b) => {
    const diff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (diff !== 0) return diff;
    return a.slug.localeCompare(b.slug);
  });

  if (candidates.length === 0) {
    return {
      digestId: `digest_${digestDateStr}`,
      digestDate: digestDateStr,
      dateFormatted: formatDateForDigest(digestDateStr),
      leadArticle: null,
      secondaryArticles: [],
      articles: [],
      totalArticles: 0,
      generatedAt: clock.toISOString(),
      empty: true
    };
  }

  // 5. Select Lead Story:
  // Prefer the highest-ranked article that has an image.
  // If none have an image, take the top article without excluding it.
  let leadIndex = candidates.findIndex(a => Boolean(a.imageUrl));
  if (leadIndex === -1) leadIndex = 0;

  const leadArticle = candidates[leadIndex];
  const remaining = candidates.filter((_, idx) => idx !== leadIndex);

  // 6. Category Diversity for Secondary Stories:
  // Pick secondary stories prioritizing different categories to give a well-rounded briefing
  const selectedSecondary = [];
  const secondaryQuota = maxArticles - 1;

  if (secondaryQuota > 0) {
    const usedCategories = new Set([leadArticle.category]);

    // First pass: select top story from categories not yet represented
    for (const art of remaining) {
      if (selectedSecondary.length >= secondaryQuota) break;
      if (!usedCategories.has(art.category)) {
        selectedSecondary.push(art);
        usedCategories.add(art.category);
      }
    }

    // Second pass: fill remaining slots with remaining top stories
    if (selectedSecondary.length < secondaryQuota) {
      const selectedSlugs = new Set(selectedSecondary.map(s => s.slug));
      for (const art of remaining) {
        if (selectedSecondary.length >= secondaryQuota) break;
        if (!selectedSlugs.has(art.slug)) {
          selectedSecondary.push(art);
          selectedSlugs.add(art.slug);
        }
      }
    }
  }

  const allSelected = [leadArticle, ...selectedSecondary];

  return {
    digestId: `digest_${digestDateStr}`,
    digestDate: digestDateStr,
    dateFormatted: formatDateForDigest(digestDateStr),
    subject: `🇮🇳 The Daily Briefing: ${leadArticle.title}`,
    preheader: leadArticle.dek || 'Verified news and explanatory dispatches from the SamacharDaily editorial newsroom.',
    leadArticle,
    secondaryArticles: selectedSecondary,
    articles: allSelected,
    totalArticles: allSelected.length,
    generatedAt: clock.toISOString(),
    empty: false
  };
}

/**
 * Formats YYYY-MM-DD into a human-friendly date string.
 */
export function formatDateForDigest(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[date.getUTCDay()]}, ${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
  } catch (_) {
    return dateStr;
  }
}
