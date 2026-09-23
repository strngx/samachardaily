const fs = require('fs');
const path = require('path');

const siteDir = path.join(__dirname, '..', '_site');

console.log('=== PHASE 11C-FAVICON VALIDATION AUDIT ===\n');

// 1. Verify All Generated Favicon Files
const expectedFiles = [
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

console.log('1. Generated Asset Files:');
let allExist = true;
for (const rel of expectedFiles) {
  const full = path.join(siteDir, rel);
  if (fs.existsSync(full)) {
    const stat = fs.statSync(full);
    console.log(`  [PASS] /${rel} (${stat.size} bytes)`);
  } else {
    console.error(`  [FAIL] Missing file: /${rel}`);
    allExist = false;
  }
}

// 2. Inspect site.webmanifest
console.log('\n2. Inspecting site.webmanifest:');
const manifestPath = path.join(siteDir, 'site.webmanifest');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(JSON.stringify(manifest, null, 2));

  // Verify all icons in manifest exist
  if (manifest.icons && Array.isArray(manifest.icons)) {
    manifest.icons.forEach(ic => {
      const iconPath = path.join(siteDir, ic.src.replace(/^\//, ''));
      const exists = fs.existsSync(iconPath);
      console.log(`  Icon ${ic.src} exists: ${exists} (${ic.sizes})`);
    });
  }
}

// 3. Inspect Homepage <head>
console.log('\n3. Inspecting Homepage <head> Icon Tags:');
const homeHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
const iconTags = homeHtml.match(/<link[^>]+rel="[^"]*icon[^"]*"[^>]*>/gi) || [];
const manifestTag = homeHtml.match(/<link[^>]+rel="manifest"[^>]*>/gi) || [];
const themeColorTag = homeHtml.match(/<meta[^>]+name="theme-color"[^>]*>/gi) || [];

iconTags.forEach(t => console.log(' ', t));
manifestTag.forEach(t => console.log(' ', t));
themeColorTag.forEach(t => console.log(' ', t));

// 4. Inspect Sample Article <head>
console.log('\n4. Inspecting Sample Article <head> Icon Tags:');
const artPath = path.join(siteDir, 'articles', 'tech', 'cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence', 'index.html');
const artHtml = fs.readFileSync(artPath, 'utf8');
const artIconTags = artHtml.match(/<link[^>]+rel="[^"]*icon[^"]*"[^>]*>/gi) || [];
console.log(`  Article inherits ${artIconTags.length} icon tags from base layout.`);

console.log('\nValidation complete.');
