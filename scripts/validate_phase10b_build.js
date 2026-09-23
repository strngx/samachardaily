const fs = require('fs');
const path = require('path');

const siteDir = path.join(__dirname, '..', '_site');

console.log('--- AUDITING PHASE 10B BUILD OUTPUT ---');

// 1. Check static assets
const assetsToCheck = [
  'favicon.ico',
  'apple-touch-icon.png',
  'site.webmanifest',
  'assets/images/favicon.svg',
  'assets/images/favicon-16x16.png',
  'assets/images/favicon-32x32.png',
  'assets/images/favicon-48x48.png',
  'assets/images/apple-touch-icon.png',
  'assets/images/icon-192.png',
  'assets/images/icon-512.png',
  'robots.txt',
  'sitemap.xml'
];

let assetsPass = true;
for (const relPath of assetsToCheck) {
  const fullPath = path.join(siteDir, relPath);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    console.log(`[PASS] Asset exists: ${relPath} (${stat.size} bytes)`);
  } else {
    console.error(`[FAIL] Missing asset: ${relPath}`);
    assetsPass = false;
  }
}

// 2. Check site.webmanifest contents
const manifestPath = path.join(siteDir, 'site.webmanifest');
const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log('\nManifest check:', JSON.stringify(manifestContent, null, 2));

// 3. Inspect homepage HTML
const homeHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');

// Check H1 and H2
const h1Matches = homeHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
console.log('\nHomepage H1 count:', h1Matches ? h1Matches.length : 0);
if (h1Matches) {
  h1Matches.forEach((h, i) => console.log(`  H1[${i}]: ${h.trim()}`));
}

const leadH2 = homeHtml.includes('<h2 class="lead-headline">');
console.log('Lead headline is H2:', leadH2);

// Check icons in head
console.log('\nHead Icon tags on homepage:');
const iconTags = homeHtml.match(/<link[^>]+rel="[^"]*icon[^"]*"[^>]*>/gi) || [];
const manifestTag = homeHtml.match(/<link[^>]+rel="manifest"[^>]*>/gi) || [];
iconTags.forEach(t => console.log(' ', t));
manifestTag.forEach(t => console.log(' ', t));

// Check JSON-LD on homepage
const jsonLdBlocks = [];
const jsonLdRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
let match;
while ((match = jsonLdRegex.exec(homeHtml)) !== null) {
  try {
    jsonLdBlocks.push(JSON.parse(match[1]));
  } catch (e) {
    console.error('Failed to parse JSON-LD:', e.message);
  }
}

console.log('\nHomepage JSON-LD entities count:', jsonLdBlocks.length);
jsonLdBlocks.forEach((b, i) => {
  console.log(`\nEntity ${i + 1} (@type: ${b['@type']}):`);
  console.log(JSON.stringify(b, null, 2));
});

// Check og:site_name
const ogSiteName = homeHtml.match(/<meta property="og:site_name" content="([^"]+)"/);
console.log('\nog:site_name:', ogSiteName ? ogSiteName[1] : 'NOT FOUND');

// Check 3 article pages
console.log('\n--- AUDITING ARTICLE PAGES ---');
const sampleArticles = [
  'articles/tech/deepseek-r1-analysis-mathematical-breakthrough-or-temporary-disruption/index.html',
  'articles/business/bank-strike-hits-assam-demands-fiveday-week-pension-overhaul-pli-repeal/index.html',
  'articles/india/supreme-court-rejects-telecom-curative-petitions-agr-dues-stand-at-147-lakh-crore/index.html'
];

for (const artRel of sampleArticles) {
  const artPath = path.join(siteDir, artRel);
  if (!fs.existsSync(artPath)) {
    console.error(`Missing article file: ${artRel}`);
    continue;
  }
  const artHtml = fs.readFileSync(artPath, 'utf8');
  let artJsonLd = [];
  let m;
  while ((m = jsonLdRegex.exec(artHtml)) !== null) {
    try {
      artJsonLd.push(JSON.parse(m[1]));
    } catch (e) {}
  }
  const newsArticle = artJsonLd.find(e => e['@type'] === 'NewsArticle');
  console.log(`\nArticle: ${artRel}`);
  if (newsArticle) {
    console.log(`  Publisher Name: "${newsArticle.publisher?.name}"`);
    console.log(`  Publisher Type: "${newsArticle.publisher?.['@type']}"`);
    console.log(`  Publisher Logo: "${newsArticle.publisher?.logo?.url || newsArticle.publisher?.logo}"`);
  } else {
    console.error('  [FAIL] NewsArticle schema missing');
  }
}

// Check for any remaining occurrences of "SamacharDaily Media"
console.log('\n--- CHECKING FOR "SamacharDaily Media" OCCURRENCES ---');
function scanDirForString(dir, searchStr) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        scanDirForString(full, searchStr);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.md') || entry.name.endsWith('.js') || entry.name.endsWith('.njk'))) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(searchStr)) {
        console.warn(`[WARN] Found "${searchStr}" in ${full}`);
      }
    }
  }
}
scanDirForString(path.join(__dirname, '..', 'src'), 'SamacharDaily Media');
scanDirForString(path.join(__dirname, '..', '_site'), 'SamacharDaily Media');

console.log('\nAudit complete.');
