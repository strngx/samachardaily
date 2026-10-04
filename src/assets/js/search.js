/**
 * Samachar Daily — Smart Website Search Engine (Phase 10)
 * Deterministic, Client-Side, Zero-AI Search Controller.
 */

(function () {
  'use strict';

  // Common English stop words
  const STOPWORDS = new Set([
    'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for',
    'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
    'that', 'the', 'to', 'was', 'were', 'will', 'with'
  ]);

  const CATEGORY_COLORS = {
    'india': '#C81E2C',
    'world': '#1E4FC8',
    'business': '#1E8A4C',
    'tech': '#6B3FA0',
    'sports': '#D9791E'
  };

  const PAGE_SIZE = 20;

  function escapeRegex(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  function tokenize(str) {
    if (!str || typeof str !== 'string') return [];
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function uniqueTokens(tokens) {
    return Array.from(new Set(tokens));
  }

  function safeHighlight(text, queryTokens) {
    if (!text) return '';
    if (!queryTokens || queryTokens.length === 0) return escapeHtml(text);

    let highlightTokens = queryTokens.filter(t => !STOPWORDS.has(t) && t.length >= 2);
    if (highlightTokens.length === 0) {
      highlightTokens = queryTokens.filter(t => t.length >= 1);
    }
    if (highlightTokens.length === 0) return escapeHtml(text);

    highlightTokens.sort((a, b) => b.length - a.length);
    const patternStr = highlightTokens.map(escapeRegex).filter(Boolean).join('|');
    if (!patternStr) return escapeHtml(text);

    const regex = new RegExp(patternStr, 'gi');
    let match;
    const intervals = [];

    while ((match = regex.exec(text)) !== null) {
      intervals.push([match.index, match.index + match[0].length]);
    }

    if (intervals.length === 0) return escapeHtml(text);

    // Merge overlapping intervals
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = intervals[i];
      if (curr[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }

    let result = '';
    let lastIdx = 0;
    for (const [start, end] of merged) {
      if (start > lastIdx) {
        result += escapeHtml(text.slice(lastIdx, start));
      }
      result += '<mark class="search-highlight">' + escapeHtml(text.slice(start, end)) + '</mark>';
      lastIdx = end;
    }
    if (lastIdx < text.length) {
      result += escapeHtml(text.slice(lastIdx));
    }

    return result;
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

  function scoreArticle(item, rawQuery, tokens, refTime) {
    const q = rawQuery.toLowerCase().trim();
    const title = (item.t || '').toLowerCase();
    const dek = (item.d || '').toLowerCase();
    const cat = (item.c || '').toLowerCase();
    const slug = (item.s || '').toLowerCase();

    let score = 0;
    let matchedTokenCount = 0;

    // 1. Exact Title Match (+150)
    if (title === q) {
      score += 150;
    }

    // 2. Title Phrase Match (+80)
    if (q.length > 2 && title.includes(q)) {
      score += 80;
    }

    // 3. Title Prefix Match (+50)
    if (title.startsWith(q)) {
      score += 50;
    }

    // 4. Token Matching
    for (const t of tokens) {
      let tokenMatched = false;
      const tWordRegex = new RegExp('\\b' + escapeRegex(t) + '\\b', 'i');

      if (tWordRegex.test(item.t)) {
        score += 30; // Whole-word title token
        tokenMatched = true;
      } else if (title.includes(t)) {
        score += 15; // Title substring
        tokenMatched = true;
      }

      if (dek.includes(t)) {
        score += 10; // Dek token
        tokenMatched = true;
      }

      if (cat.includes(t)) {
        score += 12; // Category match
        tokenMatched = true;
      }

      if (slug.includes(t)) {
        score += 8; // Slug token
        tokenMatched = true;
      }

      if (tokenMatched) {
        matchedTokenCount++;
      }
    }

    // 5. Recency Scoring
    const artTime = item.dt ? new Date(item.dt).getTime() : 0;
    const diffMs = refTime - artTime;
    if (diffMs <= 48 * 60 * 60 * 1000 && diffMs >= 0) {
      score += 15; // Last 48 hours
    } else if (diffMs <= 7 * 24 * 60 * 60 * 1000 && diffMs >= 0) {
      score += 10; // Last 7 days
    } else if (diffMs <= 30 * 24 * 60 * 60 * 1000 && diffMs >= 0) {
      score += 5; // Last 30 days
    }

    return { score, matchedTokenCount };
  }

  function filterAndRank(articles, options) {
    const rawQuery = (options.query || '').trim();
    const desk = (options.desk || 'all').toLowerCase().trim();
    const dateFilter = (options.date || 'any').toLowerCase().trim();
    const sortBy = (options.sort || 'relevance').toLowerCase().trim();

    if (!Array.isArray(articles) || articles.length === 0) {
      return [];
    }

    let refTime = Date.now();
    for (let i = 0; i < Math.min(50, articles.length); i++) {
      const t = articles[i].dt ? new Date(articles[i].dt).getTime() : 0;
      if (t > refTime) refTime = t;
    }

    const allTokens = uniqueTokens(tokenize(rawQuery));
    const nonStopTokens = allTokens.filter(t => !STOPWORDS.has(t));
    const meaningfulTokens = nonStopTokens.length > 0 ? nonStopTokens : allTokens;

    // Filter by Desk and Date first
    const candidates = articles.filter(item => {
      // Desk Filter
      if (desk !== 'all') {
        const itemCat = (item.c || '').toLowerCase().trim();
        if (itemCat !== desk) return false;
      }

      // Date Filter
      if (dateFilter !== 'any') {
        const artTime = item.dt ? new Date(item.dt).getTime() : 0;
        if (!artTime) return false;
        const diffMs = refTime - artTime;

        if (dateFilter === '24h') {
          if (diffMs > 24 * 60 * 60 * 1000 || diffMs < 0) return false;
        } else if (dateFilter === '7d') {
          if (diffMs > 7 * 24 * 60 * 60 * 1000 || diffMs < 0) return false;
        } else if (dateFilter === '30d') {
          if (diffMs > 30 * 24 * 60 * 60 * 1000 || diffMs < 0) return false;
        } else if (dateFilter === 'year') {
          const artYear = new Date(artTime).getFullYear();
          const refYear = new Date(refTime).getFullYear();
          if (artYear !== refYear) return false;
        }
      }

      return true;
    });

    // If query is empty, return filtered candidates sorted as requested
    if (!rawQuery) {
      const emptyMatches = candidates.map(item => ({
        item,
        score: 0,
        timestamp: item.dt ? new Date(item.dt).getTime() : 0
      }));

      if (sortBy === 'oldest') {
        emptyMatches.sort((a, b) => (a.timestamp - b.timestamp) || a.item.s.localeCompare(b.item.s));
      } else {
        emptyMatches.sort((a, b) => (b.timestamp - a.timestamp) || a.item.s.localeCompare(b.item.s));
      }

      return emptyMatches.map(m => m.item);
    }

    const scoredMatches = [];

    for (const item of candidates) {
      const { score, matchedTokenCount } = scoreArticle(item, rawQuery, meaningfulTokens, refTime);

      let passesThreshold = false;

      if (meaningfulTokens.length === 1) {
        passesThreshold = matchedTokenCount >= 1;
      } else if (meaningfulTokens.length > 1) {
        const matchRatio = matchedTokenCount / meaningfulTokens.length;
        passesThreshold = matchRatio >= 0.6;
      }

      if (passesThreshold && score > 0) {
        scoredMatches.push({
          item,
          score,
          timestamp: item.dt ? new Date(item.dt).getTime() : 0
        });
      }
    }

    // Deterministic Sorting & Tie-Breaking
    scoredMatches.sort((a, b) => {
      if (sortBy === 'newest') {
        if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
        if (a.score !== b.score) return b.score - a.score;
        return a.item.s.localeCompare(b.item.s);
      } else if (sortBy === 'oldest') {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        if (a.score !== b.score) return b.score - a.score;
        return a.item.s.localeCompare(b.item.s);
      } else {
        // Default: 'relevance'
        if (a.score !== b.score) return b.score - a.score;
        if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
        return a.item.s.localeCompare(b.item.s);
      }
    });

    return scoredMatches.map(m => m.item);
  }

  function renderCard(item, queryTokens) {
    const card = document.createElement('article');
    card.className = 'editorial-card search-result-card';

    const catSlug = (item.c || 'india').toLowerCase();
    const catName = catSlug.charAt(0).toUpperCase() + catSlug.slice(1);
    const catColor = CATEGORY_COLORS[catSlug] || '#C81E2C';

    const safeTitleHtml = safeHighlight(item.t, queryTokens);
    const safeDekHtml = safeHighlight(item.d, queryTokens);
    const timeAgoStr = formatTimeAgo(item.dt);

    let imageHtml = '';
    if (item.i && typeof item.i === 'string') {
      const safeImg = escapeHtml(item.i);
      const safeTitleAttr = escapeHtml(item.t);
      imageHtml = `
        <a href="${escapeHtml(item.u)}" class="card-thumb" tabindex="-1" aria-hidden="true">
          <img src="${safeImg}" alt="${safeTitleAttr}" loading="lazy" decoding="async" width="400" height="225">
        </a>
      `;
    }

    card.innerHTML = `
      ${imageHtml}
      <div>
        <span class="category-label" style="color: ${catColor}; border-color: ${catColor};">${escapeHtml(catName)}</span>
      </div>
      <h3 class="card-title">
        <a href="${escapeHtml(item.u)}">${safeTitleHtml}</a>
      </h3>
      <p class="card-snippet">${safeDekHtml}</p>
      <div class="meta-row" style="margin-top: auto; font-size: 0.75rem;">
        <span>${escapeHtml(timeAgoStr)}</span>
      </div>
    `;

    return card;
  }

  // Client Controller for /search/ Page
  function initSearchPage() {
    const form = document.getElementById('main-search-form');
    const input = document.getElementById('page-search-input');
    const resultsContainer = document.getElementById('search-results');
    const resultsMeta = document.getElementById('search-results-meta');
    const emptyState = document.getElementById('search-empty-state');
    const paginationContainer = document.getElementById('search-pagination');
    const loadMoreBtn = document.getElementById('search-load-more');
    const deskPills = document.querySelectorAll('.desk-pill');
    const dateSelect = document.getElementById('search-date-filter');
    const sortSelect = document.getElementById('search-sort-filter');
    const resetBtn = document.getElementById('search-reset-filters');

    if (!form || !input || !resultsContainer) return;

    let articlesIndex = window.__SAMACHAR_SEARCH_INDEX__ || null;
    let isLoadingIndex = false;
    let currentResults = [];
    let displayedCount = 0;
    let debounceTimer = null;

    const state = {
      query: '',
      desk: 'all',
      date: 'any',
      sort: 'relevance'
    };

    function readUrlParams() {
      const params = new URLSearchParams(window.location.search);
      state.query = (params.get('q') || '').slice(0, 200);
      state.desk = (params.get('desk') || 'all').toLowerCase();
      state.date = (params.get('date') || 'any').toLowerCase();
      state.sort = (params.get('sort') || 'relevance').toLowerCase();

      input.value = state.query;
      if (dateSelect) dateSelect.value = state.date;
      if (sortSelect) sortSelect.value = state.sort;

      deskPills.forEach(pill => {
        const pillDesk = pill.getAttribute('data-desk') || 'all';
        if (pillDesk === state.desk) {
          pill.classList.add('is-active');
          pill.setAttribute('aria-pressed', 'true');
        } else {
          pill.classList.remove('is-active');
          pill.setAttribute('aria-pressed', 'false');
        }
      });
    }

    function syncUrl() {
      const params = new URLSearchParams();
      if (state.query) params.set('q', state.query);
      if (state.desk && state.desk !== 'all') params.set('desk', state.desk);
      if (state.date && state.date !== 'any') params.set('date', state.date);
      if (state.sort && state.sort !== 'relevance') params.set('sort', state.sort);

      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? '?' + qs : '');
      window.history.replaceState(null, '', newUrl);
    }

    async function loadIndex() {
      if (articlesIndex) return articlesIndex;
      if (window.__SEARCH_INDEX_PROMISE__) {
        articlesIndex = await window.__SEARCH_INDEX_PROMISE__;
        return articlesIndex;
      }

      isLoadingIndex = true;
      try {
        const res = await fetch('/search-index.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        articlesIndex = await res.json();
        window.__SAMACHAR_SEARCH_INDEX__ = articlesIndex;
      } catch (err) {
        console.error('Failed to load search index:', err);
        articlesIndex = [];
      } finally {
        isLoadingIndex = false;
      }
      return articlesIndex;
    }

    function renderBatch() {
      const tokens = tokenize(state.query);
      const nextBatch = currentResults.slice(displayedCount, displayedCount + PAGE_SIZE);

      nextBatch.forEach(item => {
        const card = renderCard(item, tokens);
        resultsContainer.appendChild(card);
      });

      displayedCount += nextBatch.length;

      if (paginationContainer && loadMoreBtn) {
        if (displayedCount < currentResults.length) {
          const remaining = currentResults.length - displayedCount;
          loadMoreBtn.textContent = `Load More Stories (${remaining} remaining)`;
          paginationContainer.style.display = 'block';
        } else {
          paginationContainer.style.display = 'none';
        }
      }
    }

    async function runSearch() {
      const query = input.value.trim().slice(0, 200);
      state.query = query;
      syncUrl();

      const articles = await loadIndex();

      if (!articles || articles.length === 0) {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
        if (resultsMeta) resultsMeta.style.display = 'none';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (emptyState) {
          emptyState.style.display = 'block';
          emptyState.innerHTML = '<p>Unable to load search index. Please check your connection and refresh.</p>';
        }
        return;
      }

      if (!state.query && state.desk === 'all' && state.date === 'any') {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
        if (resultsMeta) resultsMeta.style.display = 'none';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (emptyState) {
          emptyState.style.display = 'block';
          emptyState.innerHTML = `
            <p>Enter keywords above to find verified reporting across our categories.</p>
            <div class="search-category-hints">
              <span>Quick browse:</span>
              <a href="/india/">India</a> &bull;
              <a href="/world/">World</a> &bull;
              <a href="/business/">Business</a> &bull;
              <a href="/tech/">Tech</a> &bull;
              <a href="/sports/">Sports</a>
            </div>
          `;
        }
        return;
      }

      currentResults = filterAndRank(articles, state);
      displayedCount = 0;
      resultsContainer.innerHTML = '';

      if (currentResults.length === 0) {
        resultsContainer.style.display = 'none';
        if (resultsMeta) resultsMeta.style.display = 'none';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (emptyState) {
          emptyState.style.display = 'block';
          const safeQ = escapeHtml(state.query);
          emptyState.innerHTML = `
            <p>No verified stories found matching <strong>"${safeQ}"</strong>.</p>
            <p style="margin-top: 8px; font-size: 0.9375rem;">Try broader keywords, clearing active filters, or exploring our primary desks:</p>
            <div class="search-category-hints">
              <a href="/india/">India</a> &bull;
              <a href="/world/">World</a> &bull;
              <a href="/business/">Business</a> &bull;
              <a href="/tech/">Tech</a> &bull;
              <a href="/sports/">Sports</a>
            </div>
          `;
        }
        return;
      }

      if (emptyState) emptyState.style.display = 'none';
      resultsContainer.style.display = 'grid';

      if (resultsMeta) {
        resultsMeta.style.display = 'block';
        const countText = currentResults.length === 1 ? '1 verified story' : `${currentResults.length} verified stories`;
        if (state.query) {
          resultsMeta.innerHTML = `Showing ${countText} for <strong>&ldquo;${escapeHtml(state.query)}&rdquo;</strong>`;
        } else {
          resultsMeta.innerHTML = `Showing ${countText}`;
        }
      }

      renderBatch();
    }

    // Event Handlers
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 150);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(debounceTimer);
      runSearch();
    });

    deskPills.forEach(pill => {
      pill.addEventListener('click', () => {
        deskPills.forEach(p => {
          p.classList.remove('is-active');
          p.setAttribute('aria-pressed', 'false');
        });
        pill.classList.add('is-active');
        pill.setAttribute('aria-pressed', 'true');
        state.desk = pill.getAttribute('data-desk') || 'all';
        runSearch();
      });
    });

    if (dateSelect) {
      dateSelect.addEventListener('change', () => {
        state.date = dateSelect.value;
        runSearch();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        state.sort = sortSelect.value;
        runSearch();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        input.value = '';
        state.query = '';
        state.desk = 'all';
        state.date = 'any';
        state.sort = 'relevance';
        if (dateSelect) dateSelect.value = 'any';
        if (sortSelect) sortSelect.value = 'relevance';
        deskPills.forEach(p => {
          const isAll = (p.getAttribute('data-desk') || 'all') === 'all';
          p.classList.toggle('is-active', isAll);
          p.setAttribute('aria-pressed', isAll ? 'true' : 'false');
        });
        runSearch();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        renderBatch();
      });
    }

    // Initialize from URL state
    readUrlParams();
    if (state.query || state.desk !== 'all' || state.date !== 'any') {
      runSearch();
    }
  }

  // Global Export
  const SamacharSearch = {
    STOPWORDS,
    CATEGORY_COLORS,
    tokenize,
    uniqueTokens,
    escapeRegex,
    escapeHtml,
    safeHighlight,
    formatTimeAgo,
    scoreArticle,
    filterAndRank,
    initSearchPage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SamacharSearch;
  }
  if (typeof window !== 'undefined') {
    window.SamacharSearch = SamacharSearch;
    document.addEventListener('DOMContentLoaded', initSearchPage);
  }
})();
