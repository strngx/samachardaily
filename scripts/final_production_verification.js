const fs = require('fs');
const path = require('path');
const https = require('https');

const siteDir = path.join(__dirname, '..', '_site');
const srcDir = path.join(__dirname, '..', 'src');

console.log('============================================================');
console.log('PHASE 11C — FINAL PRODUCTION VERIFICATION SUITE');
console.log('Timestamp: ' + new Date().toISOString());
console.log('============================================================\n');

const results = {};

// Helper: fetch remote URL
function fetchRemote(pathUrl) {
  return new Promise((resolve) => {
    https.get('https://thesamachardaily.in' + pathUrl, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(data).toString('utf8')
      }));
    }).on('error', (err) => resolve({ status: 0, error: err.message }));
  });
}

// -------------------------------------------------------------
// PART 3: Editorial Team Profile Verification
// -------------------------------------------------------------
console.log('--- PART 3: EDITORIAL TEAM PROFILE VERIFICATION ---');
const profileHtmlPath = path.join(siteDir, 'authors', 'samachardaily-editorial-team', 'index.html');
if (fs.existsSync(profileHtmlPath)) {
  const profileHtml = fs.readFileSync(profileHtmlPath, 'utf8');
  const title = (profileHtml.match(/<title>([^<]+)<\/title>/i) || [])[1];
  const canonical = (profileHtml.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) || [])[1];
  const h1 = (profileHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.trim();
  const noindex = profileHtml.includes('noindex');

  console.log(`  File exists: true`);
  console.log(`  Title: "${title}"`);
  console.log(`  Canonical: "${canonical}"`);
  console.log(`  H1: "${h1}"`);
  console.log(`  Has accidental noindex: ${noindex}`);
  results.profile = canonical === 'https://thesamachardaily.in/authors/samachardaily-editorial-team/' && !noindex;
} else {
  console.error('  [FAIL] Profile HTML missing!');
  results.profile = false;
}

// -------------------------------------------------------------
// PART 4: ProfilePage JSON-LD Verification
// -------------------------------------------------------------
console.log('\n--- PART 4: PROFILEPAGE JSON-LD VERIFICATION ---');
if (fs.existsSync(profileHtmlPath)) {
  const profileHtml = fs.readFileSync(profileHtmlPath, 'utf8');
  const jsonRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  const blocks = [];
  while ((m = jsonRegex.exec(profileHtml)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch (e) {
      console.error('  JSON parse error:', e.message);
    }
  }
  const profileSchema = blocks.find(b => b['@type'] === 'ProfilePage');
  if (profileSchema) {
    console.log('  [PASS] ProfilePage schema present:');
    console.log(JSON.stringify(profileSchema, null, 2));
    results.profileSchema = profileSchema.mainEntity?.['@type'] === 'Organization' &&
      profileSchema.mainEntity?.['@id'] === 'https://thesamachardaily.in/authors/samachardaily-editorial-team/#organization';
  } else {
    console.error('  [FAIL] ProfilePage schema not found');
    results.profileSchema = false;
  }
}

// -------------------------------------------------------------
// PART 5 & 6 & 7: NewsArticle Author Schema, Byline Links & Updated Dates
// -------------------------------------------------------------
console.log('\n--- PARTS 5, 6, 7: NEWSARTICLE AUTHOR SCHEMA, BYLINES, UPDATED DATES ---');
const sampleArticles = [
  { cat: 'India', path: 'articles/india/47-lakh-names-deleted-from-delhi-voter-roll-after-revision-kejriwal-slams-exercise/index.html' },
  { cat: 'Business', path: 'articles/business/bank-strike-hits-assam-demands-fiveday-week-pension-overhaul-pli-repeal/index.html' },
  { cat: 'Tech', path: 'articles/tech/cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence/index.html' },
  { cat: 'World', path: 'articles/world/witkoff-and-kushner-arrive-in-moscow-as-zelenskyy-demands-air-pause/index.html' },
  { cat: 'Sports', path: 'articles/sports/1979-beetles-tribute-team-wins-21st-annual-parker-youth-golf-tournament/index.html' }
];

let allArticlesPass = true;
for (const art of sampleArticles) {
  const full = path.join(siteDir, art.path);
  if (!fs.existsSync(full)) {
    console.error(`  [FAIL] Missing article: ${art.path}`);
    allArticlesPass = false;
    continue;
  }
  const html = fs.readFileSync(full, 'utf8');
  console.log(`\n  Category: [${art.cat}] | ${art.path}`);

  // Byline Link Check
  const bylineMatch = html.match(/<div class="article-byline-bar">([\s\S]*?)<\/div>/i);
  const hasBylineLink = bylineMatch && bylineMatch[1].includes('href="/authors/samachardaily-editorial-team/"');
  console.log(`    Byline contains profile link: ${hasBylineLink}`);

  // Schema Check
  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  let json = null;
  if (jsonMatch) {
    try { json = JSON.parse(jsonMatch[1]); } catch (e) {}
  }
  const authorCorrect = json && json.author?.['@type'] === 'Organization' &&
    json.author?.['@id'] === 'https://thesamachardaily.in/authors/samachardaily-editorial-team/#organization' &&
    json.author?.url === 'https://thesamachardaily.in/authors/samachardaily-editorial-team/';
  const publisherCorrect = json && json.publisher?.name === 'SamacharDaily';

  console.log(`    NewsArticle.author schema correct: ${authorCorrect}`);
  console.log(`    NewsArticle.publisher schema correct: ${publisherCorrect}`);
  console.log(`    datePublished: ${json?.datePublished}`);
  console.log(`    dateModified: ${json?.dateModified}`);

  if (!hasBylineLink || !authorCorrect || !publisherCorrect) {
    allArticlesPass = false;
  }
}
results.articlesAndBylines = allArticlesPass;

// -------------------------------------------------------------
// PART 8 & 9: Legacy Pooja Nair & Publisher Entity Consistency
// -------------------------------------------------------------
console.log('\n--- PARTS 8 & 9: LEGACY POOJA NAIR & PUBLISHER ENTITY CONSISTENCY ---');
function countInFiles(dir, regex) {
  let count = 0;
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const f = path.join(current, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.html') || e.name.endsWith('.njk') || e.name.endsWith('.js'))) {
        const txt = fs.readFileSync(f, 'utf8');
        const m = txt.match(regex);
        if (m) count += m.length;
      }
    }
  }
  walk(dir);
  return count;
}

