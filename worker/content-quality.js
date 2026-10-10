/**
 * Samachar Daily - Phase E: Content Quality Analyzer
 * Deterministic, local-only. No AI, no external APIs, no article mutation.
 */

// SECTION 1: TEXT UTILITIES

export function stripFrontmatter(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : markdown;
}

export function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

export function countSentences(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(/[.!?]+[\s"')\]]*(?:[A-Z]|$)/g);
  return matches ? matches.length : 1;
}

export function countParagraphs(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
}

export function countHeadings(text) {
  if (!text || typeof text !== 'string') return 0;
  const matches = text.match(/^#{1,6}\s+.+/gm);
  return matches ? matches.length : 0;
}

export function countLinks(text) {
  if (!text || typeof text !== 'string') return 0;
  const mdLinks = (text.match(/\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
  const bareLinks = (text.match(/https?:\/\/[^\s)>]+/g) || []).length;
  return Math.max(mdLinks, bareLinks);
}

const BOILERPLATE_PATTERNS = [
  /\bwhy it matters\b/i,
  /\bwhat happens next\b/i,
  /\bno confirmed next steps reported yet\b/i,
  /\bsamachar\s*daily\s*editorial\s*team\b/i,
  /\bsource\s*:\s*[a-z0-9 ]+\b/i,
  /\bstay tuned for more\b/i,
  /\bmore details are awaited\b/i,
  /\bdetails are awaited\b/i,
  /\bthis is a developing story\b/i,
  /\bfurther details are awaited\b/i,
  /\bwill be updated\b/i,
  /\bsubscribe to our newsletter\b/i,
  /\bfollow us on\b/i,
  /\bkeep watching\b/i,
  /\bstay tuned\b/i,
];

export function computeBoilerplateRatio(bodyText) {
  if (!bodyText || typeof bodyText !== 'string' || bodyText.trim().length === 0) return 0;
  const totalWords = countWords(bodyText);
  if (totalWords === 0) return 0;
  let boilerplateWords = 0;
  for (const pattern of BOILERPLATE_PATTERNS) {
    const matches = bodyText.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      boilerplateWords += matches.reduce((acc, m) => acc + countWords(m), 0);
    }
  }
  return Math.min(100, Math.round((boilerplateWords / totalWords) * 100));
}

export function detectRepeatedPhrases(bodyText, minNgram = 4, topN = 5) {
  if (!bodyText || typeof bodyText !== 'string') return [];
  const words = bodyText.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  if (words.length < minNgram) return [];
  const ngrams = {};
  for (let i = 0; i <= words.length - minNgram; i++) {
    const gram = words.slice(i, i + minNgram).join(' ');
    ngrams[gram] = (ngrams[gram] || 0) + 1;
  }
  return Object.entries(ngrams)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase, count]) => ({ phrase, count }));
}

export function detectRepeatedSentences(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return [];
  const sentences = bodyText.split(/[.!?]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20);
  const seen = {};
  const duplicates = [];
  for (const s of sentences) {
    if (seen[s]) {
      if (!duplicates.includes(s)) duplicates.push(s);
    }
    seen[s] = true;
  }
  return duplicates;
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','up','as','is','was','are','were','be','been','being','have','has',
  'had','do','does','did','will','would','shall','should','may','might','must',
  'can','could','that','this','these','those','it','its','we','you','he',
  'she','they','their','our','your','his','her','not','no','so','if','about',
  'into','also','than','then','when','which','who','whom','how','what','where',
  'said','says','told','after','before','between','through','during','now','new',
  'one','two','three','four','five','six','seven','eight','nine','ten','more',
  'over','under','per','cent','percent','india','indian','news','report',
  'according','amid','following',
]);

export function fingerprintBodyText(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return '';
  const words = bodyText.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  const unique = [...new Set(words)].sort();
  return unique.join(' ');
}

