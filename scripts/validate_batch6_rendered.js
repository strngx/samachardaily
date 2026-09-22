const fs = require('fs');
const path = require('path');

const targets = [
  {
    source: 'src/articles/tech/google-says-android-auto-speedometer-vanishes-because-its-a-paidplan-feature.md',
    htmlPath: '_site/articles/tech/google-says-android-auto-speedometer-vanishes-because-its-a-paidplan-feature/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/tech/google-says-android-auto-speedometer-vanishes-because-its-a-paidplan-feature/'
  },
  {
    source: 'src/articles/tech/gsmarena-lists-display-sizes-resolutions-for-next-years-pro-iphones.md',
    htmlPath: '_site/articles/tech/gsmarena-lists-display-sizes-resolutions-for-next-years-pro-iphones/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/tech/gsmarena-lists-display-sizes-resolutions-for-next-years-pro-iphones/'
  },
  {
    source: 'src/articles/tech/ideagen-retains-verdantix-green-quadrant-leader-status-in-2026-ehs-software-report.md',
    htmlPath: '_site/articles/tech/ideagen-retains-verdantix-green-quadrant-leader-status-in-2026-ehs-software-report/index.html',
    expectedCanonical: 'https://thesamachardaily.in/articles/tech/ideagen-retains-verdantix-green-quadrant-leader-status-in-2026-ehs-software-report/'
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
