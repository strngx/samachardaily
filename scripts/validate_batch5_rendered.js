const fs = require('fs');
const path = require('path');

const targets = [
  {
    source: 'src/articles/business/starlink-leads-satellite-internet-as-europe-commits-156b-to-rival-projects.md',
    htmlPath: '_site/articles/business/starlink-leads-satellite-internet-as-europe-commits-156b-to-rival-projects/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/business/starlink-leads-satellite-internet-as-europe-commits-156b-to-rival-projects/'
  },
  {
    source: 'src/articles/business/studded-jewellery-lifts-indias-august-export-growth-as-cpd-falls-labgrown-diamonds-su.md',
    htmlPath: '_site/articles/business/studded-jewellery-lifts-indias-august-export-growth-as-cpd-falls-labgrown-diamonds-su/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/business/studded-jewellery-lifts-indias-august-export-growth-as-cpd-falls-labgrown-diamonds-su/'
  },
  {
    source: 'src/articles/tech/ai-nova-tab-set-for-india-launch-via-flipkart-reveals-orange-option-and-flat-rear-des.md',
    htmlPath: '_site/articles/tech/ai-nova-tab-set-for-india-launch-via-flipkart-reveals-orange-option-and-flat-rear-des/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/tech/ai-nova-tab-set-for-india-launch-via-flipkart-reveals-orange-option-and-flat-rear-des/'
  },
  {
    source: 'src/articles/tech/apples-ios-27-embeds-private-frameworks-enabling-thirdparty-ai-to-replace-siri.md',
    htmlPath: '_site/articles/tech/apples-ios-27-embeds-private-frameworks-enabling-thirdparty-ai-to-replace-siri/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/tech/apples-ios-27-embeds-private-frameworks-enabling-thirdparty-ai-to-replace-siri/'
  },
  {
    source: 'src/articles/tech/cybersecurity-stocks-rally-as-threats-mount-crowdstrike-palo-alto-sentinelone-surge.md',
    htmlPath: '_site/articles/tech/cybersecurity-stocks-rally-as-threats-mount-crowdstrike-palo-alto-sentinelone-surge/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/tech/cybersecurity-stocks-rally-as-threats-mount-crowdstrike-palo-alto-sentinelone-surge/'
  }
];

let allPassed = true;

targets.forEach((t, i) => {
  console.log(`\n--- Validating Target ${i+1}: ${path.basename(t.source)} ---`);
  if (!fs.existsSync(t.htmlPath)) {
    console.error(`ERROR: File does not exist: ${t.htmlPath}`);
    allPassed = false;
    return;
  }

  const html = fs.readFileSync(t.htmlPath, 'utf8');

  // Check canonical
  const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;
  const canonicalOk = canonical === t.expectedCanonical;
  console.log('Canonical:', canonical, canonicalOk ? '✅ OK' : '❌ MISMATCH');

  // Check robots / noindex
  const noindexFound = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
  console.log('Indexable:', !noindexFound ? '✅ YES (indexable)' : '❌ NO (noindex present)');

  // Check Schema JSON-LD
  const jsonLdMatches = [...html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
  let hasNewsArticle = false;
  let hasBreadcrumbList = false;

  jsonLdMatches.forEach(m => {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed['@type'] === 'NewsArticle') hasNewsArticle = true;
      if (parsed['@type'] === 'BreadcrumbList') hasBreadcrumbList = true;
    } catch (e) {
      console.error('JSON-LD Parse Error:', e.message);
    }
  });

  console.log('NewsArticle Schema:', hasNewsArticle ? '✅ Present' : '❌ Missing');
  console.log('BreadcrumbList Schema:', hasBreadcrumbList ? '✅ Present' : '❌ Missing');

  // Check Contamination
  const hasArabic = /[\u0600-\u06FF]/.test(html);
  const hasPromptLeak = /(as an ai|as an ai language model)/i.test(html);
  console.log('Cleanliness Check:', (!hasArabic && !hasPromptLeak) ? '✅ Clean' : '❌ Contaminated');

  if (!canonicalOk || noindexFound || !hasNewsArticle || !hasBreadcrumbList || hasArabic || hasPromptLeak) {
    allPassed = false;
  }
});

console.log('\n=======================================');
console.log('Overall Validation Passed:', allPassed ? '✅ YES' : '❌ NO');
