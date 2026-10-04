/**
 * Samachar Daily — Deterministic Build-Time Related Stories Engine
 * 
 * Computes topically related stories for every active article during Eleventy build:
 * - Uses inverted index token matching across title and dek metadata.
 * - Multi-signal scoring: Title tokens (+30), Consecutive phrases (+40),
 *   Cross Title/Dek (+15), Dek tokens (+6), Category bonus (+15), Recency (+15/+8/+3).
 * - Cluster de-duplication: Title Jaccard > 0.70 filters near-duplicates.
 * - Strict safety: excludes noindex, redirects, drafts, archived, future, and self-links.
 * - Minimum relevance threshold: 35 points. NO weak backfill. Maximum 4 stories.
 * - 100% deterministic: score desc -> date desc -> slug asc.
 * - 0 runtime JS, 0 API calls, 0 AI calls, 0 database queries.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'by', 'at', 'from',
  'this', 'that', 'an', 'a', 'as', 'it', 'its', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'or', 'into', 'over', 'after', 'new', 'latest', 'today',
  'said', 'report', 'reports', 'news', 'amid', 'ahead', 'after', 'says', 'will',
  'how', 'what', 'why', 'who', 'when', 'where', 'which', 'about', 'more', 'all',
  'first', 'second', 'third', 'day', 'days', 'week', 'weeks', 'month', 'year', 'years'
]);

// Keep high-value short acronyms/entities that would otherwise be rejected by length check
const SHORT_ENTITIES = new Set([
  'ai', 'us', 'uk', 'eu', 'un', 'pm', 'cm', 'bjp', 'aap', 'rbi', 'ipo', 't20', 'odi'
]);

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => (t.length > 2 || SHORT_ENTITIES.has(t)) && !STOPWORDS.has(t));
}

function hasConsecutivePhrase(tokensA, tokensB) {
  if (!tokensA || !tokensB || tokensA.length < 2 || tokensB.length < 2) return false;
  const setB = new Set();
  for (let i = 0; i < tokensB.length - 1; i++) {
    setB.add(tokensB[i] + ' ' + tokensB[i + 1]);
  }
  for (let i = 0; i < tokensA.length - 1; i++) {
    if (setB.has(tokensA[i] + ' ' + tokensA[i + 1])) {
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

function getMarkdownFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        results = results.concat(getMarkdownFiles(full));
      } else if (ent.name.endsWith('.md')) {
        results.push(full);
      }
    }
  } catch (err) {
    console.error('[RelatedStories] Directory read error:', err.message);
  }
  return results;
}

module.exports = function () {
  const startTime = Date.now();
  const articlesDir = path.resolve(__dirname, '../articles');
  if (!fs.existsSync(articlesDir)) {
    console.warn('[RelatedStories] Articles directory not found:', articlesDir);
    return {};
  }

  const files = getMarkdownFiles(articlesDir);
  const now = Date.now();
  const articles = [];

  const buf = Buffer.alloc(4096);

  for (const f of files) {
    let headerStr = '';
    try {
      const fd = fs.openSync(f, 'r');
      const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      headerStr = buf.toString('utf8', 0, bytesRead);
    } catch (e) {
      continue;
    }

    const match = headerStr.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;

    let data = null;
    try {
      data = yaml.load(match[1]);
    } catch (e) {
      continue;
    }

    if (!data || typeof data !== 'object') continue;

    // Safety & Eligibility Exclusions
    if (data.noindex === true) continue;
    if (data.redirect_to || data.redirect) continue;
    if (data.draft === true || data.archived === true) continue;
    if (!data.title || typeof data.title !== 'string') continue;

    const relPath = path.relative(articlesDir, f).replace(/\\/g, '/');
    const parts = relPath.split('/');
    const catSlug = (parts[0] || (data.category || 'india')).toLowerCase().trim();
    const slug = data.slug || path.basename(f, '.md');
    const url = `/articles/${catSlug}/${slug}/`;

    const d = data.date ? new Date(data.date) : null;
    const time = d && !isNaN(d.getTime()) ? d.getTime() : 0;
    if (time > now + 3600000) continue; // Future article protection

    const titleTokensArr = tokenize(data.title);
    const dekTokensArr = tokenize(data.dek);

    articles.push({
      url,
      slug,
      title: data.title.trim(),
      dek: (data.dek || '').trim(),
      category: (data.category || catSlug).trim(),
      catSlug,
      date: time,
      dateIso: d ? d.toISOString() : '',
      image: data.image || '',
      imageAlt: data.imageAlt || data.image_alt || data.title,
      titleTokensArr,
      dekTokensArr,
      titleTokens: new Set(titleTokensArr),
      dekTokens: new Set(dekTokensArr)
    });
  }

  // Build Inverted Index: token -> Array of article indices
  const invertedIndex = new Map();
  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const combinedTokens = new Set([...art.titleTokens, ...art.dekTokens]);
    for (const token of combinedTokens) {
      let list = invertedIndex.get(token);
      if (!list) {
        list = [];
        invertedIndex.set(token, list);
      }
      list.push(i);
    }
  }

  const MS_DAY = 86400000;
  const resultMap = {};

  // Compute Related Stories for each active article
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];

    // Gather candidate article indices from shared title and dek tokens
    const candidateIndices = new Set();
    for (const token of a.titleTokens) {
      const matches = invertedIndex.get(token);
      if (matches) {
        for (let k = 0; k < matches.length; k++) {
          if (matches[k] !== i) candidateIndices.add(matches[k]);
        }
      }
    }
    for (const token of a.dekTokens) {
      const matches = invertedIndex.get(token);
      if (matches) {
        for (let k = 0; k < matches.length; k++) {
          if (matches[k] !== i) candidateIndices.add(matches[k]);
        }
      }
    }

    const scored = [];

    for (const candIdx of candidateIndices) {
      const b = articles[candIdx];

      // Multi-guard Self-reference protection
      if (b.url === a.url || b.slug === a.slug) continue;

      let score = 0;

      // 1. Shared Title Tokens (+30 each)
      let sharedTitle = 0;
      for (const t of a.titleTokens) {
        if (b.titleTokens.has(t)) sharedTitle++;
      }
      score += sharedTitle * 30;

      // 2. Whole Phrase Match Bonus (+40)
      if (hasConsecutivePhrase(a.titleTokensArr, b.titleTokensArr)) {
        score += 40;
      }

      // 3. Cross Title/Dek Tokens (+15 each)
      let crossTitleDek = 0;
      for (const t of a.titleTokens) {
        if (b.dekTokens.has(t)) crossTitleDek++;
      }
      for (const t of b.titleTokens) {
        if (a.dekTokens.has(t)) crossTitleDek++;
      }
      score += crossTitleDek * 15;

      // 4. Shared Dek Tokens (+6 each)
      let sharedDek = 0;
      for (const t of a.dekTokens) {
        if (b.dekTokens.has(t)) sharedDek++;
      }
      score += sharedDek * 6;

      // 5. Category Bonus (+15)
      if (a.catSlug === b.catSlug) {
        score += 15;
      }

      // 6. Recency Bonus (relative to article A's publication date)
      if (a.date && b.date) {
        const diffDays = Math.abs(a.date - b.date) / MS_DAY;
        if (diffDays <= 7) score += 15;
        else if (diffDays <= 30) score += 8;
        else if (diffDays <= 90) score += 3;
      }

      // Minimum score threshold: >= 35 points
      if (score >= 35) {
        scored.push({
          art: b,
          score
        });
      }
    }

    // Deterministic Sort:
    // 1. score descending
    // 2. date descending
    // 3. slug ascending
    scored.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      if (y.art.date !== x.art.date) return y.art.date - x.art.date;
      return x.art.slug.localeCompare(y.art.slug);
    });

    // De-duplicate near-identical clusters (Title Jaccard > 0.70)
    const accepted = [];
    for (let s = 0; s < scored.length; s++) {
      if (accepted.length >= 4) break;
      const candidate = scored[s];
      let isNearDuplicate = false;
      for (let accIdx = 0; accIdx < accepted.length; accIdx++) {
        if (jaccardSimilarity(candidate.art.titleTokens, accepted[accIdx].art.titleTokens) > 0.70) {
          isNearDuplicate = true;
          break;
        }
      }
      if (!isNearDuplicate) {
        accepted.push(candidate);
      }
    }

    // Compact output data for Nunjucks template (0 excess body/metadata)
    resultMap[a.url] = accepted.map(item => ({
      url: item.art.url,
      title: item.art.title,
      dek: item.art.dek,
      category: item.art.category,
      date: item.art.dateIso,
      image: item.art.image,
      imageAlt: item.art.imageAlt,
      score: item.score
    }));
  }

  const duration = Date.now() - startTime;
  console.log(`[RelatedStories] Computed similarity graph for ${articles.length} articles in ${duration}ms (0 AI calls)`);

  return resultMap;
};
