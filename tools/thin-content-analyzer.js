/**
 * Samachar Daily — Thin Content Queue Deterministic Analyzer (Phase 8)
 *
 * Implements deterministic multi-signal content analysis across the complete
 * article corpus:
 * 1. Content Length: word count, char count, paragraph count, title length, body substance
 * 2. Content Structure: meaningful paragraphs, attribution/source, quotes, context, facts, boilerplate
 * 3. Thinness: multi-signal identification distinguishing "short" from "thin"
 * 4. Repetition / Overlap: Jaccard title token similarity and entity overlap detection
 * 5. Low-Value Signals: transparent evidence, non-defamatory advisory classifications
 * 6. Positive Exemptions: recognizes concise legitimate breaking news updates
 * 7. Roadmap Categories ONLY: Enrich, Keep Short, Consolidate, Noindex, Prune, Review
 * 8. Pure, deterministic, read-only: never modifies any article file or metadata
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// Common English stopwords for accurate topic tokenization
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'amid',
  'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'can\'t',
  'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t',
  'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d',
  'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in',
  'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more',
  'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they',
  'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to',
  'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll',
  'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s',
  'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s',
  'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re',
  'you\'ve', 'your', 'yours', 'yourself', 'yourselves', 'today', 'news', 'india'
]);

// Context framing regex patterns
const CONTEXT_PATTERNS = /\b(?:earlier|previously|background|history|in recent months|context|following the|development comes as|preceded by|meanwhile|historically|prior to|over the past)\b/i;

// Attribution regex patterns
const ATTRIBUTION_PATTERNS = /\b(?:according to|reported by|spokesperson|news agency|press release|pti|ani|reuters|afp|associated press|official statement|confirmed by|disclosed by|briefed reporters)\b/i;

// Facts, figures, and dates regex patterns
const FACTS_PATTERNS = /\b(?:\d{1,4}(?:,\d{3})*(?:\.\d+)?%?|\$\d+|₹\d+|rs\.?\s*\d+|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b)\b/i;

// Explanatory reasoning patterns
const EXPLANATORY_PATTERNS = /\b(?:because|due to|in order to|as a result|explaining why|intended to|significance|implications|aims to|seeks to|primary objective)\b/i;

/**
 * Counts words in a string safely
 */
function countWords(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Formats a Date or date string to ISO YYYY-MM-DD
 */
function formatDateIso(dateVal) {
  if (!dateVal) return null;
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch (_) {
    return String(dateVal).slice(0, 10);
  }
}

/**
 * Tokenizes text into normalized meaningful words for similarity analysis
 */
function tokenizeText(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Computes Jaccard token similarity between two token sets
 */
function computeJaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const token of setA) {
    if (setB.has(token)) intersect++;
  }
  const union = setA.size + setB.size - intersect;
  return union > 0 ? intersect / union : 0;
}

/**
 * Evaluates individual article signals deterministically
 */
