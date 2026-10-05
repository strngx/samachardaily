/**
 * Samachar Daily — Smart 404 Engine (Phase 12B)
 * Deterministic, Client-Side, Zero-AI 404 Recovery Controller.
 */

(function () {
  'use strict';

  // Common English stop words (reused from Phase 10 & 11)
  const STOPWORDS = new Set([
    'a', 'about', 'after', 'ahead', 'all', 'amid', 'an', 'and', 'are', 'as', 'at',
    'be', 'been', 'by', 'day', 'days', 'first', 'for', 'from', 'had', 'has', 'have',
    'he', 'how', 'in', 'into', 'is', 'it', 'its', 'latest', 'month', 'more', 'new',
    'news', 'of', 'on', 'or', 'over', 'report', 'reports', 'said', 'says', 'second',
    'that', 'the', 'third', 'this', 'to', 'today', 'was', 'week', 'weeks', 'were',
    'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'year', 'years'
  ]);

  // Meaningful short entities retained despite length <= 2
  const SHORT_ENTITIES = new Set([
    'ai', 'us', 'uk', 'eu', 'un', 'pm', 'cm', 'bjp', 'aap', 'rbi', 'ipo', 't20', 'odi'
  ]);

  // Structural path components and administrative probe tokens to filter out
  const STRUCTURAL_TOKENS = new Set([
    'articles', 'article', 'news', 'post', 'posts', 'story', 'stories', 'page', 'pages',
    'tag', 'tags', 'feed', 'feeds', 'category', 'categories', 'archives', 'archive', 'amp',
    'admin', 'login', 'signup', 'register', 'wp', 'wp-admin', 'wp-content', 'wp-includes',
    'xmlrpc', 'robots', 'sitemap', 'favicon', 'assets', 'css', 'js', 'api', 'auth',
    'null', 'undefined', 'true', 'false', 'index', 'default', 'home', 'www', 'com', 'in',
    'script', 'alert', 'onerror', 'onload', 'eval', 'document', 'window', 'etc', 'passwd'
  ]);

  // Category normalization mapping
  const CATEGORY_MAP = {
    'india': 'india', 'national': 'india', 'delhi': 'india', 'bharat': 'india',
    'world': 'world', 'international': 'world', 'global': 'world',
    'business': 'business', 'economy': 'business', 'markets': 'business', 'finance': 'business',
    'tech': 'tech', 'technology': 'tech', 'gadgets': 'tech',
    'sports': 'sports', 'sport': 'sports', 'cricket': 'sports', 'football': 'sports'
  };

  const CATEGORY_COLORS = {
    'india': '#C81E2C',
    'world': '#1E4FC8',
    'business': '#1E8A4C',
    'tech': '#6B3FA0',
    'sports': '#D9791E'
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegex(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isValidArticleUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Strictly relative internal URL matching /articles/<category>/<slug>/
    return /^\/articles\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/?$/.test(url);
  }

  function extractPathData(rawPath) {
    let cleanPath = '';
    try {
      cleanPath = decodeURIComponent(rawPath || '');
    } catch (_) {
      cleanPath = String(rawPath || '');
    }

    // Defensive length cap to prevent ReDoS / CPU attacks
    if (cleanPath.length > 200) {
      cleanPath = cleanPath.slice(0, 200);
    }

    cleanPath = cleanPath.toLowerCase().trim();
    // Strip common file extensions
    cleanPath = cleanPath.replace(/\.(html?|php|aspx?|md|json|txt)$/i, '');
    // Neutralize any non-alphanumeric punctuation to spaces (strips <, >, ", ', ;, &, etc.)
    cleanPath = cleanPath.replace(/[^a-z0-9\s/._-]/g, ' ');

    // Split on path and punctuation delimiters
    const rawParts = cleanPath.split(/[\s\/._-]+/).filter(Boolean);

    let detectedCategory = null;
    const tokens = [];

    for (const rawP of rawParts) {
      const p = rawP.replace(/[^a-z0-9]/g, '');
      if (!p) continue;

      if (CATEGORY_MAP[p]) {
        detectedCategory = CATEGORY_MAP[p];
      }

      if (STRUCTURAL_TOKENS.has(p) || STOPWORDS.has(p) || CATEGORY_MAP[p]) {
        continue;
      }

      if (p.length > 2 || SHORT_ENTITIES.has(p)) {
        tokens.push(p);
      }
    }

    const uniqueTokens = Array.from(new Set(tokens));
    return {
      rawTokens: rawParts,
      tokens: uniqueTokens,
      detectedCategory,
      cleanQuery: uniqueTokens.join(' ')
    };
  }

  function hasConsecutivePhrase(queryTokens, titleTokens) {
    if (!queryTokens || !titleTokens || queryTokens.length < 2 || titleTokens.length < 2) return false;
    const titleBigrams = new Set();
    for (let i = 0; i < titleTokens.length - 1; i++) {
      titleBigrams.add(titleTokens[i] + ' ' + titleTokens[i + 1]);
    }
    for (let i = 0; i < queryTokens.length - 1; i++) {
      if (titleBigrams.has(queryTokens[i] + ' ' + queryTokens[i + 1])) {
        return true;
      }
    }
    return false;
  }

  function jaccardSimilarity(setA, setB) {
    if (!setA || !setB || !setA.size || !setB.size) return 0;
    let intersection = 0;
    for (const t of setA) {
      if (setB.has(t)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function formatTimeAgo(isoDate) {
    if (!isoDate) return 'Recently';
    const date = new Date(isoDate);
    const now = Date.now();
    const diffMs = now - date.getTime();
    if (isNaN(diffMs) || diffMs < 0) return 'Recently';

    const diffMins = Math.floor(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    if (diffMins < 60) return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;

    try {
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return `${diffDays}d ago`;
    }
  }

  function scoreCandidate(item, tokens, detectedCategory, refTime) {
    const title = (item.t || '').toLowerCase();
    const dek = (item.d || '').toLowerCase();
    const slug = (item.s || '').toLowerCase();
    const cat = (item.c || '').toLowerCase();

    let score = 0;
    let matchedTokenCount = 0;

    const titleTokensArr = title.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean);
    const titleTokensSet = new Set(titleTokensArr);

    // Exact slug match (+50)
    const joinedQuerySlug = tokens.join('-');
    if (slug === joinedQuerySlug) {
      score += 50;
    }

    // Token scoring
    for (const t of tokens) {
      let matched = false;
      const wordRegex = new RegExp('\\b' + escapeRegex(t) + '\\b', 'i');

      if (wordRegex.test(title)) {
        score += 35; // Title whole-word match
        matched = true;
      } else if (t.length >= 4 && title.includes(t)) {
        score += 18; // Title substring match (>= 4 chars)
        matched = true;
      }

      if (slug.includes(t)) {
        score += 25; // Slug token match
        matched = true;
      }

      if (dek.includes(t)) {
        score += 10; // Dek match
        matched = true;
      }

      if (matched) {
        matchedTokenCount++;
      }
    }

    // Consecutive phrase match (+40)
    if (hasConsecutivePhrase(tokens, titleTokensArr)) {
      score += 40;
    }

    // Category match (+15)
    if (detectedCategory && cat === detectedCategory) {
      score += 15;
    }

    // Recency scoring
    const artTime = item.dt ? new Date(item.dt).getTime() : 0;
    const diffMs = refTime - artTime;
    if (diffMs <= 48 * 60 * 60 * 1000 && diffMs >= 0) {
      score += 10;
    } else if (diffMs <= 7 * 24 * 60 * 60 * 1000 && diffMs >= 0) {
      score += 5;
    }

    return { score, matchedTokenCount, titleTokensSet };
  }

  function findRecommendations(articles, pathData) {
    const { tokens, detectedCategory } = pathData;
    if (!tokens || tokens.length === 0) return [];

    // Pure category path check: if no non-category content tokens remain, show desk nav only
    const nonCatTokens = tokens.filter(t => !CATEGORY_MAP[t]);
    if (nonCatTokens.length === 0) return [];

    let refTime = Date.now();
    for (let i = 0; i < Math.min(50, articles.length); i++) {
      const t = articles[i].dt ? new Date(articles[i].dt).getTime() : 0;
      if (t > refTime) refTime = t;
    }

    const scoredList = [];

    for (let i = 0; i < articles.length; i++) {
      const item = articles[i];

      // Defensive URL and record validation
      if (!item || !item.t || !item.u || !isValidArticleUrl(item.u)) continue;

      const { score, matchedTokenCount, titleTokensSet } = scoreCandidate(item, tokens, detectedCategory, refTime);

      // Strict thresholds (anti-weak backfill)
      let passes = false;
      if (tokens.length === 1) {
        passes = matchedTokenCount >= 1 && score >= 40;
      } else {
        const matchRatio = matchedTokenCount / tokens.length;
        passes = matchRatio >= 0.40 && score >= 50;
      }

      if (passes) {
        scoredList.push({
          item,
          score,
          titleTokensSet,
          timestamp: item.dt ? new Date(item.dt).getTime() : 0
        });
      }
    }

    // Deterministic sorting: 1) score desc, 2) date desc, 3) slug asc
    scoredList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      const slugA = a.item.s || '';
      const slugB = b.item.s || '';
      return slugA.localeCompare(slugB);
    });

    // Deduplicate near-identical clusters (Title Jaccard > 0.70)
    const accepted = [];
    for (let i = 0; i < scoredList.length; i++) {
      if (accepted.length >= 4) break;
      const candidate = scoredList[i];
      let isNearDuplicate = false;

      for (let j = 0; j < accepted.length; j++) {
        if (jaccardSimilarity(candidate.titleTokensSet, accepted[j].titleTokensSet) > 0.70) {
          isNearDuplicate = true;
          break;
        }
      }

      if (!isNearDuplicate) {
        accepted.push(candidate);
      }
    }

    return accepted.map(entry => entry.item);
  }

  function renderCard(item) {
    const card = document.createElement('article');
    card.className = 'related-story-card';

    const catSlug = (item.c || 'india').toLowerCase();
    const catName = catSlug.charAt(0).toUpperCase() + catSlug.slice(1);
    const catColor = CATEGORY_COLORS[catSlug] || '#C81E2C';
    const safeUrl = escapeHtml(item.u);
    const safeTitle = escapeHtml(item.t);
    const safeDek = escapeHtml(item.d || '');
    const timeAgoStr = escapeHtml(formatTimeAgo(item.dt));

    let imageHtml = '';
    if (item.i && typeof item.i === 'string') {
      const safeImg = escapeHtml(item.i);
      imageHtml = `
        <a href="${safeUrl}" class="card-thumb" tabindex="-1" aria-hidden="true">
          <img src="${safeImg}" alt="${safeTitle}" loading="lazy" decoding="async" width="400" height="225">
        </a>
      `;
    }

    card.innerHTML = `
      ${imageHtml}
      <div>
        <span class="category-label" style="color: ${catColor}; border-color: ${catColor};">${escapeHtml(catName)}</span>
      </div>
      <h3 class="card-title">
        <a href="${safeUrl}">${safeTitle}</a>
      </h3>
      ${safeDek ? `<p class="card-snippet">${safeDek}</p>` : ''}
      <div class="meta-row" style="margin-top: auto; font-size: 0.75rem;">
        <span>${timeAgoStr}</span>
      </div>
    `;

    return card;
  }

  async function initSmart404() {
    const searchInput = document.getElementById('smart-404-input');
    const linkHintEl = document.getElementById('smart-404-link-hint');
    const recSection = document.getElementById('smart-404-section');
    const recGrid = document.getElementById('smart-404-grid');

    const pathData = extractPathData(window.location.pathname);

    // 1. Safe text prefill for search input if meaningful tokens exist
    if (searchInput && pathData.cleanQuery) {
      searchInput.value = pathData.cleanQuery;
    }

    // 2. Safe link echo hint using textContent
    if (linkHintEl && pathData.tokens.length > 0) {
      linkHintEl.textContent = 'Searched terms from requested link: ' + pathData.cleanQuery;
      linkHintEl.style.display = 'inline-block';
    }

    // 3. Conditional Fetch: If zero meaningful content tokens, abort network fetch
    const nonCatTokens = pathData.tokens.filter(t => !CATEGORY_MAP[t]);
    if (nonCatTokens.length === 0) {
      return;
    }

    // 4. Fetch search index
    let articles = null;
    try {
      const res = await fetch('/search-index.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      articles = await res.json();
    } catch (err) {
      // Graceful failure: leave static 404 experience intact
      return;
    }

    if (!Array.isArray(articles) || articles.length === 0) {
      return;
    }

    // 5. Compute deterministic recommendations
    const recommendations = findRecommendations(articles, pathData);

    // 6. Anti-backfill: If 0 recommendations meet strict threshold, keep section hidden
    if (recommendations.length === 0) {
      return;
    }

    // 7. Render recommendation cards
    if (recSection && recGrid) {
      recGrid.innerHTML = '';
      for (const item of recommendations) {
        recGrid.appendChild(renderCard(item));
      }
      recSection.style.display = 'block';
    }
  }

  // Global export for testability & execution
  const Smart404Engine = {
    STOPWORDS,
    SHORT_ENTITIES,
    STRUCTURAL_TOKENS,
    CATEGORY_MAP,
    CATEGORY_COLORS,
    escapeHtml,
    escapeRegex,
    isValidArticleUrl,
    extractPathData,
    hasConsecutivePhrase,
    jaccardSimilarity,
    formatTimeAgo,
    scoreCandidate,
    findRecommendations,
    initSmart404
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Smart404Engine;
  }
  if (typeof window !== 'undefined') {
    window.Smart404Engine = Smart404Engine;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initSmart404);
    } else {
      initSmart404();
    }
  }
})();
