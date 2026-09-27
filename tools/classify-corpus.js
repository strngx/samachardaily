const fs = require('fs');
const path = require('path');

const articlesDir = path.join(__dirname, '../src/articles');

function getAllArticleFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllArticleFiles(fullPath));
    } else if (file.endsWith('.md')) {
      results.push(fullPath);
    }
  });
  return results;
}

const files = getAllArticleFiles(articlesDir);

const taxonomyCounts = {
  cat1_retain_as_is: 0,
  cat2_high_value_core: 0,
  cat3_needs_review_enrichment: 0,
  cat4_thin_needs_pruning_rewrite: 0,
  cat5_historical_archive: 0
};

const categorizedArticles = {
  cat1_retain_as_is: [],
  cat2_high_value_core: [],
  cat3_needs_review_enrichment: [],
  cat4_thin_needs_pruning_rewrite: [],
  cat5_historical_archive: []
};

files.forEach(fp => {
  const content = fs.readFileSync(fp, 'utf8');
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!frontmatterMatch) return;

  const fmLines = frontmatterMatch[1].split('\n');
  const body = frontmatterMatch[2] || '';
  const words = body.replace(/<[^>]*>?/gm, '').trim().split(/\s+/).filter(Boolean).length;

  const fm = {};
  fmLines.forEach(l => {
    const idx = l.indexOf(':');
    if (idx > 0) {
      const k = l.substring(0, idx).trim();
      const v = l.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
      fm[k] = v;
    }
  });

  const title = fm.title || path.basename(fp);
  const dateStr = fm.date || '';
  const dateObj = new Date(dateStr);
  const year = dateObj.getFullYear();
  const source = fm.sourceName || fm.sourceUrl || '';
  const relPath = path.relative(path.join(__dirname, '..'), fp).replace(/\\/g, '/');

  let category = 'cat1_retain_as_is';
  let reason = '';

  if (year < 2025) {
    category = 'cat5_historical_archive';
    reason = `Published in ${year}, retained for historical archive record`;
  } else if (words < 160 || (!source && words < 200)) {
    category = 'cat4_thin_needs_pruning_rewrite';
    reason = `Thin wire brief (${words} words)${!source ? ', lacks source attribution' : ''}`;
  } else if (words >= 350 || fm.humanReviewed === 'true' || fm.corroborationStatus === 'corroborated' || (fm.why_it_matters && words >= 300)) {
    category = 'cat2_high_value_core';
    reason = `Substantive depth (${words} words)${fm.humanReviewed === 'true' ? ', human reviewed' : ''}`;
  } else if (words >= 160 && words < 220) {
    category = 'cat3_needs_review_enrichment';
    reason = `Moderate brevity (${words} words), candidate for second-source enrichment`;
  } else {
    category = 'cat1_retain_as_is';
    reason = `Standard wire report (${words} words), sourced and structured`;
  }

  taxonomyCounts[category]++;
  categorizedArticles[category].push({
    title,
    path: relPath,
    words,
    year,
    source,
    reason
  });
});

console.log('=== 1,255 ARTICLE CORPUS EDITORIAL TAXONOMY ===');
console.log(`Total Articles Analyzed: ${files.length}`);
console.log(`Category 1 — Retain As-Is: ${taxonomyCounts.cat1_retain_as_is}`);
console.log(`Category 2 — High Value / Core Coverage: ${taxonomyCounts.cat2_high_value_core}`);
console.log(`Category 3 — Needs Review / Needs Enrichment: ${taxonomyCounts.cat3_needs_review_enrichment}`);
console.log(`Category 4 — Thin / Low Quality / Needs Pruning or Rewrite: ${taxonomyCounts.cat4_thin_needs_pruning_rewrite}`);
console.log(`Category 5 — Historical / Archive Only: ${taxonomyCounts.cat5_historical_archive}`);

// Save classification manifest for editorial dashboard and report
fs.writeFileSync(
  path.join(__dirname, '../src/_data/corpusTaxonomy.json'),
  JSON.stringify({
    total: files.length,
    counts: taxonomyCounts,
    timestamp: new Date().toISOString()
  }, null, 2)
);

console.log('\nSaved taxonomy stats to src/_data/corpusTaxonomy.json');
