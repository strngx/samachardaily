const fs = require('fs');

const p0Matrix = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const articles = p0Matrix.articles || [];

// All previously enriched files across all prior batches
const allPreviousEnriched = new Set([
  // Phase 2C-2 Batch 1 (5)
  'src/articles/tech/apple-iphone-17-pro-max-price-falls-to-rs-74990-at-croma-adds-exchange-bonus-free-cas.md',
  'src/articles/tech/lava-unveils-virat-curve-5g-smartphone-at-19999-launch-price.md',
  'src/articles/business/google-ceo-sundar-pichai-reconnects-with-iit-batchmate-turned-renowned-monk.md',
  'src/articles/business/hfcl-board-approves-820-crore-capex-boost-raising-total-fibre-expansion-spend-to-1800.md',
  'src/articles/tech/apple-iphone-duo-production-slowdown-likely-extends-consumer-wait-times.md',
  // Phase 2C-2 Batch 2 (5)
  'src/articles/tech/google-aligns-with-openai-anthropic-meta-in-public-ai-hack-disclosures.md',
  'src/articles/tech/indias-semiconductor-drive-shifts-to-execution-says-ashwini-vaishnaw.md',
  'src/articles/tech/nvidia-in-funding-talks-for-anthropics-potentially-massive-ipo.md',
  'src/articles/tech/openai-faces-mathematicians-backlash-over-ai-driven-race-to-solve-classic-problems.md',
  'src/articles/business/major-indian-banks-to-close-up-to-four-days-between-sep-1420-2026-per-rbi-holiday-cal.md',
  // Phase 2B-2D (2)
  'src/articles/tech/apple-rolls-out-iphone-duo-foldable-and-iphone-18-pro-max-prices-revealed.md',
  'src/articles/tech/apple-unveils-first-foldable-iphone-duo-targets-october-launch-amid-pro-lineup-reveal.md',
  // Phase 2B-2H (1)
  'src/articles/business/maruti-upgrades-baleno-with-new-engine-level2-adas-i20-altroz-remain-strong-rivals.md',
  // Phase 6A Batch 3 (5)
  'src/articles/business/karpacz-economic-forum-2026-highlights-polands-growth-political-rift-and-v4-outlook.md',
  'src/articles/india/amit-shah-hails-pm-modis-25-year-public-record-launches-seva-sankalp-abhiyan.md',
  'src/articles/india/indian-consul-in-shanghai-praises-peking-scholars-leads-tagore-bust-cleaning.md',
  'src/articles/tech/cathie-wood-shifts-287-million-from-alphabet-to-meta-as-ai-focus-intensifies.md',
  'src/articles/tech/trump-announces-plans-for-new-ai-force-agency-and-upcoming-ai-czar.md',
  // Phase 6B Batch 4 (5)
  'src/articles/tech/amazon-launches-alexa-in-india-with-early-access-hindihinglish-support-and-ai-feature.md',
  'src/articles/tech/apple-rolls-out-ios-27-with-revamped-siri-and-ai-upgrades-ahead-of-iphone-18-launch.md',
  'src/articles/tech/trump-labels-ai-data-centers-oil-of-next-50-years-blames-google-for-misplaced-project.md',
  'src/articles/business/cpsc-orders-recall-of-hundreds-of-thousands-of-amazon-fingerlight-toys-over-battery-s.md',
  'src/articles/business/gcrta-stalls-service-cuts-until-2027-election-amid-taxincrease-debate.md',
  // Phase 6D Batch 5 (5)
  'src/articles/business/starlink-leads-satellite-internet-as-europe-commits-156b-to-rival-projects.md',
  'src/articles/business/studded-jewellery-lifts-indias-august-export-growth-as-cpd-falls-labgrown-diamonds-su.md',
  'src/articles/tech/ai-nova-tab-set-for-india-launch-via-flipkart-reveals-orange-option-and-flat-rear-des.md',
  'src/articles/tech/apples-ios-27-embeds-private-frameworks-enabling-thirdparty-ai-to-replace-siri.md',
  'src/articles/tech/cybersecurity-stocks-rally-as-threats-mount-crowdstrike-palo-alto-sentinelone-surge.md'
]);

const remainingP0 = articles.filter(a => !allPreviousEnriched.has(a.path));
console.log(`Total P0 Matrix entries: ${articles.length}`);
console.log(`Total previously enriched: ${allPreviousEnriched.size}`);
console.log(`Remaining P0 entries: ${remainingP0.length}`);

remainingP0.forEach((item, idx) => {
  console.log(`\n========================================`);
  console.log(`--- Article ${idx+1}: ${item.path} ---`);
  console.log('Title:', item.title);
  console.log('Publication Date:', item.publication_timestamp);
  console.log('Current Words in Matrix:', item.current_body_words);
  console.log('Intent:', item.intent);
  console.log('Source Verification:', JSON.stringify(item.source_verification, null, 2));
  console.log('Proposed Additions:', JSON.stringify(item.proposed_additions, null, 2));
});
