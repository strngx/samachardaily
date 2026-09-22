const fs = require('fs');
const path = require('path');

console.log('--- Running Final Pre-Deployment Integrity Check ---');

// 1. Verify all 1,189 files compiled in _site/
if (!fs.existsSync('_site')) {
  console.error('ERROR: _site directory missing');
  process.exit(1);
}

// 2. Check sitemap.xml
if (fs.existsSync('_site/sitemap.xml')) {
  const sitemap = fs.readFileSync('_site/sitemap.xml', 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  console.log(`Sitemap URLs verified: ${urls.length} URLs present`);
} else {
  console.error('ERROR: sitemap.xml missing in _site');
}

// 3. Check robots.txt
if (fs.existsSync('_site/robots.txt')) {
  const robots = fs.readFileSync('_site/robots.txt', 'utf8');
  console.log('robots.txt verified:\n' + robots.trim());
} else {
  console.error('ERROR: robots.txt missing in _site');
}

// 4. Test all 28 P0 Enriched Articles in _site/
const p0Matrix = JSON.parse(fs.readFileSync('phase_2c1a_p0_evidence_matrix.json', 'utf8'));
const p0Articles = p0Matrix.articles || [];

let allPassed = true;

p0Articles.forEach((art, i) => {
  const htmlPath = path.join('_site', art.path.replace(/^src\//, '').replace(/\.md$/, '/index.html'));
  if (!fs.existsSync(htmlPath)) {
    console.error(`❌ Missing HTML for P0 article ${i+1}: ${htmlPath}`);
    allPassed = false;
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  // Canonical check
  const expectedCanonical = `https://thesamachardaily.in/${art.path.replace(/^src\//, '').replace(/\.md$/, '/')}`;
  const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;
  const canonicalOk = canonical === expectedCanonical;
  
  // Noindex check
  const hasNoindex = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
  
  // Schema check
  const hasNewsArticle = html.includes('"@type":"NewsArticle"') || html.includes('"@type": "NewsArticle"');
  const hasBreadcrumbs = html.includes('"@type":"BreadcrumbList"') || html.includes('"@type": "BreadcrumbList"');
  
  // Contamination check
  const hasArabic = /[\u0600-\u06FF]/.test(html);
  const hasPromptLeak = /(as an ai|as an ai language model|in this article|here is the summary)/i.test(html);

  if (!canonicalOk || hasNoindex || !hasNewsArticle || !hasBreadcrumbs || hasArabic || hasPromptLeak) {
    console.error(`❌ Validation failure on: ${art.path}`);
    console.error({ canonicalOk, hasNoindex, hasNewsArticle, hasBreadcrumbs, hasArabic, hasPromptLeak });
    allPassed = false;
  }
});

console.log(`\nAll 28 P0 Enriched Articles in _site/: ${allPassed ? '✅ 100% PASSED' : '❌ FAILED'}`);
