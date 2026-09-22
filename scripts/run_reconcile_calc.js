const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const scratchClean = path.join('C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch\\clean_evaluated_thin.json');
const p2cEvaluated = JSON.parse(fs.readFileSync(scratchClean, 'utf8'));

console.log('Total original Phase 2C evaluated articles:', p2cEvaluated.length);

const p0MatrixData = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const p0Matrix = new Set((p0MatrixData.articles || []).map(a => a.path));

// All 23 enriched files
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

// Check each of the 360 Phase 2C evaluated articles
let remainingIndexableUnder150 = [];
let enrichedCount = 0;
let nowNoindexCount = 0;
let nowAbove150Count = 0;

p2cEvaluated.forEach(item => {
  const filePath = item.file;
  if (!fs.existsSync(filePath)) {
    console.log('File does not exist:', filePath);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(content);
  const data = parsed.data;
  const body = parsed.content.trim();
  const currentWords = body ? body.split(/\s+/).filter(Boolean).length : 0;
  
  const isNoindex = data.noindex === true || data.noindex === 'true' || 
                    data.draft === true || data.draft === 'true' || 
                    (data.robots && (data.robots.includes('noindex') || data.robots === 'noindex'));

  if (isNoindex) {
    nowNoindexCount++;
    return;
  }

  if (enrichedMap.has(filePath)) {
    enrichedCount++;
    return;
  }

  if (currentWords >= 150) {
    nowAbove150Count++;
    console.log('Now above 150 (not in enriched list?):', filePath, currentWords);
    return;
  }

  // Determine priority
  let priority = item.score?.tier || 'P1';
  if (p0Matrix.has(filePath)) {
    priority = 'P0';
  }

  remainingIndexableUnder150.push({
    ...item,
    currentWords,
    priority
  });
});

console.log('\n--- Reconciliation of Phase 2C 360 Candidates ---');
console.log(`Original Phase 2C candidates: ${p2cEvaluated.length}`);
console.log(`Enriched and now >=150 words: ${enrichedCount}`);
console.log(`Noindexed/quarantined since Phase 2C: ${nowNoindexCount}`);
console.log(`Remaining indexable under 150 words: ${remainingIndexableUnder150.length}`);

// Group remaining by classification
const remainingSummary = {
  A: { P0: 0, P1: 0, P2: 0, total: 0 },
  B: 0,
  C: 0,
  D: 0,
  E: 0
};

remainingIndexableUnder150.forEach(art => {
  if (art.classification === 'A') {
    remainingSummary.A.total++;
    if (art.priority === 'P0') remainingSummary.A.P0++;
    else if (art.priority === 'P1') remainingSummary.A.P1++;
    else if (art.priority === 'P2') remainingSummary.A.P2++;
  } else if (art.classification === 'B') remainingSummary.B++;
  else if (art.classification === 'C') remainingSummary.C++;
  else if (art.classification === 'D') remainingSummary.D++;
  else if (art.classification === 'E') remainingSummary.E++;
});

console.log('\nRemaining Summary Breakdown:');
console.log(JSON.stringify(remainingSummary, null, 2));
