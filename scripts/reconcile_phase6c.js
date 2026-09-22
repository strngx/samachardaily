const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// 1. Gather all markdown files in src/articles
function getFiles(dir) {
  let results = [];
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

const allArticlePaths = getFiles('src/articles');
console.log('Total articles found:', allArticlePaths.length);

// Also check if any quarantined directory exists
let quarantinedPaths = [];
if (fs.existsSync('quarantine')) {
  quarantinedPaths = getFiles('quarantine');
}
console.log('Total quarantined articles found:', quarantinedPaths.length);

// Enriched articles list across all previous phases
const enrichedFiles = new Map([
  // Phase 2C-2 Batch 1
  ['src/articles/tech/apple-iphone-17-pro-max-price-falls-to-rs-74990-at-croma-adds-exchange-bonus-free-cas.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/tech/lava-unveils-virat-curve-5g-smartphone-at-19999-launch-price.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/business/google-ceo-sundar-pichai-reconnects-with-iit-batchmate-turned-renowned-monk.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/business/hfcl-board-approves-820-crore-capex-boost-raising-total-fibre-expansion-spend-to-1800.md', 'Phase 2C-2 Batch 1'],
  ['src/articles/tech/apple-iphone-duo-production-slowdown-likely-extends-consumer-wait-times.md', 'Phase 2C-2 Batch 1'],
  // Phase 2C-2 Batch 2
  ['src/articles/tech/google-aligns-with-openai-anthropic-meta-in-public-ai-hack-disclosures.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/indias-semiconductor-drive-shifts-to-execution-says-ashwini-vaishnaw.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/nvidia-in-funding-talks-for-anthropics-potentially-massive-ipo.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/tech/openai-faces-mathematicians-backlash-over-ai-driven-race-to-solve-classic-problems.md', 'Phase 2C-2 Batch 2'],
  ['src/articles/business/major-indian-banks-to-close-up-to-four-days-between-sep-1420-2026-per-rbi-holiday-cal.md', 'Phase 2C-2 Batch 2'],
  // Phase 2B-2D (Apple Thin Content)
  ['src/articles/tech/apple-rolls-out-iphone-duo-foldable-and-iphone-18-pro-max-prices-revealed.md', 'Phase 2B-2D'],
  ['src/articles/tech/apple-unveils-first-foldable-iphone-duo-targets-october-launch-amid-pro-lineup-reveal.md', 'Phase 2B-2D'],
  // Phase 2B-2H (Baleno Thin Content)
  ['src/articles/business/maruti-upgrades-baleno-with-new-engine-level2-adas-i20-altroz-remain-strong-rivals.md', 'Phase 2B-2H'],
  // Phase 6A Batch 3
  ['src/articles/business/karpacz-economic-forum-2026-highlights-polands-growth-political-rift-and-v4-outlook.md', 'Phase 6A Batch 3'],
  ['src/articles/india/amit-shah-hails-pm-modis-25-year-public-record-launches-seva-sankalp-abhiyan.md', 'Phase 6A Batch 3'],
  ['src/articles/india/indian-consul-in-shanghai-praises-peking-scholars-leads-tagore-bust-cleaning.md', 'Phase 6A Batch 3'],
  ['src/articles/tech/cathie-wood-shifts-287-million-from-alphabet-to-meta-as-ai-focus-intensifies.md', 'Phase 6A Batch 3'],
  ['src/articles/tech/trump-announces-plans-for-new-ai-force-agency-and-upcoming-ai-czar.md', 'Phase 6A Batch 3'],
  // Phase 6B Batch 4
  ['src/articles/tech/amazon-launches-alexa-in-india-with-early-access-hindihinglish-support-and-ai-feature.md', 'Phase 6B Batch 4'],
  ['src/articles/tech/apple-rolls-out-ios-27-with-revamped-siri-and-ai-upgrades-ahead-of-iphone-18-launch.md', 'Phase 6B Batch 4'],
  ['src/articles/tech/trump-labels-ai-data-centers-oil-of-next-50-years-blames-google-for-misplaced-project.md', 'Phase 6B Batch 4'],
  ['src/articles/business/cpsc-orders-recall-of-hundreds-of-thousands-of-amazon-fingerlight-toys-over-battery-s.md', 'Phase 6B Batch 4'],
  ['src/articles/business/gcrta-stalls-service-cuts-until-2027-election-amid-taxincrease-debate.md', 'Phase 6B Batch 4']
]);

// Read Phase 2C-1A matrix to cross-reference P0 items & evidence
let p0Matrix = new Map();
if (fs.existsSync('phase_2c1a_p0_evidence_matrix.json')) {
  const mData = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
  (mData.articles || []).forEach(art => {
    p0Matrix.set(art.path, art);
  });
}

// Read Phase 2C audit if present
let phase2cClassifications = new Map();
// Parse markdown or existing json/csv if available
