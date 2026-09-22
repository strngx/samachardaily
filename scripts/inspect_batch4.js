const fs = require('fs');

const data = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const matrix = data.articles;
console.log('Total entries in matrix:', matrix.length);

const excluded = new Set([
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
  'src/articles/business/karpacz-economic-forum-2026-highlights-polands-growth-political-rift-and-v4-outlook.md',
  'src/articles/india/amit-shah-hails-pm-modis-25-year-public-record-launches-seva-sankalp-abhiyan.md',
  'src/articles/india/indian-consul-in-shanghai-praises-peking-scholars-leads-tagore-bust-cleaning.md',
  'src/articles/tech/cathie-wood-shifts-287-million-from-alphabet-to-meta-as-ai-focus-intensifies.md',
  'src/articles/tech/trump-announces-plans-for-new-ai-force-agency-and-upcoming-ai-czar.md'
]);

const eligible = matrix.filter(item => !excluded.has(item.path));
console.log('Eligible remaining P0 items:', eligible.length);

const batch4 = eligible.slice(0, 5);
batch4.forEach((item, idx) => {
  console.log(`\n========================================`);
  console.log(`--- Candidate ${idx+1} ---`);
  console.log('Path:', item.path);
  console.log('Title:', item.title);
  console.log('Date:', item.publication_timestamp);
  console.log('Words:', item.current_body_words);
  console.log('Intent:', item.intent);
  console.log('Sources:', JSON.stringify(item.source_verification, null, 2));
  console.log('Proposed Additions:', JSON.stringify(item.proposed_additions, null, 2));
});