const mediaSrcCount = countInFiles(srcDir, /SamacharDaily Media/g);
const mediaSiteCount = countInFiles(siteDir, /SamacharDaily Media/g);
const poojaSrcCount = countInFiles(srcDir, /Pooja Nair/g);
const personSrcCount = countInFiles(srcDir, /"@type":\s*"Person"/g);
const personSiteCount = countInFiles(siteDir, /"@type":\s*"Person"/g);

console.log(`  "SamacharDaily Media" in src: ${mediaSrcCount} (Expected: 0)`);
console.log(`  "SamacharDaily Media" in _site: ${mediaSiteCount} (Expected: 0)`);
console.log(`  "Pooja Nair" in src: ${poojaSrcCount} (Expected: 1 isolated legacy artifact)`);
console.log(`  "@type": "Person" in src: ${personSrcCount} (Expected: 0)`);
console.log(`  "@type": "Person" in _site: ${personSiteCount} (Expected: 0)`);
results.entityConsistency = mediaSrcCount === 0 && mediaSiteCount === 0 && personSrcCount === 0;

// -------------------------------------------------------------
// PART 10 & 11 & 12: URL Integrity, Sitemap, Robots
// -------------------------------------------------------------
console.log('\n--- PARTS 10, 11, 12: URL INTEGRITY, SITEMAP, ROBOTS ---');
const sitemapPath = path.join(siteDir, 'sitemap.xml');
const sitemapText = fs.readFileSync(sitemapPath, 'utf8');
const sitemapUrls = sitemapText.match(/<loc>([^<]+)<\/loc>/g) || [];
console.log(`  Total URLs in sitemap: ${sitemapUrls.length} (Expected: 1154)`);
const hasProfileInSitemap = sitemapText.includes('https://thesamachardaily.in/authors/samachardaily-editorial-team/');
console.log(`  Sitemap contains editorial profile: ${hasProfileInSitemap}`);

const robotsPath = path.join(siteDir, 'robots.txt');
const robotsText = fs.readFileSync(robotsPath, 'utf8').trim();
console.log(`  robots.txt content:\n${robotsText}`);
results.sitemapAndRobots = sitemapUrls.length === 1154 && hasProfileInSitemap && robotsText.includes('Allow: /');

