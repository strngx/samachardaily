const fs = require('fs');

const p0MatrixData = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const p0List = p0MatrixData.articles || [];

console.log('Total articles in Phase 2C-1A matrix:', p0List.length);

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

const remainingInMatrix = p0List.filter(item => !enrichedSet.has(item.path));
console.log(`Remaining in P0 Matrix: ${remainingInMatrix.length}`);

remainingInMatrix.forEach((item, idx) => {
  console.log(`\n${idx+1}. [${item.path}]`);
  console.log(`   Title: ${item.title}`);
  console.log(`   Date: ${item.publication_timestamp}`);
  console.log(`   Words in Matrix: ${item.current_body_words}`);
  console.log(`   Intent: ${item.intent}`);
  console.log(`   Source: ${item.source_verification.sources[0]?.name}`);
});
