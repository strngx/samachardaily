const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// Read Phase 2C clean evaluated thin map
const scratchClean = path.join('C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch\\clean_evaluated_thin.json');
const p2cEvaluated = JSON.parse(fs.readFileSync(scratchClean, 'utf8'));
const p2cMap = new Map();
p2cEvaluated.forEach(item => {
  p2cMap.set(item.file, item);
});

// Read P0 Matrix
const p0MatrixData = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const p0Matrix = new Map();
(p0MatrixData.articles || []).forEach(art => {
  p0Matrix.set(art.path, art);
});

// Enriched files
const enrichedMap = new Map([
  ['src/articles/tech/apple-iphone-17-pro-max-price-falls-to-rs-74990-at-croma-adds-exchange-bonus-free-cas.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/tech/lava-unveils-virat-curve-5g-smartphone-at-19999-launch-price.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/business/google-ceo-sundar-pichai-reconnects-with-iit-batchmate-turned-renowned-monk.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/business/hfcl-board-approves-820-crore-capex-boost-raising-total-fibre-expansion-spend-to-1800.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/tech/apple-iphone-duo-production-slowdown-likely-extends-consumer-wait-times.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/tech/google-aligns-with-openai-anthropic-meta-in-public-ai-hack-disclosures.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/indias-semiconductor-drive-shifts-to-execution-says-ashwini-vaishnaw.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/nvidia-in-funding-talks-for-anthropics-potentially-massive-ipo.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/openai-faces-mathematicians-backlash-over-ai-driven-race-to-solve-classic-problems.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/business/major-indian-banks-to-close-up-to-four-days-between-sep-1420-2026-per-rbi-holiday-cal.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/apple-rolls-out-iphone-duo-foldable-and-iphone-18-pro-max-prices-revealed.md', 'Phase 2B-2D (Apple)'],
  ['src/articles/tech/apple-unveils-first-foldable-iphone-duo-targets-october-launch-amid-pro-lineup-reveal.md', 'Phase 2B-2D (Apple)'],
  ['src/articles/business/maruti-upgrades-baleno-with-new-engine-level2-adas-i20-altroz-remain-strong-rivals.md', 'Phase 2B-2H (Baleno)'],
  ['src/articles/business/karpacz-economic-forum-2026-highlights-polands-growth-political-rift-and-v4-outlook.md', 'Phase 6A Batch 3'],
  ['src/articles/india/amit-shah-hails-pm-modis-25-year-public-record-launches-seva-sankalp-abhiyan.md', 'Phase 6A Batch 3'],
  ['src/articles/india/indian-consul-in-shanghai-praises-peking-scholars-leads-tagore-bust-cleaning.md', 'Phase 6A Batch 3'],
  ['src/articles/tech/cathie-wood-shifts-287-million-from-alphabet-to-meta-as-ai-focus-intensifies.md', 'Phase 6A Batch 3'],
  ['src/articles/tech/trump-announces-plans-for-new-ai-force-agency-and-upcoming-ai-czar.md', 'Phase 6A Batch 3'],
  ['src/articles/tech/amazon-launches-alexa-in-india-with-early-access-hindihinglish-support-and-ai-feature.md', 'Phase 6B Batch 4'],
  ['src/articles/tech/apple-rolls-out-ios-27-with-revamped-siri-and-ai-upgrades-ahead-of-iphone-18-launch.md', 'Phase 6B Batch 4'],
  ['src/articles/tech/trump-labels-ai-data-centers-oil-of-next-50-years-blames-google-for-misplaced-project.md', 'Phase 6B Batch 4'],
  ['src/articles/business/cpsc-orders-recall-of-hundreds-of-thousands-of-amazon-fingerlight-toys-over-battery-s.md', 'Phase 6B Batch 4'],
  ['src/articles/business/gcrta-stalls-service-cuts-until-2027-election-amid-taxincrease-debate.md', 'Phase 6B Batch 4']
]);

function getFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (file.endsWith('.md')) {
      results.push(fullPath);
    }
  });
  return results;
}

const allFiles = getFiles('src/articles');
const quarantineFiles = getFiles('src/articles/_quarantine-commercial');

const allArticles = [];
let indexableCount = 0;
let noindexCount = 0;
let quarantinedCount = quarantineFiles.length;