// -------------------------------------------------------------
// PART 13 & 14 & 15 & 16: Favicon Package, HTML Head, Web Manifest
// -------------------------------------------------------------
console.log('\n--- PARTS 13, 14, 15, 16: FAVICON PACKAGE, HTML HEAD, WEB MANIFEST ---');
const faviconFiles = [
  'favicon.ico',
  'favicon.svg',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'site.webmanifest',
  'assets/images/favicon-16x16.png',
  'assets/images/favicon-32x32.png',
  'assets/images/apple-touch-icon.png',
  'assets/images/icon-192.png',
  'assets/images/icon-512.png',
  'assets/images/android-chrome-192x192.png',
  'assets/images/android-chrome-512x512.png',
  'assets/images/favicon.svg'
];

let allFaviconsExist = true;
faviconFiles.forEach(f => {
  const p = path.join(siteDir, f);
  if (!fs.existsSync(p)) {
    console.error(`  [FAIL] Missing favicon asset: ${f}`);
    allFaviconsExist = false;
  }
});
console.log(`  All 16 favicon asset endpoints exist in _site: ${allFaviconsExist}`);

const manifestContent = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.webmanifest'), 'utf8'));
const manifestValid = manifestContent.name === 'SamacharDaily' &&
  manifestContent.theme_color === '#C81E2C' &&
  manifestContent.icons?.length === 2;
console.log(`  Manifest is valid: ${manifestValid}`);
results.faviconsAndManifest = allFaviconsExist && manifestValid;

// -------------------------------------------------------------
// PART 17: Homepage Brand Identity
// -------------------------------------------------------------
console.log('\n--- PART 17: HOMEPAGE BRAND IDENTITY ---');
const homeHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
const h1Matches = homeHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
const leadH2 = homeHtml.includes('<h2 class="lead-headline">');
const hasWebSite = homeHtml.includes('"@type": "WebSite"') || homeHtml.includes('"@type":"WebSite"');
const hasOrg = homeHtml.includes('"@type": "NewsMediaOrganization"') || homeHtml.includes('"@type":"NewsMediaOrganization"');
const deadYouTube = homeHtml.includes('youtube.com/@SamacharDaily');

console.log(`  Homepage H1 count: ${h1Matches.length} (Expected: 1)`);
console.log(`  Lead story is H2: ${leadH2}`);
console.log(`  WebSite schema present: ${hasWebSite}`);
console.log(`  NewsMediaOrganization present: ${hasOrg}`);
console.log(`  Dead YouTube link present: ${deadYouTube} (Expected: false)`);
results.homepageBrand = h1Matches.length === 1 && leadH2 && hasWebSite && hasOrg && !deadYouTube;

// -------------------------------------------------------------
// PART 20: Contamination / Security Scan
// -------------------------------------------------------------
console.log('\n--- PART 20: REPO CONTAMINATION & SECURITY SCAN ---');
const arabicMatches = countInFiles(srcDir, /[\u0600-\u06FF]/g);
const promptLeakMatches = countInFiles(srcDir, /IGNORE ALL PREVIOUS INSTRUCTIONS/gi);
const localhostMatches = countInFiles(srcDir, /localhost:[0-9]+/gi);

console.log(`  Arabic script matches in src: ${arabicMatches}`);
console.log(`  Prompt leak strings in src: ${promptLeakMatches}`);
console.log(`  Localhost URLs in src: ${localhostMatches}`);
results.securityScan = promptLeakMatches === 0 && localhostMatches === 0;

// -------------------------------------------------------------
// PART 22: Production Comparison (Live Site)
// -------------------------------------------------------------
console.log('\n--- PART 22: LIVE PRODUCTION COMPARISON ---');
async function runProdComparison() {
  const liveHome = await fetchRemote('/');
  console.log(`  Live Homepage status: HTTP ${liveHome.status}`);
  
  const liveProfile = await fetchRemote('/authors/samachardaily-editorial-team/');
  console.log(`  Live Editorial Profile status: HTTP ${liveProfile.status} (Expected: 404 before deployment)`);

  const liveArticle = await fetchRemote('/articles/tech/cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence/');
  console.log(`  Live Article status: HTTP ${liveArticle.status}`);
  const liveArticleHasLink = liveArticle.body.includes('href="/authors/samachardaily-editorial-team/"');
  console.log(`  Live Article has new author link: ${liveArticleHasLink} (Expected: false before deployment)`);

  console.log('\n============================================================');
  console.log('SUMMARY OF AUDIT RESULTS:');
  console.log(results);
  console.log('============================================================\n');
}

runProdComparison();
