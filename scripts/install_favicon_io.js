const fs = require('fs');
const path = require('path');

const extractDir = path.join(__dirname, '..', 'scratch', 'favicon_extracted');
const srcDir = path.join(__dirname, '..', 'src');
const assetsImagesDir = path.join(srcDir, 'assets', 'images');

console.log('=== INSTALLING FAVICON.IO ASSETS ===');

// 1. favicon.ico -> src/favicon.ico
fs.copyFileSync(path.join(extractDir, 'favicon.ico'), path.join(srcDir, 'favicon.ico'));
console.log('[COPIED] favicon.ico -> src/favicon.ico');

// 2. apple-touch-icon.png -> src/apple-touch-icon.png & src/assets/images/apple-touch-icon.png
fs.copyFileSync(path.join(extractDir, 'apple-touch-icon.png'), path.join(srcDir, 'apple-touch-icon.png'));
fs.copyFileSync(path.join(extractDir, 'apple-touch-icon.png'), path.join(assetsImagesDir, 'apple-touch-icon.png'));
console.log('[COPIED] apple-touch-icon.png -> src/ & src/assets/images/');

// 3. favicon-16x16.png -> src/favicon-16x16.png & src/assets/images/favicon-16x16.png
fs.copyFileSync(path.join(extractDir, 'favicon-16x16.png'), path.join(srcDir, 'favicon-16x16.png'));
fs.copyFileSync(path.join(extractDir, 'favicon-16x16.png'), path.join(assetsImagesDir, 'favicon-16x16.png'));
console.log('[COPIED] favicon-16x16.png -> src/ & src/assets/images/');

// 4. favicon-32x32.png -> src/favicon-32x32.png & src/assets/images/favicon-32x32.png
fs.copyFileSync(path.join(extractDir, 'favicon-32x32.png'), path.join(srcDir, 'favicon-32x32.png'));
fs.copyFileSync(path.join(extractDir, 'favicon-32x32.png'), path.join(assetsImagesDir, 'favicon-32x32.png'));
console.log('[COPIED] favicon-32x32.png -> src/ & src/assets/images/');

// 5. android-chrome-192x192.png -> src/android-chrome-192x192.png, src/assets/images/icon-192.png, src/assets/images/android-chrome-192x192.png
fs.copyFileSync(path.join(extractDir, 'android-chrome-192x192.png'), path.join(srcDir, 'android-chrome-192x192.png'));
fs.copyFileSync(path.join(extractDir, 'android-chrome-192x192.png'), path.join(assetsImagesDir, 'icon-192.png'));
fs.copyFileSync(path.join(extractDir, 'android-chrome-192x192.png'), path.join(assetsImagesDir, 'android-chrome-192x192.png'));
console.log('[COPIED] android-chrome-192x192.png -> src/, src/assets/images/icon-192.png & android-chrome-192x192.png');

// 6. android-chrome-512x512.png -> src/android-chrome-512x512.png, src/assets/images/icon-512.png, src/assets/images/android-chrome-512x512.png
fs.copyFileSync(path.join(extractDir, 'android-chrome-512x512.png'), path.join(srcDir, 'android-chrome-512x512.png'));
fs.copyFileSync(path.join(extractDir, 'android-chrome-512x512.png'), path.join(assetsImagesDir, 'icon-512.png'));
fs.copyFileSync(path.join(extractDir, 'android-chrome-512x512.png'), path.join(assetsImagesDir, 'android-chrome-512x512.png'));
console.log('[COPIED] android-chrome-512x512.png -> src/, src/assets/images/icon-512.png & android-chrome-512x512.png');

// 7. Ensure src/favicon.svg is present at root as well
if (fs.existsSync(path.join(assetsImagesDir, 'favicon.svg'))) {
  fs.copyFileSync(path.join(assetsImagesDir, 'favicon.svg'), path.join(srcDir, 'favicon.svg'));
  console.log('[COPIED] favicon.svg -> src/favicon.svg');
}

console.log('\nAll favicon assets installed successfully.');