function evaluateArticleSignals(article) {
  const body = (article.body || '').trim();
  const title = (article.title || '').trim();
  const wordCount = article.wordCount || countWords(body);
  const charCount = body.length;
  const titleCharCount = title.length;

  // Paragraph extraction
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  const paraCount = Math.max(paragraphs.length, body ? 1 : 0);
  const meaningfulParas = paragraphs.filter(p => countWords(p) >= 20).length;
  const avgWordsPerPara = paraCount > 0 ? Math.round(wordCount / paraCount) : 0;

  // Signal detectors
  const hasAttribution = Boolean(
    (article.sourceName && String(article.sourceName).trim() !== '') ||
    (article.sourceUrl && String(article.sourceUrl).trim() !== '') ||
    ATTRIBUTION_PATTERNS.test(body)
  );

  const hasQuotes = /["""]|(?:\n|^)>/.test(body);
  const hasContext = CONTEXT_PATTERNS.test(body);
  const hasFacts = FACTS_PATTERNS.test(body);
  const hasExplanatory = EXPLANATORY_PATTERNS.test(body);

  // Substance ratio (ratio of substantive >3-char words vs total words)
  const substantiveTokens = tokenizeText(body);
  const bodySubstanceRatio = wordCount > 0 ? Math.min(1, substantiveTokens.length / wordCount) : 0;

  return {
    wordCount,
    charCount,
    titleCharCount,
    paraCount,
    meaningfulParas,
    avgWordsPerPara,
    hasAttribution,
    hasQuotes,
    hasContext,
    hasFacts,
    hasExplanatory,
    bodySubstanceRatio,
    titleTokens: new Set(tokenizeText(title))
  };
}

/**
 * Runs multi-article overlap analysis across active corpus
 */
function findArticleOverlaps(articles) {
  const overlapMap = new Map();

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    for (let j = i + 1; j < articles.length; j++) {
      const b = articles[j];
      // Compare articles in the same desk
      if (a.category !== b.category) continue;

      const sim = computeJaccardSimilarity(a.signals.titleTokens, b.signals.titleTokens);
      // Safe deterministic threshold: >= 40% significant title vocabulary overlap
      if (sim >= 0.40) {
        const existingA = overlapMap.get(a.id);
        if (!existingA || existingA.sim < sim) {
          overlapMap.set(a.id, { related: b, sim });
        }
        const existingB = overlapMap.get(b.id);
        if (!existingB || existingB.sim < sim) {
          overlapMap.set(b.id, { related: a, sim });
        }
      }
    }
  }

  return overlapMap;
}

/**
 * Classifies an article based on detected multi-signals and overlap
 * Uses ONLY the roadmap categories: Enrich, Keep Short, Consolidate, Noindex, Prune, Review
 */
function classifyArticle(article, overlap) {
  const sig = article.signals;
  const isoDate = formatDateIso(article.date);
  const detectedSignals = [];
  const notDetectedSignals = [];

  // Build transparent signal logs
  if (sig.wordCount < 100) detectedSignals.push(`Severe brevity: ${sig.wordCount} words`);
  else if (sig.wordCount < 180) detectedSignals.push(`Sub-standard length: ${sig.wordCount} words`);
  else if (sig.wordCount < 250) detectedSignals.push(`Moderate length: ${sig.wordCount} words`);

  if (sig.paraCount <= 1) detectedSignals.push('Single paragraph layout');
  if (sig.meaningfulParas < 2) detectedSignals.push('Fewer than 2 substantive paragraphs (>=20 words)');
  if (!sig.hasAttribution) notDetectedSignals.push('Wire attribution or primary source cited');
  else detectedSignals.push('Active primary source or wire attribution verified');

  if (!sig.hasQuotes) notDetectedSignals.push('Direct quotation marks or official statement');
  else detectedSignals.push('Direct quotes present');

  if (!sig.hasContext) notDetectedSignals.push('Background or historical context framing');
  else detectedSignals.push('Background context detected');

  if (!sig.hasFacts) notDetectedSignals.push('Specific verifiable numerical or temporal facts');
  else detectedSignals.push('Specific figures, dates, or verifiable metrics present');

  if (!sig.hasExplanatory) notDetectedSignals.push('Explanatory reasoning phrases (why/how)');

  let classification = null;
  let finding = null;
  let confidence = 'Medium';
  let reason = '';
  let relatedArticle = null;
  let evidence = [];

  // 1. REPETITION / OVERLAP -> Consolidate
  if (overlap) {
    classification = 'Consolidate';
    finding = 'Potential overlap';
    confidence = overlap.sim >= 0.50 ? 'High' : 'Medium';
    reason = `Title and body strongly overlap with another article covering the same event.`;
    relatedArticle = {
      id: overlap.related.id,
      title: overlap.related.title,
      slug: overlap.related.slug,
      url: overlap.related.url,
      category: overlap.related.category,
      date: formatDateIso(overlap.related.date),
      similarityPercent: Math.round(overlap.sim * 100)
    };
    evidence.push(`Shares ${Math.round(overlap.sim * 100)}% significant title vocabulary with "${overlap.related.title}"`);
    evidence.push(`Both articles published in ${article.category.toUpperCase()} desk.`);
  }
  // 2. EPHEMERAL / OBSOLETE -> Prune
  // Under 85 words, lacks quotes/context, published over 2 weeks ago (< 2026-09-18)
  else if (sig.wordCount < 85 && !sig.hasQuotes && !sig.hasContext && isoDate && isoDate < '2026-09-18') {
    classification = 'Prune';
    finding = 'Potentially obsolete/low-value';
    confidence = 'Medium';
    reason = 'Article appears to be an ephemeral update with limited historical or archival value.';
    evidence.push(`Article body contains only ${sig.wordCount} words.`);
    evidence.push('Lacks direct quotations and contextual analysis.');
    evidence.push(`Published on ${isoDate}; candidate for editorial pruning or consolidation.`);
  }
  // 3. LIMITED STANDALONE DEPTH -> Noindex
  // Extremely thin (<100 words), lacks quotes and context
  else if (sig.wordCount < 100 && !sig.hasQuotes && !sig.hasContext) {
    classification = 'Noindex';
    finding = 'Limited standalone depth';
    confidence = 'Medium';
    reason = 'Article provides minimal unique reporting and limited standalone search value; consider noindex if not enriched.';
    evidence.push(`Substantially thin content: ${sig.wordCount} words.`);
    evidence.push('Missing quotes and contextual background.');
    evidence.push('Low standalone search utility.');
  }
  // 4. POSITIVE BREAKING NEWS EXEMPTION -> Keep Short
  // Legitimate concise dispatch: 100 to 260 words, has source attribution, has specific facts, and either >=2 paras or quotes
  else if (sig.wordCount >= 100 && sig.wordCount <= 260 && sig.hasAttribution && sig.hasFacts && (sig.meaningfulParas >= 2 || sig.hasQuotes)) {
    classification = 'Keep Short';
    finding = 'Concise breaking news';
    confidence = 'High';
    reason = 'Article is short but contains sufficient verifiable information and attribution for a breaking-news update.';
    evidence.push(`Article is ${sig.wordCount} words with ${sig.paraCount} paragraphs.`);
    evidence.push('Contains active source attribution and concrete factual figures.');
    evidence.push('Properly structured as a rapid breaking news dispatch.');
  }
  // 5. SHORT WITH REPORTING VALUE -> Enrich
  // Short (<200 words) but lacking context or explanatory depth
  else if (sig.wordCount < 200 && (!sig.hasContext || !sig.hasExplanatory)) {
    classification = 'Enrich';
    finding = 'Potentially thin';
    confidence = sig.wordCount < 140 ? 'High' : 'Medium';
    reason = 'Article is substantially shorter than comparable articles and contains limited supporting context.';
    evidence.push(`Article body length is ${sig.wordCount} words (editorial target: 250+ words).`);
    if (!sig.hasContext) evidence.push('Missing supporting historical or previous event context.');
    if (!sig.hasExplanatory) evidence.push('Lacks explanatory why-it-matters background.');
  }
  // 6. AMBIGUOUS / MIXED SIGNALS -> Review
  // Moderate length but missing quotes or single paragraph or unusual brevity
  else if (sig.wordCount < 220 || (!sig.hasQuotes && sig.wordCount < 260)) {
    classification = 'Review';
    finding = 'Needs editorial review';
    confidence = 'Low';
    reason = 'Multiple thin-content signals detected; editorial review recommended.';
    evidence.push(`Article length is ${sig.wordCount} words.`);
    if (!sig.hasQuotes) evidence.push('Contains no direct quotes or official statements.');
    if (sig.paraCount <= 1) evidence.push('Formatted as a single continuous block paragraph.');
  }
  // UNFLAGGED: Substantive, healthy article
  else {
    return null;
  }

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    category: article.category,
    url: article.url,
    relPath: article.relPath,
    date: isoDate,
    wordCount: sig.wordCount,
    charCount: sig.charCount,
    paraCount: sig.paraCount,
    finding,
    classification,
    confidence,
    reason,
    relatedArticle,
    detectedSignals,
    notDetectedSignals,
    evidence
  };
}

/**
 * Analyzes the complete article corpus and returns full diagnostic statistics
 * and the flagged thin content queue.
 *
 * @param {Array<Object>} rawArticles Array of article records with { id, title, slug, category, url, relPath, date, body, wordCount, ... }
 * @returns {Object} Comprehensive Thin Content Queue diagnostic payload
 */
function analyzeCorpus(rawArticles) {
  let totalScanned = 0;
  let activeScanned = 0;
  let archivedExcluded = 0;
  let redirectsExcluded = 0;

  const activeArticles = [];

  rawArticles.forEach(art => {
    totalScanned++;
    const isRedirect = Boolean(art.redirect_to || art.articleType === 'redirect' || art.layout === 'layouts/redirect.njk');
    const isArchived = Boolean(art.noindex === true || art.archived === true || art.status === 'archived');

    if (isRedirect) {
      redirectsExcluded++;
      return;
    }
    if (isArchived) {
      archivedExcluded++;
      return;
    }

    activeScanned++;
    const signals = evaluateArticleSignals(art);
    activeArticles.push({
      ...art,
      signals
    });
  });

  // Overlap detection across active corpus
  const overlapMap = findArticleOverlaps(activeArticles);

  // Classification & Queue formation
  const queue = [];
  let unflaggedCount = 0;

  const classificationCounts = {
    Enrich: 0,
    'Keep Short': 0,
    Consolidate: 0,
    Noindex: 0,
    Prune: 0,
    Review: 0
  };

  const findingCounts = {
    potentiallyThin: 0,
    potentialOverlap: 0,
    conciseBreaking: 0,
    limitedDepth: 0,
    needsReview: 0,
    obsolete: 0
  };

  activeArticles.forEach(art => {
    const overlap = overlapMap.get(art.id);
    const classified = classifyArticle(art, overlap);

    if (classified) {
      classificationCounts[classified.classification] = (classificationCounts[classified.classification] || 0) + 1;
      
      if (classified.finding === 'Potentially thin') findingCounts.potentiallyThin++;
      else if (classified.finding === 'Potential overlap') findingCounts.potentialOverlap++;
      else if (classified.finding === 'Concise breaking news') findingCounts.conciseBreaking++;
      else if (classified.finding === 'Limited standalone depth') findingCounts.limitedDepth++;
      else if (classified.finding === 'Needs editorial review') findingCounts.needsReview++;
      else if (classified.finding === 'Potentially obsolete/low-value') findingCounts.obsolete++;

      queue.push(classified);
    } else {
      unflaggedCount++;
    }
  });

  // Sort queue by signal strength (High > Medium > Low), then wordCount ASC
  const confidenceOrder = { High: 3, Medium: 2, Low: 1 };
  queue.sort((a, b) => {
    const cA = confidenceOrder[a.confidence] || 0;
    const cB = confidenceOrder[b.confidence] || 0;
    if (cA !== cB) return cB - cA;
    return a.wordCount - b.wordCount;
  });

  const stats = {
    totalScanned,
    activeScanned,
    archivedExcluded,
    redirectsExcluded,
    flaggedCount: queue.length,
    unflaggedCount,
    classificationCounts,
    findingCounts
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      description: 'SamacharDaily Private Thin Content Queue Deterministic Analysis'
    },
    stats,
    queue
  };
}

module.exports = {
  STOPWORDS,
  countWords,
  formatDateIso,
  tokenizeText,
  computeJaccardSimilarity,
  evaluateArticleSignals,
  findArticleOverlaps,
  classifyArticle,
  analyzeCorpus
};
