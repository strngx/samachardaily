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
const enrichedSet = new Set([
  'src/articles/tech/apple-iphone-17-pro-max-price-falls-to-rs-74990-at-croma-adds-exchange-bonus-free-cas.md',
  'src/articles/tech/lava-unveils-virat-curve-5g-smartphone-at-19999-launch-price.md',
  'src/articles/business/google-ceo-sundar-pichai-reconnects-with-iit-batchmate-turned-renowned-monk.md',
  'src/articles/business/hfcl-board-approves-820-crore-capex-boost-raising-total-fibre-expansion-spend-to-1800.md',
  'src/articles/tech/apple-iphone-duo-production-slowdown-likely-extends-consumer-wait-times.md',
  'src/articles/tech/google-aligns-with-openai-anthropic-meta-in-public-ai-hack-disclosures.md',
  'src/articles/tech/indias-semiconductor-drive-shifts-to-execution-says-ashwini-vaishnaw.md',
  'src/articles/tech/nvidia-in-funding-talks-for-anthropics-potentially-massive-ipo.md',
  'src/articles/tech/openai-faces-mathematicians-backlash-over-ai-driven-race-to-solve-classic-problems.md',
  'src/articles/business/major-indian-banks-to-close-up-to-four-days-between-sep-1420-2026-per-rbi-holiday-cal.md',
  'src/articles/tech/apple-rolls-out-iphone-duo-foldable-and-iphone-18-pro-max-prices-revealed.md',
  'src/articles/tech/apple-unveils-first-foldable-iphone-duo-targets-october-launch-amid-pro-lineup-reveal.md',
  'src/articles/business/maruti-upgrades-baleno-with-new-engine-level2-adas-i20-altroz-remain-strong-rivals.md',
  'src/articles/business/karpacz-economic-forum-2026-highlights-polands-growth-political-rift-and-v4-outlook.md',
  'src/articles/india/amit-shah-hails-pm-modis-25-year-public-record-launches-seva-sankalp-abhiyan.md',
  'src/articles/india/indian-consul-in-shanghai-praises-peking-scholars-leads-tagore-bust-cleaning.md',
  'src/articles/tech/cathie-wood-shifts-287-million-from-alphabet-to-meta-as-ai-focus-intensifies.md',
  'src/articles/tech/trump-announces-plans-for-new-ai-force-agency-and-upcoming-ai-czar.md',
  'src/articles/tech/amazon-launches-alexa-in-india-with-early-access-hindihinglish-support-and-ai-feature.md',
  'src/articles/tech/apple-rolls-out-ios-27-with-revamped-siri-and-ai-upgrades-ahead-of-iphone-18-launch.md',
  'src/articles/tech/trump-labels-ai-data-centers-oil-of-next-50-years-blames-google-for-misplaced-project.md',
  'src/articles/business/cpsc-orders-recall-of-hundreds-of-thousands-of-amazon-fingerlight-toys-over-battery-s.md',
  'src/articles/business/gcrta-stalls-service-cuts-until-2027-election-amid-taxincrease-debate.md'
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
const currentSub150 = [];

allFiles.forEach(file => {
  const relPath = file.replace(/\\/g, '/');
  if (relPath.includes('_quarantine-commercial')) return;
  const content = fs.readFileSync(file, 'utf8');
  const parsed = matter(content);
  const data = parsed.data;
  const body = parsed.content.trim();
  const bodyWords = body ? body.split(/\s+/).filter(Boolean).length : 0;
  
  const isNoindex = data.noindex === true || data.noindex === 'true' || 
                    data.draft === true || data.draft === 'true' || 
                    (data.robots && (data.robots.includes('noindex') || data.robots === 'noindex'));
  if (isNoindex) return;

  if (bodyWords < 150) {
    const p2cItem = p2cMap.get(relPath);
    const p0Item = p0Matrix.get(relPath);
    
    currentSub150.push({
      path: relPath,
      title: data.title || '',
      category: data.category || '',
      date: data.date || '',
      slug: data.slug || path.basename(file, '.md'),
      bodyWords,
      p2cClassification: p2cItem ? p2cItem.classification : null,
      p2cPriority: p2cItem ? p2cItem.priority : null,
      p2cReason: p2cItem ? p2cItem.reason : null,
      isP0InMatrix: !!p0Item,
      p0MatrixItem: p0Item || null
    });
  }
});

console.log(`Current sub-150 count: ${currentSub150.length}`);

// Group by Classification
const summary = {
  A: { P0: 0, P1: 0, P2: 0, total: 0 },
  B: 0,
  C: 0,
  D: 0,
  E: 0,
  unmatched: 0
};

currentSub150.forEach(art => {
  if (!art.p2cClassification) {
    summary.unmatched++;
    console.log('Unmatched article:', art.path);
    return;
  }
  if (art.p2cClassification === 'A') {
    summary.A.total++;
    if (art.p2cPriority === 'P0') summary.A.P0++;
    else if (art.p2cPriority === 'P1') summary.A.P1++;
    else if (art.p2cPriority === 'P2') summary.A.P2++;
  } else if (art.p2cClassification === 'B') {
    summary.B++;
  } else if (art.p2cClassification === 'C') {
    summary.C++;
  } else if (art.p2cClassification === 'D') {
    summary.D++;
  } else if (art.p2cClassification === 'E') {
    summary.E++;
  }
});

console.log('\n--- Classification of Remaining 330 Sub-150 Articles ---');
console.log(JSON.stringify(summary, null, 2));

// Remaining P0 candidates
const remainingP0 = currentSub150.filter(a => a.p2cClassification === 'A' && a.p2cPriority === 'P0');
console.log(`\nRemaining P0 Candidates (${remainingP0.length}):`);
remainingP0.forEach((art, idx) => {
  console.log(`${idx+1}. [${art.category}] ${art.title} (${art.bodyWords}w) -> ${art.path}`);
});
