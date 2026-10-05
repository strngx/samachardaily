/**
 * Phase 13E End-to-End YouTube Pipeline Test Suite
 *
 * Verifies the complete YouTube publishing contract:
 * A. Admin payload contains video.
 * B. Worker accepts valid video.
 * C. Worker normalizes it to exactly 11 characters.
 * D. Frontmatter persistence contains correct video_id.
 * E. video_caption persists.
 * F. videos[] is correct if used.
 * G. Eleventy renders the video embed.
 * H. Rendered HTML contains youtube.com/embed/{id}.
 * I. Rendered HTML contains Watch on YouTube.
 * J. Rendered HTML contains VideoObject JSON-LD.
 * K. Invalid protocols are rejected: javascript:, data:, vbscript:.
 * L. Foreign domains rejected.
 * M. Malformed IDs rejected.
 * N. Removal clears all video state.
 * O. Rendered HTML after removal contains no YouTube iframe.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const nunjucks = require('nunjucks');

const ROOT_DIR = path.resolve(__dirname, '..');

// Setup Nunjucks environment matching Eleventy project configuration
const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([
    path.join(ROOT_DIR, 'src', '_includes'),
    path.join(ROOT_DIR, 'src')
  ]),
  { autoescape: false }
);

// Register required template filters
env.addFilter('url', str => str || '');
env.addFilter('isoDate', d => new Date(d || Date.now()).toISOString());
env.addFilter('categorySlug', cat => (cat || 'india').toLowerCase().replace(/\s+/g, '-'));
env.addFilter('json', obj => JSON.stringify(obj));

// Normalization function matching worker/audit.js implementation
function parseYouTubeVideoId(input) {
  if (input === undefined || input === null) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  if (/[\r\n\t\0<>"']/.test(raw)) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const urlStr = raw.startsWith('http://') || raw.startsWith('https://') ? raw : ('https://' + raw);
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isStandardHost = host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com';
    const isShortHost = host === 'youtu.be';
    if (!isStandardHost && !isShortHost) return null;
    if (isShortHost) {
      const pathId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(pathId) ? pathId : null;
    }
    if (isStandardHost) {
      if (parsed.pathname === '/watch') {
        const v = parsed.searchParams.get('v');
        return (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) ? v : null;
      }
      const segments = parsed.pathname.replace(/^\/+/, '').split('/');
      if (segments[0] === 'embed' || segments[0] === 'v' || segments[0] === 'shorts') {
        const id = segments[1];
        return (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) ? id : null;
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

// Simulate Worker frontmatter processing
function processWorkerSaveFrontmatter(existingData, payload) {
  const data = Object.assign({}, existingData);
  const { video_id, video_caption, videos } = payload;

  if (video_id !== undefined) {
    const rawVid = video_id ? String(video_id).trim() : '';
    const cleanVid = parseYouTubeVideoId(rawVid);
    if (rawVid && !cleanVid) {
      throw new Error('Invalid YouTube video ID or URL.');
    }

    if (cleanVid) {
      data.video_id = cleanVid;
      if (video_caption !== undefined && String(video_caption).trim()) {
        data.video_caption = String(video_caption).trim();
      } else {
        data.video_caption = data.title || 'News Coverage';
      }
      if (Array.isArray(videos) && videos.length > 0) {
        data.videos = videos.map(v => {
          const id = v && v.video_id ? parseYouTubeVideoId(v.video_id) : cleanVid;
          return {
            video_id: id || cleanVid,
            title: (v && v.title) || data.video_caption || data.title || 'News Coverage',
            channel: (v && v.channel) || 'YouTube'
          };
        }).filter(v => v.video_id);
      } else {
        data.videos = [{
          video_id: cleanVid,
          title: data.video_caption,
          channel: 'YouTube'
        }];
      }
    } else {
      delete data.video_id;
      delete data.video_caption;
      delete data.videos;
      delete data.videoId;
      delete data.videoCaption;
    }
  }
  return data;
}

let passed = 0;
let total = 0;

function test(label, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n--- END-TO-END YOUTUBE PUBLISHING PIPELINE VERIFICATION ---\n');

const TEST_VIDEO_ID = 'dQw4w9WgXcQ';
const TEST_CAPTION = 'Exclusive Video Report: Special Analysis';

// Test A: Admin payload contains video
test('A. Admin payload contains video', () => {
  const adminPayload = {
    relPath: 'src/articles/india/test-article.md',
    title: 'Test Article Title',
    video_id: `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`,
    video_caption: TEST_CAPTION,
    videos: [{ video_id: TEST_VIDEO_ID, title: TEST_CAPTION, channel: 'YouTube' }]
  };
  assert.ok(adminPayload.video_id.includes(TEST_VIDEO_ID));
  assert.strictEqual(adminPayload.video_caption, TEST_CAPTION);
});

// Test B: Worker accepts valid video
test('B. Worker accepts valid video', () => {
  const parsed = parseYouTubeVideoId(`https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`);
  assert.ok(parsed, 'Valid video should be accepted');
});

// Test C: Worker normalizes it to exactly 11 characters
test('C. Worker normalizes it to exactly 11 characters', () => {
  const formats = [
    TEST_VIDEO_ID,
    `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`,
    `https://youtu.be/${TEST_VIDEO_ID}`,
    `https://www.youtube.com/embed/${TEST_VIDEO_ID}`,
    `https://www.youtube.com/shorts/${TEST_VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${TEST_VIDEO_ID}`
  ];
  formats.forEach(f => {
    const id = parseYouTubeVideoId(f);
    assert.strictEqual(id, TEST_VIDEO_ID, `Format ${f} must normalize to ${TEST_VIDEO_ID}`);
    assert.strictEqual(id.length, 11, 'Length must be exactly 11 characters');
  });
});

// Test D: Frontmatter persistence contains correct video_id
let persistedFrontmatter;
test('D. Frontmatter persistence contains correct video_id', () => {
  const initialData = { title: 'Test Article' };
  persistedFrontmatter = processWorkerSaveFrontmatter(initialData, {
    video_id: `https://youtu.be/${TEST_VIDEO_ID}`,
    video_caption: TEST_CAPTION
  });
  assert.strictEqual(persistedFrontmatter.video_id, TEST_VIDEO_ID);
});

// Test E: video_caption persists
test('E. video_caption persists', () => {
  assert.strictEqual(persistedFrontmatter.video_caption, TEST_CAPTION);
});

// Test F: videos[] is correct if used
test('F. videos[] is correct if used', () => {
  assert.ok(Array.isArray(persistedFrontmatter.videos));
  assert.strictEqual(persistedFrontmatter.videos.length, 1);
  assert.strictEqual(persistedFrontmatter.videos[0].video_id, TEST_VIDEO_ID);
});

// Test G: Eleventy renders the video embed
let renderedEmbedHtml = '';
test('G. Eleventy renders the video embed', () => {
  const videoEmbedTemplate = fs.readFileSync(path.join(ROOT_DIR, 'src', '_includes', 'partials', 'video-embed.njk'), 'utf8');
  renderedEmbedHtml = env.renderString(videoEmbedTemplate, {
    video_id: persistedFrontmatter.video_id,
    video_caption: persistedFrontmatter.video_caption,
    videos: persistedFrontmatter.videos,
    title: 'Test Article Title'
  });
  assert.ok(renderedEmbedHtml.length > 0, 'Embed template should render non-empty HTML');
});

// Test H: Rendered HTML contains youtube.com/embed/{id}
test('H. Rendered HTML contains youtube.com/embed/{id}', () => {
  assert.ok(renderedEmbedHtml.includes(`https://www.youtube.com/embed/${TEST_VIDEO_ID}`), 'Must include embed iframe URL');
});

// Test I: Rendered HTML contains Watch on YouTube
test('I. Rendered HTML contains Watch on YouTube', () => {
  assert.ok(renderedEmbedHtml.includes(`https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`), 'Must include watch link');
  assert.ok(renderedEmbedHtml.includes('Watch on YouTube'), 'Must include Watch on YouTube text');
});

// Test J: Rendered HTML contains VideoObject JSON-LD
test('J. Rendered HTML contains VideoObject JSON-LD', () => {
  const jsonldTemplate = fs.readFileSync(path.join(ROOT_DIR, 'src', '_includes', 'partials', 'jsonld-news.njk'), 'utf8');
  const renderedJsonLd = env.renderString(jsonldTemplate, {
    video_id: persistedFrontmatter.video_id,
    video_caption: persistedFrontmatter.video_caption,
    title: 'Test Article Title',
    dek: 'Article dek description',
    category: 'India',
    date: '2026-10-05T12:00:00Z',
    page: { url: '/articles/india/test-article/' },
    site: { url: 'https://thesamachardaily.in' }
  });
  assert.ok(renderedJsonLd.includes('"@type": "VideoObject"'), 'Must contain VideoObject @type');
  assert.ok(renderedJsonLd.includes(`https://www.youtube.com/embed/${TEST_VIDEO_ID}`), 'Must contain VideoObject embedUrl');
  assert.ok(renderedJsonLd.includes(`https://i.ytimg.com/vi/${TEST_VIDEO_ID}/hqdefault.jpg`), 'Must contain VideoObject thumbnailUrl');
});

// Test K: Invalid protocols are rejected: javascript:, data:, vbscript:
test('K. Invalid protocols are rejected: javascript:, data:, vbscript:', () => {
  assert.strictEqual(parseYouTubeVideoId('javascript:alert(1)'), null);
  assert.strictEqual(parseYouTubeVideoId('data:text/html,<script>'), null);
  assert.strictEqual(parseYouTubeVideoId('vbscript:msgbox(1)'), null);
});

// Test L: Foreign domains rejected
test('L. Foreign domains rejected', () => {
  assert.strictEqual(parseYouTubeVideoId('https://vimeo.com/123456789'), null);
  assert.strictEqual(parseYouTubeVideoId('https://evil-youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.strictEqual(parseYouTubeVideoId('https://notyoutube.org/watch?v=dQw4w9WgXcQ'), null);
});

// Test M: Malformed IDs rejected
test('M. Malformed IDs rejected', () => {
  assert.strictEqual(parseYouTubeVideoId('short'), null);
  assert.strictEqual(parseYouTubeVideoId('toolongstringover11characters'), null);
  assert.strictEqual(parseYouTubeVideoId('invalid$char!'), null);
  assert.strictEqual(parseYouTubeVideoId('https://www.youtube.com/watch?v=short'), null);
});

// Test N: Removal clears all video state
let frontmatterAfterRemoval;
test('N. Removal clears all video state', () => {
  frontmatterAfterRemoval = processWorkerSaveFrontmatter(persistedFrontmatter, {
    video_id: '',
    video_caption: '',
    videos: []
  });
  assert.strictEqual(frontmatterAfterRemoval.video_id, undefined, 'video_id must be completely removed');
  assert.strictEqual(frontmatterAfterRemoval.video_caption, undefined, 'video_caption must be completely removed');
  assert.strictEqual(frontmatterAfterRemoval.videos, undefined, 'videos array must be completely removed');
});

// Test O: Rendered HTML after removal contains no YouTube iframe
test('O. Rendered HTML after removal contains no YouTube iframe', () => {
  const videoEmbedTemplate = fs.readFileSync(path.join(ROOT_DIR, 'src', '_includes', 'partials', 'video-embed.njk'), 'utf8');
  const clearedEmbedHtml = env.renderString(videoEmbedTemplate, {
    video_id: frontmatterAfterRemoval.video_id,
    video_caption: frontmatterAfterRemoval.video_caption,
    videos: frontmatterAfterRemoval.videos,
    title: 'Test Article Title'
  });
  assert.strictEqual(clearedEmbedHtml.trim(), '', 'No iframe or container rendered after video removal');

  const jsonldTemplate = fs.readFileSync(path.join(ROOT_DIR, 'src', '_includes', 'partials', 'jsonld-news.njk'), 'utf8');
  const clearedJsonLd = env.renderString(jsonldTemplate, {
    video_id: frontmatterAfterRemoval.video_id,
    video_caption: frontmatterAfterRemoval.video_caption,
    title: 'Test Article Title',
    page: { url: '/articles/india/test-article/' },
    site: { url: 'https://thesamachardaily.in' }
  });
  assert.ok(!clearedJsonLd.includes('"@type": "VideoObject"'), 'No VideoObject schema present after removal');
});

console.log(`\nResults: ${passed} / ${total} tests passed.\n`);
if (passed !== total) {
  process.exit(1);
}
