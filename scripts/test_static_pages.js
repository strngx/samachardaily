const fs = require('fs');
const path = require('path');

const staticPages = [
  'index.html',
  'about/index.html',
  'contact/index.html',
  'privacy/index.html',
  'terms/index.html',
  'editorial/index.html'
];

console.log('--- AUDITING STATIC PAGES ---');
for (const p of staticPages) {
  const full = path.join(__dirname, '..', '_site', p);
  if (!fs.existsSync(full)) {
    console.error(`[FAIL] Page does not exist: ${p}`);
    continue;
  }
  const content = fs.readFileSync(full, 'utf8');
  const titleMatch = content.match(/<title>([^<]+)<\/title>/);
  const canonicalMatch = content.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
  const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const hasIcons = content.includes('rel="icon"') && content.includes('rel="apple-touch-icon"') && content.includes('rel="manifest"');
  
  console.log(`\nPage: /${p.replace('index.html', '')}`);
  console.log(`  Title: ${titleMatch ? titleMatch[1] : 'NONE'}`);
  console.log(`  Canonical: ${canonicalMatch ? canonicalMatch[1] : 'NONE'}`);
  console.log(`  H1: ${h1Match ? h1Match[1].trim() : 'NONE'}`);
  console.log(`  Icon declarations present: ${hasIcons}`);
}
