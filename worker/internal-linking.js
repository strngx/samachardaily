/**
 * Samachar Daily — Internal Linking & Orphan Content Detection Engine
 *
 * Production-Safe, Build-Verified, 100% Deterministic Link Graph.
 * ZERO AI CALLS. ZERO EXTERNAL APIS. READ-ONLY ANALYSIS.
 */

const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'by', 'at', 'from',
  'this', 'that', 'an', 'a', 'as', 'it', 'its', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'or', 'into', 'over', 'after', 'new', 'latest', 'today',
  'said', 'report', 'reports', 'news', 'amid', 'ahead', 'after', 'says', 'will',
  'how', 'what', 'why', 'who', 'when', 'where', 'which', 'about', 'more', 'all'
]);

const SHORT_ENTITIES = new Set([
  'ai', 'us', 'uk', 'eu', 'un', 'pm', 'cm', 'bjp', 'aap', 'rbi', 'ipo', 't20', 'odi'
]);

export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => (t.length > 2 || SHORT_ENTITIES.has(t)) && !STOPWORDS.has(t));
}

export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let clean = rawUrl.trim();
  // Strip origin
  clean = clean.replace(/^https?:\/\/(?:thesamachardaily\.in|localhost(?::\d+)?)/i, '');
  // Strip query and hash
  clean = clean.split('?')[0].split('#')[0];
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (!clean.endsWith('/')) clean = clean + '/';
  return clean.toLowerCase();
}

