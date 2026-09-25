const fs = require('fs');
const assert = require('assert');

// 1. Article HTML check
const artPath = '_site/articles/india/maruti-suzuki-launches-baleno-facelift-in-india-at-rs-610-lakh-ex-showroom/index.html';
assert.ok(fs.existsSync(artPath), 'Article HTML must exist');
const html = fs.readFileSync(artPath, 'utf8');

assert.ok(html.includes('canonical'), 'Canonical link present');
assert.ok(html.includes('NewsArticle'), 'NewsArticle schema present');
assert.ok(html.includes('BreadcrumbList'), 'BreadcrumbList schema present');
console.log('PASS: Article HTML, canonical, and schemas verified');

// 2. Sitemap check
const sitemapPath = '_site/sitemap.xml';
assert.ok(fs.existsSync(sitemapPath), 'Sitemap must exist');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
assert.ok(sitemap.includes('maruti-suzuki-launches-baleno-facelift-in-india-at-rs-610-lakh-ex-showroom'), 'Article in sitemap');
console.log('PASS: Sitemap verified');

// 3. RSS feed check
const feedPath = '_site/rss.xml';
assert.ok(fs.existsSync(feedPath), 'RSS feed must exist');
const feed = fs.readFileSync(feedPath, 'utf8');
assert.ok(feed.includes('<rss') || feed.includes('<feed'), 'Valid RSS feed structure');
console.log('PASS: RSS feed verified');

console.log('All build output integrity validations passed successfully!');
