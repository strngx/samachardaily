const fs = require('fs');
const path = require('path');

const siteDir = path.join(__dirname, '..', '_site');
const srcDir = path.join(__dirname, '..', 'src');

console.log('=== PHASE 11B VALIDATION AUDIT ===\n');

// 1. Check Profile Page
const profilePath = path.join(siteDir, 'authors', 'samachardaily-editorial-team', 'index.html');
console.log('1. Checking Author Profile Page:');
if (fs.existsSync(profilePath)) {
  const html = fs.readFileSync(profilePath, 'utf8');
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
  const canonical = (html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) || [])[1];
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.trim();
  
  console.log('  [PASS] File exists at /authors/samachardaily-editorial-team/index.html');
  console.log(`  Title: "${title}"`);
  console.log(`  Canonical: "${canonical}"`);
  console.log(`  H1: "${h1}"`);

  // JSON-LD in profile
  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1]);
      console.log('  [PASS] ProfilePage JSON-LD schema:');
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.error('  [FAIL] JSON-LD parse error:', e.message);
    }
  } else {
    console.error('  [FAIL] No JSON-LD found in profile page');
  }
} else {
  console.error('  [FAIL] Profile page missing!');
}

// 2. Check Sample Articles Across 5 Categories
console.log('\n2. Checking Sample Articles across 5 Categories:');
const sampleArticles = [
  'articles/india/47-lakh-names-deleted-from-delhi-voter-roll-after-revision-kejriwal-slams-exercise/index.html',
  'articles/business/bank-strike-hits-assam-demands-fiveday-week-pension-overhaul-pli-repeal/index.html',
  'articles/tech/cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence/index.html',
  'articles/world/witkoff-and-kushner-arrive-in-moscow-as-zelenskyy-demands-air-pause/index.html',
  'articles/sports/1979-beetles-tribute-team-wins-21st-annual-parker-youth-golf-tournament/index.html'
];

for (const rel of sampleArticles) {
  const full = path.join(siteDir, rel);
  if (!fs.existsSync(full)) {
    console.error(`  [FAIL] Missing file: ${rel}`);
    continue;
  }
  const html = fs.readFileSync(full, 'utf8');
  console.log(`\n  Article: ${rel}`);
  
  // Byline check
  const bylineMatch = html.match(/<div class="article-byline-bar">([\s\S]*?)<\/div>/i);
  if (bylineMatch) {
    const hasAuthorLink = bylineMatch[1].includes('href="/authors/samachardaily-editorial-team/"');
    console.log(`    Byline contains link to profile: ${hasAuthorLink}`);
    console.log(`    Byline HTML snippet: ${bylineMatch[1].replace(/\s+/g, ' ').trim()}`);
  } else {
    console.error('    [FAIL] Byline bar missing');
  }

  // Schema check
  const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1]);
      console.log(`    NewsArticle.author: ${JSON.stringify(json.author)}`);
      console.log(`    NewsArticle.publisher: ${JSON.stringify(json.publisher)}`);
    } catch (e) {
      console.error('    [FAIL] JSON-LD parse error:', e.message);
    }
  }
}

// 3. Sitemap Verification
console.log('\n3. Checking Sitemap:');
const sitemapPath = path.join(siteDir, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  const locCount = (sitemapContent.match(/<loc>/g) || []).length;
  const hasProfileInSitemap = sitemapContent.includes('https://thesamachardaily.in/authors/samachardaily-editorial-team/');
  console.log(`  Total <loc> URLs in sitemap: ${locCount}`);
  console.log(`  Sitemap contains author profile URL: ${hasProfileInSitemap}`);
}

// 4. Regression Searches
console.log('\n4. Running Codebase & Output Regressions:');

function searchPattern(dir, pattern, label) {
  let count = 0;
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const f = path.join(current, e.name);
      if (e.isDirectory()) {
        walk(f);
      } else if (e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.html') || e.name.endsWith('.njk') || e.name.endsWith('.js'))) {
        const txt = fs.readFileSync(f, 'utf8');
        const m = txt.match(pattern);
        if (m) {
          count += m.length;
        }
      }
    }
  }
  walk(dir);
  console.log(`  ${label}: ${count} matches found in ${dir}`);
  return count;
}

searchPattern(srcDir, /SamacharDaily Media/g, '"SamacharDaily Media" in src');
searchPattern(siteDir, /SamacharDaily Media/g, '"SamacharDaily Media" in _site');
searchPattern(srcDir, /Pooja Nair/g, '"Pooja Nair" in src');
searchPattern(srcDir, /"@type":\s*"Person"/g, '"@type": "Person" in src');
searchPattern(siteDir, /"@type":\s*"Person"/g, '"@type": "Person" in _site');

console.log('\nValidation script complete.');