export function extractSlugTokens(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return [];
  const parts = urlOrPath.toLowerCase().split(/[/?#]+/).filter(Boolean);
  const ignore = new Set(['articles', 'article', 'india', 'world', 'business', 'tech', 'sports', 'index', 'html']);
  const tokens = [];
  for (const part of parts) {
    if (ignore.has(part)) continue;
    const words = part.split(/[-_]+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
    tokens.push(...words);
  }
  return [...new Set(tokens)];
}

/**
 * Build deterministic link graph from corpus and related stories
 */
export function analyzeInternalLinks(articleList, relatedStoriesMap = {}) {
  const articles = Array.isArray(articleList) ? articleList : [];

  // 1. Index known published article URLs and canonical records
  const urlToArticle = new Map();
  const slugToArticle = new Map();
  const noindexUrls = new Set();
  const redirectUrls = new Set();

  for (const art of articles) {
    const data = art.data || {};
    const cat = (art.category || data.category || 'india').toLowerCase().trim();
    const slug = art.slug || data.slug || '';
    const normUrl = `/articles/${cat}/${slug}/`;

    const record = {
      slug,
      category: cat,
      title: (data.title || slug).trim(),
      dek: (data.dek || '').trim(),
      date: data.date ? new Date(data.date).toISOString() : (art.date || ''),
      timestamp: data.date ? new Date(data.date).getTime() : 0,
      url: normUrl,
      noindex: data.noindex === true || data.noindex === 'true',
      isRedirect: Boolean(data.redirect_to || data.redirect),
      wordCount: data.wordCount || 0
    };

    urlToArticle.set(normUrl, record);
    slugToArticle.set(slug, record);

    if (record.noindex) noindexUrls.add(normUrl);
    if (record.isRedirect) redirectUrls.add(normUrl);
  }

  // 2. Extract outbound links from markdown bodies
  const bodyLinkRegex = /\[([^\]]+)\]\(([^)]+)\)|<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const linkGraph = new Map(); // targetUrl -> { bodySources: [], relatedSources: [] }
  const brokenLinks = [];
  let totalBodyLinksCount = 0;
  let totalRelatedLinksCount = 0;

  for (const art of articles) {
    const cat = (art.category || art.data?.category || 'india').toLowerCase().trim();
    const slug = art.slug || art.data?.slug || '';
    const sourceUrl = `/articles/${cat}/${slug}/`;
    const sourceTitle = art.data?.title || slug;
    const body = art.body || '';

    // A. Parse inline body links
    let match;
    while ((match = bodyLinkRegex.exec(body)) !== null) {
      const rawHref = match[2] || match[3] || '';
      const anchorText = (match[1] || match[4] || '').replace(/<[^>]*>/g, '').trim();

      if (!rawHref) continue;

      // Check if internal article link
      const isInternal = rawHref.startsWith('/articles/') ||
                         rawHref.includes('thesamachardaily.in/articles/');

      if (isInternal) {
        totalBodyLinksCount++;
        const targetUrl = normalizeUrl(rawHref);

        // Check if self-link
        if (targetUrl === sourceUrl) continue;

        // Check target existence
        const targetArticle = urlToArticle.get(targetUrl);
        if (!targetArticle) {
          brokenLinks.push({
            sourceUrl,
            sourceSlug: slug,
            sourceTitle,
            targetUrl,
            anchorText,
            reason: 'Target article does not exist in published corpus'
          });
        } else {
          if (!linkGraph.has(targetUrl)) {
            linkGraph.set(targetUrl, { bodySources: [], relatedSources: [] });
          }
          linkGraph.get(targetUrl).bodySources.push({
            sourceUrl,
            sourceSlug: slug,
            sourceTitle,
            sourceCategory: cat,
            anchorText: anchorText || 'Inline citation',
            isNoindexTarget: targetArticle.noindex,
            isRedirectTarget: targetArticle.isRedirect
          });
        }
      }
    }

    // B. Parse build-time Related Stories links
    const relatedList = relatedStoriesMap[sourceUrl] || [];
    for (const relItem of relatedList) {
      const relTargetUrl = normalizeUrl(relItem.url);
      if (!relTargetUrl || relTargetUrl === sourceUrl) continue;

      totalRelatedLinksCount++;
      if (!linkGraph.has(relTargetUrl)) {
        linkGraph.set(relTargetUrl, { bodySources: [], relatedSources: [] });
      }
      linkGraph.get(relTargetUrl).relatedSources.push({
        sourceUrl,
        sourceSlug: slug,
        sourceTitle,
        sourceCategory: cat,
        score: relItem.score || 0
      });
    }
  }

  // 3. Assemble per-article link analytics & orphan classification
  const tokenCache = new Map();
  for (const art of articles) {
    const title = art.data?.title || art.slug || '';
    const dek = art.data?.dek || '';
    tokenCache.set(art.slug, new Set([...tokenize(title), ...tokenize(dek)]));
  }

  const enrichedArticles = [];
  const categoryStats = {
    india: { total: 0, orphans: 0, connected: 0, totalInbound: 0 },
    world: { total: 0, orphans: 0, connected: 0, totalInbound: 0 },
    business: { total: 0, orphans: 0, connected: 0, totalInbound: 0 },
    tech: { total: 0, orphans: 0, connected: 0, totalInbound: 0 },
    sports: { total: 0, orphans: 0, connected: 0, totalInbound: 0 }
  };

  let orphanCount = 0;
  let weakCount = 0;
  let connectedCount = 0;
  let uniqueLinkedInbound = 0;

  for (const art of articles) {
    const data = art.data || {};
    const cat = (art.category || data.category || 'india').toLowerCase().trim();
    const slug = art.slug || data.slug || '';
    const normUrl = `/articles/${cat}/${slug}/`;

    const links = linkGraph.get(normUrl) || { bodySources: [], relatedSources: [] };
    const bodySources = links.bodySources;
    const relatedSources = links.relatedSources;

    // Unique linking sources
    const uniqueSourcesSet = new Set([
      ...bodySources.map(s => s.sourceUrl),
      ...relatedSources.map(s => s.sourceUrl)
    ]);
    const inboundTotalCount = uniqueSourcesSet.size;

    const isOrphan = inboundTotalCount === 0;
    const isWeak = inboundTotalCount === 1;
    const isConnected = inboundTotalCount >= 2;

    if (inboundTotalCount > 0) uniqueLinkedInbound++;
    if (isOrphan) orphanCount++;
    else if (isWeak) weakCount++;
    else connectedCount++;

    if (categoryStats[cat]) {
      categoryStats[cat].total++;
      if (isOrphan) categoryStats[cat].orphans++;
      if (isConnected) categoryStats[cat].connected++;
      categoryStats[cat].totalInbound += inboundTotalCount;
    }

    // 4. Deterministic contextual link recommendations (for orphans and weak articles)
    const recommendations = [];
    if (inboundTotalCount <= 1) {
      const myTokens = tokenCache.get(slug) || new Set();
      const scoredCandidates = [];

      for (const otherArt of articles) {
        const otherSlug = otherArt.slug || otherArt.data?.slug || '';
        if (otherSlug === slug) continue;
        const otherCat = (otherArt.category || otherArt.data?.category || 'india').toLowerCase().trim();
        const otherTokens = tokenCache.get(otherSlug) || new Set();

        let sharedCount = 0;
        const sharedWords = [];
        for (const t of myTokens) {
          if (otherTokens.has(t)) {
            sharedCount++;
            if (sharedWords.length < 4) sharedWords.push(t);
          }
        }

        if (sharedCount >= 2 || (sharedCount >= 1 && otherCat === cat)) {
          let score = sharedCount * 20;
          if (otherCat === cat) score += 15;
          scoredCandidates.push({
            slug: otherSlug,
            url: `/articles/${otherCat}/${otherSlug}/`,
            title: otherArt.data?.title || otherSlug,
            category: otherCat,
            score,
            sharedWords: sharedWords.join(', ')
          });
        }
      }

      scoredCandidates.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
      recommendations.push(...scoredCandidates.slice(0, 3));
    }

    enrichedArticles.push({
      slug,
      category: cat,
      title: (data.title || slug).trim(),
      dek: (data.dek || '').trim(),
      url: normUrl,
      date: data.date ? new Date(data.date).toISOString() : (art.date || ''),
      timestamp: data.date ? new Date(data.date).getTime() : 0,
      inboundTotalCount,
      inboundBodyCount: bodySources.length,
      inboundRelatedCount: relatedSources.length,
      bodySources: bodySources.slice(0, 10),
      relatedSources: relatedSources.slice(0, 10),
      isOrphan,
      isWeak,
      isConnected,
      status: isOrphan ? 'orphan' : (isWeak ? 'weak' : 'connected'),
      recommendedPartners: recommendations
    });
  }

  // Final summary
  const summary = {
    totalArticles: articles.length,
    totalInternalLinks: totalBodyLinksCount + totalRelatedLinksCount,
    totalBodyLinks: totalBodyLinksCount,
    totalRelatedLinks: totalRelatedLinksCount,
    uniqueLinkedArticles: uniqueLinkedInbound,
    orphanCount,
    weakCount,
    connectedCount,
    orphanPercentage: articles.length ? ((orphanCount / articles.length) * 100).toFixed(1) : '0.0',
    brokenCount: brokenLinks.length,
    brokenLinks: brokenLinks.slice(0, 50),
    categoryCoverage: categoryStats,
    generatedAt: new Date().toISOString()
  };

  return {
    summary,
    articles: enrichedArticles,
    brokenLinks
  };
}

/**
 * Paginate, filter, and sort internal link results
 */
export function paginateInternalLinks(articles, options = {}) {
  const {
    desk = 'all',
    status = 'all',
    search = '',
    page = 1,
    pageSize = 50,
    sortBy = 'inbound_asc'
  } = options;

  let filtered = Array.isArray(articles) ? [...articles] : [];

  // 1. Desk filter
  if (desk && desk !== 'all') {
    const targetDesk = desk.toLowerCase().trim();
    filtered = filtered.filter(a => a.category.toLowerCase() === targetDesk);
  }

  // 2. Status filter
  if (status && status !== 'all') {
    if (status === 'orphan') filtered = filtered.filter(a => a.isOrphan);
    else if (status === 'weak') filtered = filtered.filter(a => a.isWeak);
    else if (status === 'connected') filtered = filtered.filter(a => a.isConnected);
  }

  // 3. Search query
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.slug.toLowerCase().includes(q) ||
      a.dek.toLowerCase().includes(q)
    );
  }

  // 4. Sorting
  filtered.sort((a, b) => {
    if (sortBy === 'inbound_asc') {
      if (a.inboundTotalCount !== b.inboundTotalCount) return a.inboundTotalCount - b.inboundTotalCount;
      return b.timestamp - a.timestamp;
    }
    if (sortBy === 'inbound_desc') {
      if (a.inboundTotalCount !== b.inboundTotalCount) return b.inboundTotalCount - a.inboundTotalCount;
      return b.timestamp - a.timestamp;
    }
    if (sortBy === 'date_desc') {
      return b.timestamp - a.timestamp;
    }
    if (sortBy === 'date_asc') {
      return a.timestamp - b.timestamp;
    }
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    return 0;
  });

  const total = filtered.length;
  const safePageSize = Math.max(1, Math.min(200, pageSize));
  const totalPages = Math.ceil(total / safePageSize) || 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (safePage - 1) * safePageSize;
  const items = filtered.slice(startIndex, startIndex + safePageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages
  };
}
