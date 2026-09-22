const fs = require('fs');

const p0Matrix = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const articles = p0Matrix.articles || [];

const batch5Paths = [
  'src/articles/business/starlink-leads-satellite-internet-as-europe-commits-156b-to-rival-projects.md',
  'src/articles/business/studded-jewellery-lifts-indias-august-export-growth-as-cpd-falls-labgrown-diamonds-su.md',
  'src/articles/tech/ai-nova-tab-set-for-india-launch-via-flipkart-reveals-orange-option-and-flat-rear-des.md',
  'src/articles/tech/apples-ios-27-embeds-private-frameworks-enabling-thirdparty-ai-to-replace-siri.md',
  'src/articles/tech/cybersecurity-stocks-rally-as-threats-mount-crowdstrike-palo-alto-sentinelone-surge.md'
];

batch5Paths.forEach((p, idx) => {
  const match = articles.find(a => a.path === p);
  console.log(`\n========================================`);
  console.log(`--- Article ${idx+1}: ${p} ---`);
  if (match) {
    console.log('Title:', match.title);
    console.log('Publication Date:', match.publication_timestamp);
    console.log('Intent:', match.intent);
    console.log('Source Verification:', JSON.stringify(match.source_verification, null, 2));
    console.log('Proposed Additions:', JSON.stringify(match.proposed_additions, null, 2));
  } else {
    console.log('NOT FOUND in matrix!');
  }
});