export function computeJaccardSimilarity(fpA, fpB) {
  if (!fpA || !fpB) return 0;
  const setA = new Set(fpA.split(' ').filter(Boolean));
  const setB = new Set(fpB.split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// SECTION 2: THRESHOLDS

export const THRESHOLDS = {
  EXTREMELY_SHORT_BODY: 80,
  SHORT_BODY: 200,
  ACCEPTABLE_BRIEF: 30,
  ADEQUATE_BODY: 350,
  HIGH_BOILERPLATE: 30,
  MODERATE_BOILERPLATE: 15,
  REPEATED_SENTENCES: 1,
  REPEATED_PHRASE_COUNT: 3,
  EXACT_DUPLICATE: 0.95,
  NEAR_DUPLICATE: 0.65,
  RELATED_SIMILAR: 0.40,
  VERY_SHORT_HEADLINE: 20,
  SHORT_HEADLINE: 30,
  MIN_PARAGRAPHS: 2,
  FRESH_DAYS: 7,
  RECENT_DAYS: 30,
  OLDER_DAYS: 90,
};

// SECTION 3: PER-ARTICLE ANALYSIS

export function analyzeArticle(data, body, category, slug, relPath) {
  const now = new Date();
  const title = (data.title || '').trim();
  const dek = (data.dek || '').trim();
  const author = (data.author || '').trim();
  const dateRaw = data.date || null;
  const imageUrl = data.image || null;
  const imageCredit = data.imageCredit || null;
  const imageAlt = data.imageAlt || null;
  const sourceUrl = data.sourceUrl || null;
  const sourceName = data.sourceName || null;
  const videoId = data.video_id || null;
  const canonical = data.canonical || null;
  const noindex = Boolean(data.noindex);
  const actualCategory = category || data.category || 'unknown';

  let pubDate = null;
  let ageInDays = null;
  let freshness = 'unknown';
  if (dateRaw) {
    try {
      pubDate = new Date(dateRaw);
      if (!isNaN(pubDate.getTime())) {
        ageInDays = Math.floor((now - pubDate) / (1000 * 60 * 60 * 24));
        if (ageInDays <= THRESHOLDS.FRESH_DAYS) freshness = 'fresh';
        else if (ageInDays <= THRESHOLDS.RECENT_DAYS) freshness = 'recent';
        else if (ageInDays <= THRESHOLDS.OLDER_DAYS) freshness = 'moderate';
        else freshness = 'older';
      }
    } catch (_) {}
  }

  const bodyText = (body || '').trim();
  const totalWords = countWords(title + ' ' + dek + ' ' + bodyText);
  const bodyWords = countWords(bodyText);
  const headlineWords = countWords(title);
  const headlineLength = title.length;
  const dekWords = countWords(dek);
  const paragraphCount = countParagraphs(bodyText);
  const headingCount = countHeadings(bodyText);
  const sentenceCount = countSentences(bodyText);
  const avgParaLength = paragraphCount > 0 ? Math.round(bodyWords / paragraphCount) : 0;
  const avgSentenceLength = sentenceCount > 0 ? Math.round(bodyWords / sentenceCount) : 0;
  const linkCount = countLinks(bodyText);
  const boilerplateRatio = computeBoilerplateRatio(bodyText);
  const repeatedPhrases = detectRepeatedPhrases(bodyText);
  const repeatedSentences = detectRepeatedSentences(bodyText);
  const bodyFingerprint = fingerprintBodyText(bodyText);

  const missingTitle = !title;
  const missingDek = !dek;
  const missingAuthor = !author;
  const missingDate = !pubDate;
  const missingImage = !imageUrl;
  const missingSource = !sourceUrl && !sourceName;

  const signals = [];

  if (bodyWords === 0) {
    signals.push({ code: 'EMPTY_BODY', label: 'No article body', severity: 'critical' });
  } else if (bodyWords < THRESHOLDS.EXTREMELY_SHORT_BODY) {
    signals.push({ code: 'EXTREMELY_SHORT_BODY', label: 'Extremely short body', severity: 'warning' });
  } else if (bodyWords < THRESHOLDS.SHORT_BODY) {
    signals.push({ code: 'SHORT_BODY', label: 'Short body', severity: 'info' });
  }

  if (boilerplateRatio >= THRESHOLDS.HIGH_BOILERPLATE && bodyWords > 20) {
    signals.push({ code: 'HIGH_BOILERPLATE', label: 'High repeated-content ratio', severity: 'warning' });
  } else if (boilerplateRatio >= THRESHOLDS.MODERATE_BOILERPLATE && bodyWords > 20) {
    signals.push({ code: 'MODERATE_BOILERPLATE', label: 'Moderate boilerplate content', severity: 'info' });
  }

  if (repeatedSentences.length >= THRESHOLDS.REPEATED_SENTENCES) {
    signals.push({ code: 'REPEATED_SENTENCES', label: 'Repeated sentences detected', severity: 'warning' });
  }
  if (repeatedPhrases.length >= THRESHOLDS.REPEATED_PHRASE_COUNT) {
    signals.push({ code: 'REPEATED_PHRASES', label: 'Frequent repeated phrases', severity: 'info' });
  }
  if (paragraphCount < THRESHOLDS.MIN_PARAGRAPHS && bodyWords > 0) {
    signals.push({ code: 'MINIMAL_STRUCTURE', label: 'Minimal paragraph structure', severity: 'info' });
  }

  if (missingTitle) {
    signals.push({ code: 'MISSING_HEADLINE', label: 'Missing headline', severity: 'critical' });
  } else if (headlineLength < THRESHOLDS.VERY_SHORT_HEADLINE) {
    signals.push({ code: 'VERY_SHORT_HEADLINE', label: 'Very short headline', severity: 'warning' });
  } else if (headlineLength < THRESHOLDS.SHORT_HEADLINE) {
    signals.push({ code: 'SHORT_HEADLINE', label: 'Short headline', severity: 'info' });
  }

  if (missingAuthor) {
    signals.push({ code: 'MISSING_AUTHOR', label: 'Missing author', severity: 'info' });
  }
  if (missingDate) {
    signals.push({ code: 'MISSING_DATE', label: 'Missing publication date', severity: 'warning' });
  }
  if (missingDek && bodyWords > 50) {
    signals.push({ code: 'MISSING_DEK', label: 'Missing article summary (dek)', severity: 'info' });
  }
  if (missingSource) {
    signals.push({ code: 'MISSING_SOURCE', label: 'Missing source attribution', severity: 'info' });
  }

  const hasAnyBodyContent = bodyWords > 0;
  const hasCritical = signals.some(s => s.severity === 'critical');
  const hasWarnings = signals.some(s => s.severity === 'warning');

  const isLikelyBrief = (
    bodyWords >= THRESHOLDS.ACCEPTABLE_BRIEF &&
    bodyWords < THRESHOLDS.SHORT_BODY &&
    boilerplateRatio < THRESHOLDS.HIGH_BOILERPLATE &&
    repeatedSentences.length === 0 &&
    sentenceCount >= 2 &&
    (bodyText.match(/\b\d+[\d,.%]*\b/g) || []).length >= 1 &&
    !missingTitle
  );

  let qualityStatus, qualityLabel;
  if (!hasAnyBodyContent || hasCritical) {
    qualityStatus = 'thin';
    qualityLabel = 'Potential Thin Content';
  } else if (bodyWords < THRESHOLDS.ACCEPTABLE_BRIEF) {
    qualityStatus = 'thin';
    qualityLabel = 'Potential Thin Content';
  } else if (bodyWords < THRESHOLDS.EXTREMELY_SHORT_BODY && boilerplateRatio >= THRESHOLDS.HIGH_BOILERPLATE) {
    qualityStatus = 'thin';
    qualityLabel = 'Potential Thin Content';
  } else if (isLikelyBrief) {
    qualityStatus = 'brief';
    qualityLabel = 'Short News Brief';
  } else if (hasWarnings || signals.length >= 3) {
    qualityStatus = 'needs_review';
    qualityLabel = 'Needs Review';
  } else if (bodyWords >= THRESHOLDS.ADEQUATE_BODY && !missingTitle && !missingDate && !hasWarnings) {
    qualityStatus = 'healthy';
    qualityLabel = 'Healthy';
  } else {
    qualityStatus = 'needs_review';
    qualityLabel = 'Needs Review';
  }

  const publicUrl = slug ? `/${actualCategory.toLowerCase()}/articles/${slug}/` : null;

  return {
    relPath, slug, category: actualCategory, title, dek, author,
    pubDate: pubDate ? pubDate.toISOString() : null,
    ageInDays, freshness,
    imageUrl, imageCredit, imageAlt, sourceUrl, sourceName, videoId, noindex, canonical, publicUrl,
    totalWords, bodyWords, headlineLength, headlineWords, dekWords,
    paragraphCount, headingCount, sentenceCount, avgParaLength, avgSentenceLength,
    linkCount, boilerplateRatio,
    repeatedPhrases: repeatedPhrases.slice(0, 3),
    repeatedSentenceCount: repeatedSentences.length,
    signals, qualityStatus, qualityLabel,
    _fingerprint: bodyFingerprint,
    missingTitle, missingDek, missingAuthor, missingDate, missingImage, missingSource,
  };
}

// SECTION 4: DUPLICATE DETECTION

export function detectDuplicates(articles, threshold = THRESHOLDS.NEAR_DUPLICATE) {
  const pairs = [];
  const candidates = articles.filter(a => a.bodyWords >= 15 && a._fingerprint);

  // Pre-index tokens for each candidate document
  const candidateSets = candidates.map(c => {
    const tokens = c._fingerprint.split(' ').filter(Boolean);
    return { article: c, tokens, size: tokens.length };
  });

  // Build inverted index of token -> document indices
  const tokenToDocIndices = new Map();
  for (let i = 0; i < candidateSets.length; i++) {
    for (const t of candidateSets[i].tokens) {
      let list = tokenToDocIndices.get(t);
      if (!list) {
        list = [];
        tokenToDocIndices.set(t, list);
      }
      list.push(i);
    }
  }

  // Find co-occurring documents and compute exact Jaccard similarity
  for (let i = 0; i < candidateSets.length; i++) {
    const docA = candidateSets[i];
    if (docA.size === 0) continue;

    const coOccurring = new Map();
    for (const t of docA.tokens) {
      const docs = tokenToDocIndices.get(t);
      if (docs) {
        for (const j of docs) {
          if (j > i) {
            coOccurring.set(j, (coOccurring.get(j) || 0) + 1);
          }
        }
      }
    }

    for (const [j, intersectionCount] of coOccurring.entries()) {
      const docB = candidateSets[j];
      const unionSize = docA.size + docB.size - intersectionCount;
      const similarity = unionSize > 0 ? (intersectionCount / unionSize) : 0;

      if (similarity >= threshold) {
        let dupType;
        if (similarity >= THRESHOLDS.EXACT_DUPLICATE) dupType = 'exact_duplicate';
        else if (similarity >= THRESHOLDS.NEAR_DUPLICATE) dupType = 'near_duplicate';
        else dupType = 'related_similar';

        const a = docA.article;
        const b = docB.article;
        pairs.push({
          articleA: { relPath: a.relPath, slug: a.slug, title: a.title, category: a.category, pubDate: a.pubDate, publicUrl: a.publicUrl, bodyWords: a.bodyWords },
          articleB: { relPath: b.relPath, slug: b.slug, title: b.title, category: b.category, pubDate: b.pubDate, publicUrl: b.publicUrl, bodyWords: b.bodyWords },
          similarity: Math.round(similarity * 100),
          dupType,
          dupLabel: dupType === 'exact_duplicate' ? 'Exact Duplicate' : dupType === 'near_duplicate' ? 'Near Duplicate' : 'Related / Similar',
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

// SECTION 5: CORPUS SUMMARY

export function buildCorpusSummary(articles, duplicatePairs) {
  const total = articles.length;
  const healthy = articles.filter(a => a.qualityStatus === 'healthy').length;
  const thin = articles.filter(a => a.qualityStatus === 'thin').length;
  const needsReview = articles.filter(a => a.qualityStatus === 'needs_review').length;
  const brief = articles.filter(a => a.qualityStatus === 'brief').length;
  const nearDuplicates = duplicatePairs.filter(p => p.dupType === 'near_duplicate' || p.dupType === 'exact_duplicate').length;
  const exactDuplicates = duplicatePairs.filter(p => p.dupType === 'exact_duplicate').length;
  const missingMeta = articles.filter(a => a.missingTitle || a.missingDate || a.missingAuthor).length;
  const noindexed = articles.filter(a => a.noindex).length;
  const fresh = articles.filter(a => a.freshness === 'fresh').length;
  const recent = articles.filter(a => a.freshness === 'recent').length;
  const older = articles.filter(a => a.freshness === 'older').length;
  const avgBodyWords = total > 0 ? Math.round(articles.reduce((sum, a) => sum + a.bodyWords, 0) / total) : 0;
  const totalWithSignals = articles.filter(a => a.signals && a.signals.length > 0).length;
  return { total, healthy, thin, needsReview, brief, nearDuplicates, exactDuplicates, missingMeta, noindexed, freshness: { fresh, recent, older }, avgBodyWords, totalWithSignals, analyzedAt: new Date().toISOString() };
}

// SECTION 6: CACHE HELPERS

export const QUALITY_CACHE_KEY = 'phase_e:quality_index:v1';
export const QUALITY_CACHE_TTL = 3600;

export function buildCachePayload(articles, duplicatePairs, summary) {
  return {
    summary,
    duplicatePairs: duplicatePairs.slice(0, 200),
    articles: articles.map(a => { const { _fingerprint, ...safe } = a; return safe; }),
    cachedAt: new Date().toISOString(),
  };
}

// SECTION 7: ARTICLE INDEX PARSER

export function parseArticleIndex(indexData) {
  let parsed;
  if (typeof indexData === 'string') {
    try { parsed = JSON.parse(indexData); } catch (_) { return []; }
  } else {
    parsed = indexData;
  }
  if (!parsed || !Array.isArray(parsed.articles)) return [];
  return parsed.articles.map(art => ({
    data: art.data || {},
    body: art.body || '',
    category: art.category || (art.data && art.data.category) || 'unknown',
    slug: art.slug || (art.data && art.data.slug) || '',
    relPath: art.relPath || ('src/articles/' + ((art.category || 'unknown') + '/' + ((art.slug || '') + '.md'))),
  }));
}

// SECTION 8: PAGINATION

export function paginateArticles(items, options) {
  const opts = options || {};
  const page = opts.page || 1;
  const pageSize = opts.pageSize || 50;
  const filter = opts.filter || 'all';
  const desk = opts.desk || '';
  const minWords = opts.minWords || 0;
  const maxWords = opts.maxWords || Infinity;
  const sortBy = opts.sortBy || 'date_desc';

  let filtered = items.slice();

  if (filter && filter !== 'all') {
    filtered = filtered.filter(a => a.qualityStatus === filter);
  }
  if (desk && desk !== 'all') {
    filtered = filtered.filter(a => (a.category || '').toLowerCase() === desk.toLowerCase());
  }
  if (minWords > 0 || maxWords < Infinity) {
    filtered = filtered.filter(a => a.bodyWords >= minWords && a.bodyWords <= maxWords);
  }

  if (sortBy === 'date_desc') {
    filtered.sort((a, b) => (b.pubDate || '') > (a.pubDate || '') ? 1 : -1);
  } else if (sortBy === 'date_asc') {
    filtered.sort((a, b) => (a.pubDate || '') > (b.pubDate || '') ? 1 : -1);
  } else if (sortBy === 'words_asc') {
    filtered.sort((a, b) => a.bodyWords - b.bodyWords);
  } else if (sortBy === 'words_desc') {
    filtered.sort((a, b) => b.bodyWords - a.bodyWords);
  } else if (sortBy === 'quality') {
    const ORDER = { thin: 0, needs_review: 1, brief: 2, duplicate: 3, healthy: 4 };
    filtered.sort((a, b) => ((ORDER[a.qualityStatus] !== undefined ? ORDER[a.qualityStatus] : 5) - (ORDER[b.qualityStatus] !== undefined ? ORDER[b.qualityStatus] : 5)));
  }

  const total = filtered.length;
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(200, Math.max(1, Math.floor(pageSize)));
  const totalPages = Math.ceil(total / safePageSize) || 1;
  const startIdx = (safePage - 1) * safePageSize;
  const pageItems = filtered.slice(startIdx, startIdx + safePageSize);

  return { items: pageItems, total, page: safePage, pageSize: safePageSize, totalPages };
}
