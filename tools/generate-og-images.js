/**
 * Deterministic build-time Open Graph image generator for Samachar Daily
 * Renders 1200x630 PNG social cards for all articles and default homepage
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CATEGORY_COLORS = {
  'india': '#C81E2C',
  'world': '#1D4ED8',
  'business': '#0D9488',
  'tech': '#4F46E5',
  'technology': '#4F46E5',
  'sports': '#D97706',
  'entertainment': '#7C3AED',
  'lifestyle': '#059669',
  'general': '#4B5563'
};

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, maxCharsPerLine, maxLines = 4) {
  if (!text) return [];
  const words = text.trim().split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      if (lines.length === maxLines - 1) {
        // Last permitted line: assemble remaining words with potential ellipsis
        const remaining = words.slice(i).join(' ');
        if (remaining.length <= maxCharsPerLine) {
          lines.push(remaining);
        } else {
          let truncated = remaining.substring(0, maxCharsPerLine - 3).trim();
          // avoid trailing punctuation before ellipsis
          truncated = truncated.replace(/[,;:.!?\-]+$/, '');
          lines.push(`${truncated}...`);
        }
        currentLine = '';
        break;
      }
      currentLine = word;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  return lines;
}

function generateArticleSvg({ title, category, dek }) {
  const safeTitle = (title || 'SamacharDaily News').trim();
  const cat = (category || 'NEWS').toUpperCase();
  const catKey = (category || 'general').toLowerCase();
  const accentColor = CATEGORY_COLORS[catKey] || '#C81E2C';

  // Dynamic typography scale based on length
  const titleLength = safeTitle.length;
  let fontSize = 46;
  let lineHeight = 58;
  let maxChars = 34;

  if (titleLength < 45) {
    fontSize = 54;
    lineHeight = 68;
    maxChars = 28;
  } else if (titleLength <= 80) {
    fontSize = 46;
    lineHeight = 58;
    maxChars = 34;
  } else if (titleLength <= 125) {
    fontSize = 38;
    lineHeight = 50;
    maxChars = 44;
  } else {
    fontSize = 32;
    lineHeight = 42;
    maxChars = 52;
  }

  const lines = wrapText(safeTitle, maxChars, 4);
  const titleStartY = 240 - ((lines.length - 2) * (lineHeight / 2));

  let titleTspans = '';
  lines.forEach((line, idx) => {
    titleTspans += `<tspan x="80" y="${titleStartY + (idx * lineHeight)}">${escapeXml(line)}</tspan>\n`;
  });

  // Dek if space permits (only when headline is <= 3 lines)
  let dekSvg = '';
  if (dek && lines.length <= 3) {
    const dekLines = wrapText(dek, 58, 2);
    const dekStartY = titleStartY + (lines.length * lineHeight) + 24;
    let dekTspans = '';
    dekLines.forEach((dLine, dIdx) => {
      dekTspans += `<tspan x="80" y="${dekStartY + (dIdx * 32)}">${escapeXml(dLine)}</tspan>\n`;
    });
    dekSvg = `<text font-family="'Source Serif 4', Georgia, serif" font-size="22" font-style="italic" fill="#4B5563">\n${dekTspans}</text>`;
  }

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <!-- Clean Editorial Background -->
  <rect width="1200" height="630" fill="#FFFFFF"/>
  <rect width="1200" height="630" fill="#FBFBFB" opacity="0.6"/>

  <!-- Top Accent Bar (Brand Red) -->
  <rect x="0" y="0" width="1200" height="10" fill="#C81E2C"/>

  <!-- Subtly Framed Container Border -->
  <rect x="40" y="34" width="1120" height="556" rx="12" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5"/>

  <!-- Inner Top Border Accent under header -->
  <line x1="80" y1="120" x2="1120" y2="120" stroke="#F3F4F6" stroke-width="1.5"/>

  <!-- Brand Wordmark (Left) -->
  <g transform="translate(80, 62)">
    <rect x="0" y="3" width="7" height="30" rx="3.5" fill="#C81E2C" />
    <text x="16" y="27" font-family="'Source Serif 4', Merriweather, Georgia, serif" font-weight="900" font-size="30" fill="#111827">Samachar<tspan fill="#C81E2C">Daily</tspan></text>
  </g>

  <!-- Category Tag (Right) -->
  <g transform="translate(1120, 68)">
    <rect x="-140" y="0" width="140" height="34" rx="6" fill="${accentColor}" opacity="0.12"/>
    <text x="-70" y="23" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="15" fill="${accentColor}" text-anchor="middle" letter-spacing="1.5">${escapeXml(cat)}</text>
  </g>

  <!-- Article Headline -->
  <text font-family="'Source Serif 4', Georgia, serif" font-weight="800" font-size="${fontSize}" fill="#111827">
    ${titleTspans}
  </text>

  <!-- Dek/Subtitle -->
  ${dekSvg}

  <!-- Bottom Brand Footer -->
  <line x1="80" y1="520" x2="1120" y2="520" stroke="#F3F4F6" stroke-width="1.5"/>
  <g transform="translate(80, 545)">
    <text x="0" y="20" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="16" fill="#C81E2C" letter-spacing="0.5">SAMACHAR DAILY</text>
    <text x="175" y="20" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#9CA3AF">•</text>
    <text x="195" y="20" font-family="system-ui, -apple-system, sans-serif" font-weight="500" font-size="16" fill="#6B7280">Independent Digital Newsroom</text>
    <text x="1040" y="20" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="16" fill="#9CA3AF" text-anchor="end">thesamachardaily.in</text>
  </g>
</svg>
`;
}

function generateHomepageSvg() {
  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <!-- Clean Editorial Background -->
  <rect width="1200" height="630" fill="#FFFFFF"/>

  <!-- Top Accent Bar (Brand Red) -->
  <rect x="0" y="0" width="1200" height="12" fill="#C81E2C"/>

  <!-- Subtly Framed Container Border -->
  <rect x="50" y="44" width="1100" height="540" rx="16" fill="#FAFAFA" stroke="#E5E7EB" stroke-width="2"/>

  <!-- Centered Brand Identity -->
  <g transform="translate(600, 200)">
    <!-- Brand Icon -->
    <rect x="-160" y="-8" width="12" height="48" rx="6" fill="#C81E2C" />
    <text x="-135" y="32" font-family="'Source Serif 4', Merriweather, Georgia, serif" font-weight="900" font-size="52" fill="#111827">Samachar<tspan fill="#C81E2C">Daily</tspan></text>
  </g>

  <!-- Tagline & Mission -->
  <text x="600" y="310" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="30" fill="#1F2937" text-anchor="middle">
    Fast News. Trends, Explained.
  </text>
  
  <text x="600" y="360" font-family="'Source Serif 4', Georgia, serif" font-size="22" font-style="italic" fill="#4B5563" text-anchor="middle">
    Independent Digital Newsroom covering India, World, Business, and Technology
  </text>

  <!-- Categories Pill Row -->
  <g transform="translate(600, 420)">
    <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="16" fill="#9CA3AF" text-anchor="middle" letter-spacing="2">
      INDIA  •  BUSINESS  •  TECH  •  WORLD  •  SPORTS  •  ENTERTAINMENT
    </text>
  </g>

  <!-- Bottom Brand Footer -->
  <line x1="120" y1="490" x2="1080" y2="490" stroke="#E5E7EB" stroke-width="1.5"/>
  <text x="600" y="535" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="18" fill="#C81E2C" text-anchor="middle" letter-spacing="1">
    thesamachardaily.in
  </text>
</svg>
`;
}

function parseArticleFrontmatter(content, filePath) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = match[1];

  function getField(key) {
    // Match standard key: value OR multiline scalar key: >- / key: |
    const blockRegex = new RegExp(`^${key}:\\s*(?:>[-+]?|\\|[-+]?)\\s*\\r?\\n((?:^[ \\t]+.*\\r?\\n?)+)`, 'm');
    const blockMatch = fm.match(blockRegex);
    if (blockMatch) {
      return blockMatch[1]
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ');
    }

    const inlineRegex = new RegExp(`^${key}:\\s*(?:["'](.*?)["']|(.*?))\\s*$`, 'm');
    const m = fm.match(inlineRegex);
    if (!m) return '';
    return (m[1] !== undefined ? m[1] : m[2]) || '';
  }

  const filename = path.basename(filePath, '.md');
  const title = getField('title');
  const category = getField('category');
  const dek = getField('dek') || getField('description');
  let rawSlug = getField('slug');
  if (rawSlug) {
    rawSlug = rawSlug.replace(/^[>|][-+ ]*/, '').trim();
  }
  const slug = (rawSlug && !rawSlug.includes('\n') && !rawSlug.includes('>')) ? rawSlug : filename;

  return { title, category, dek, slug, filename };
}

function getArticleFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      getArticleFiles(fullPath, fileList);
    } else if (file.name.endsWith('.md')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

async function generateOgImages(options = {}) {
  const outputDir = options.outputDir || path.join(process.cwd(), '_site', 'assets', 'og');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`[OG Generator] Generating 1200x630 social cards in: ${outputDir}`);
  const startTime = Date.now();

  // 1. Default / homepage OG image
  const customDefaultOg = path.join(process.cwd(), 'src', 'assets', 'og', 'default.png');
  const customOgImage = path.join(process.cwd(), 'src', 'assets', 'images', 'og-image.png');
  if (fs.existsSync(customDefaultOg)) {
    fs.copyFileSync(customDefaultOg, path.join(outputDir, 'default.png'));
  } else if (fs.existsSync(customOgImage)) {
    fs.copyFileSync(customOgImage, path.join(outputDir, 'default.png'));
  } else {
    const hpSvg = generateHomepageSvg();
    const hpBuffer = Buffer.from(hpSvg);
    await sharp(hpBuffer)
      .png({ compressionLevel: 6 })
      .toFile(path.join(outputDir, 'default.png'));
  }

  // 2. Discover articles
  const articlesDir = path.join(process.cwd(), 'src', 'articles');
  const articleFiles = getArticleFiles(articlesDir);
  console.log(`[OG Generator] Found ${articleFiles.length} articles to process.`);

  let generatedCount = 0;
  const batchSize = 64;

  for (let i = 0; i < articleFiles.length; i += batchSize) {
    const batch = articleFiles.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const content = fs.readFileSync(file, 'utf8');
          const data = parseArticleFrontmatter(content, file);
          if (!data || !data.slug) return;

          const destPath = path.join(outputDir, `${data.slug}.png`);
          // Avoid regenerating if already exists and not forcing
          if (!options.force && fs.existsSync(destPath)) {
            generatedCount++;
            return;
          }

          const svg = generateArticleSvg(data);
          await sharp(Buffer.from(svg))
            .png({ compressionLevel: 6 })
            .toFile(destPath);
          generatedCount++;
        } catch (err) {
          console.warn(`[OG Generator] Warning processing ${file}: ${err.message}`);
        }
      })
    );
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[OG Generator] Successfully produced ${generatedCount} OG images + default card in ${duration}s.`);
}

if (require.main === module) {
  generateOgImages({ force: true }).catch((err) => {
    console.error('[OG Generator] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { generateOgImages };