allFiles.forEach(file => {
  const relPath = file.replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const parsed = matter(content);
  const data = parsed.data;
  const body = parsed.content.trim();
  const bodyWords = body ? body.split(/\s+/).filter(Boolean).length : 0;
  
  const isQuarantined = relPath.includes('_quarantine-commercial');
  const isNoindex = data.noindex === true || data.noindex === 'true' || 
                    data.draft === true || data.draft === 'true' || 
                    (data.robots && (data.robots.includes('noindex') || data.robots === 'noindex'));
  const isIndexable = !isQuarantined && !isNoindex;

  if (isIndexable) indexableCount++;
  else if (!isQuarantined && isNoindex) noindexCount++;

  const p2cItem = p2cMap.get(relPath);
  const p0Item = p0Matrix.get(relPath);

  let classification = p2cItem ? p2cItem.classification : 'B';
  let priority = null;
  if (classification === 'A') {
    if (p0Item) {
      priority = 'P0';
    } else if (p2cItem && p2cItem.score && p2cItem.score.tier) {
      priority = p2cItem.score.tier;
    } else {
      priority = 'P1';
    }
  }

  allArticles.push({
    path: relPath,
    title: data.title || '',
    seoTitle: data.seoTitle || '',
    category: data.category || '',
    date: data.date || '',
    slug: data.slug || path.basename(file, '.md'),
    video_id: data.video_id || '',
    hasVideo: !!(data.video_id || (data.videos && data.videos.length > 0)),
    isIndexable,
    isNoindex,
    isQuarantined,
    bodyWords,
    enrichedInPhase: enrichedMap.get(relPath) || null,
    isEnriched: enrichedMap.has(relPath),
    classification,
    priority,
    reason: p2cItem ? p2cItem.reason : 'Short breaking news dispatch',
    p0MatrixItem: p0Item || null
  });
});

const indexableArticles = allArticles.filter(a => a.isIndexable);
const under150Articles = indexableArticles.filter(a => a.bodyWords < 150);

// Metrics
const metrics = {
  total_articles: allArticles.length,
  indexable_articles: indexableArticles.length,
  noindex_articles: noindexCount,
  quarantined_articles: quarantinedCount,
  under_100: indexableArticles.filter(a => a.bodyWords < 100).length,
  under_150: under150Articles.length,
  w150_199: indexableArticles.filter(a => a.bodyWords >= 150 && a.bodyWords < 200).length,
  w200_299: indexableArticles.filter(a => a.bodyWords >= 200 && a.bodyWords < 300).length,
  w300_499: indexableArticles.filter(a => a.bodyWords >= 300 && a.bodyWords < 500).length,
  w500_plus: indexableArticles.filter(a => a.bodyWords >= 500).length,
  already_enriched: enrichedMap.size,
  priority_p0: under150Articles.filter(a => a.classification === 'A' && a.priority === 'P0').length,
  priority_p1: under150Articles.filter(a => a.classification === 'A' && a.priority === 'P1').length,
  priority_p2: under150Articles.filter(a => a.classification === 'A' && a.priority === 'P2').length,
  legitimate_short_news: under150Articles.filter(a => a.classification === 'B').length,
  low_value: under150Articles.filter(a => a.classification === 'C').length,
  duplication: under150Articles.filter(a => a.classification === 'D').length,
  manual_review: under150Articles.filter(a => a.classification === 'E').length
};

fs.writeFileSync('PHASE_6C_METRICS.json', JSON.stringify(metrics, null, 2), 'utf8');
console.log('Saved PHASE_6C_METRICS.json');

// Build CSV
// Columns: priority,classification,file_path,slug,category,publication_date,body_word_count,title,reason,source_status,cannibalization_status,recommended_action
function escapeCsv(str) {
  if (!str) return '""';
  const escaped = String(str).replace(/"/g, '""');
  return `"${escaped}"`;
}

const csvHeader = 'priority,classification,file_path,slug,category,publication_date,body_word_count,title,reason,source_status,cannibalization_status,recommended_action\n';

const csvRows = under150Articles.map(a => {
  const priority = a.priority || '';
  const classification = a.classification || 'B';
  const filePath = a.path;
  const slug = a.slug;
  const category = a.category;
  const pubDate = a.date instanceof Date ? a.date.toISOString() : String(a.date);
  const wordCount = a.bodyWords;
  const title = a.title;
  const reason = a.reason || '';
  
  let sourceStatus = 'N/A';
  if (classification === 'A') {
    sourceStatus = (priority === 'P0' && a.p0MatrixItem) ? 'SOURCE EVIDENCE ALREADY PRESENT' : 'SOURCE VERIFICATION REQUIRED';
  }

  const cannibalizationStatus = classification === 'D' ? 'CANNIBALIZATION RISK' : 'NONE';
  
  let recAction = 'KEEP_AS_IS';
  if (classification === 'A') {
    recAction = `ENRICH_${priority}`;
  } else if (classification === 'B') {
    recAction = 'MAINTAIN_SHORT_NEWS';
  } else if (classification === 'C') {
    recAction = 'LOW_PRIORITY_MAINTAIN';
  } else if (classification === 'D') {
    recAction = 'CANNIBALIZATION_MANAGEMENT';
  } else if (classification === 'E') {
    recAction = 'EDITORIAL_MANUAL_REVIEW';
  }

  return [
    escapeCsv(priority),
    escapeCsv(classification),
    escapeCsv(filePath),
    escapeCsv(slug),
    escapeCsv(category),
    escapeCsv(pubDate),
    wordCount,
    escapeCsv(title),
    escapeCsv(reason),
    escapeCsv(sourceStatus),
    escapeCsv(cannibalizationStatus),
    escapeCsv(recAction)
  ].join(',');
});

fs.writeFileSync('PHASE_6C_REMAINING_PRIORITY_QUEUE.csv', csvHeader + csvRows.join('\n'), 'utf8');
console.log(`Saved PHASE_6C_REMAINING_PRIORITY_QUEUE.csv with ${csvRows.length} rows`);
