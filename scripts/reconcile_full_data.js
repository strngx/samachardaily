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

// All 23 Enriched files
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
const allArticles = [];

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

  const p2cItem = p2cMap.get(relPath);
  const p0Item = p0Matrix.get(relPath);

  let classification = p2cItem ? p2cItem.classification : 'B';
  let priority = null;
  if (classification === 'A') {
    priority = (p2cItem && p2cItem.score && p2cItem.score.tier) ? p2cItem.score.tier : (p0Item ? 'P0' : 'P1');
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

console.log(`Total Articles: ${allArticles.length}`);
console.log(`Indexable Articles: ${indexableArticles.length}`);
console.log(`Total Under 150 Words: ${under150Articles.length}`);

// Classifications of remaining under-150 articles
const classCounts = {
  A: { P0: 0, P1: 0, P2: 0, total: 0 },
  B: 0,
  C: 0,
  D: 0,
  E: 0
};

under150Articles.forEach(a => {
  if (a.classification === 'A') {
    classCounts.A.total++;
    if (a.priority === 'P0') classCounts.A.P0++;
    else if (a.priority === 'P1') classCounts.A.P1++;
    else if (a.priority === 'P2') classCounts.A.P2++;
  } else if (a.classification === 'B') classCounts.B++;
  else if (a.classification === 'C') classCounts.C++;
  else if (a.classification === 'D') classCounts.D++;
  else if (a.classification === 'E') classCounts.E++;
});

console.log('Class Counts:', classCounts);

// Remaining P0 candidates
const remainingP0 = under150Articles.filter(a => a.classification === 'A' && a.priority === 'P0');
console.log(`\nRemaining P0 Articles (${remainingP0.length}):`);
remainingP0.forEach((a, i) => {
  console.log(`${i+1}. [${a.category}] ${a.title} (${a.bodyWords}w) -> ${a.path}`);
  if (a.p0MatrixItem) {
    console.log(`   Source Verified: YES (${a.p0MatrixItem.source_verification.sources[0]?.name || 'Verified'})`);
  } else {
    console.log(`   Source Verified: REQUIRED`);
  }
});
