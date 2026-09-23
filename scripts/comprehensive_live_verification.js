const https = require('https');

const BASE_URL = 'https://thesamachardaily.in';

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    const url = BASE_URL + path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          contentType: res.headers['content-type'],
          contentLength: buffer.length,
          bodyText: buffer.toString('utf8')
        });
      });
    }).on('error', reject);
  });
}

async function runLiveAudit() {
  console.log('============================================================');
  console.log('PHASE 10B LIVE PRODUCTION AUDIT & VERIFICATION');
  console.log('Base URL: ' + BASE_URL);
  console.log('Timestamp: ' + new Date().toISOString());
  console.log('============================================================\n');

  // 1. Favicon Suite Endpoints
  console.log('--- 1. FAVICON SUITE ENDPOINTS ---');
  const iconEndpoints = [
    '/favicon.ico',
    '/apple-touch-icon.png',
    '/site.webmanifest',
    '/assets/images/favicon.svg',
    '/assets/images/favicon-16x16.png',
    '/assets/images/favicon-32x32.png',
    '/assets/images/favicon-48x48.png',
    '/assets/images/apple-touch-icon.png',
    '/assets/images/icon-192.png',
    '/assets/images/icon-512.png'
  ];

  let iconFailures = 0;
  for (const ep of iconEndpoints) {
    const res = await fetchUrl(ep);
    const pass = res.statusCode === 200 && res.contentLength > 50;
    if (!pass) iconFailures++;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${ep} -> Status: ${res.statusCode}, Content-Type: ${res.contentType}, Size: ${res.contentLength} bytes`);
  }

  // 2. Homepage Deep Audit
  console.log('\n--- 2. HOMEPAGE DEEP AUDIT (/) ---');
  const homeRes = await fetchUrl('/');
  console.log(`Status: ${homeRes.statusCode}, Content-Type: ${homeRes.contentType}, Size: ${homeRes.contentLength} bytes`);

  const homeHtml = homeRes.bodyText;

  // Title
  const titleMatch = homeHtml.match(/<title>([^<]+)<\/title>/);
  console.log(`Title: "${titleMatch ? titleMatch[1] : 'NONE'}"`);

  // Canonical
  const canonicalMatch = homeHtml.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
  console.log(`Canonical: "${canonicalMatch ? canonicalMatch[1] : 'NONE'}"`);

  // Robots
  const robotsMatch = homeHtml.match(/<meta[^>]+name="robots"[^>]+content="([^"]+)"/);
  console.log(`Robots: "${robotsMatch ? robotsMatch[1] : 'NONE'}"`);

  // og:site_name
  const ogSiteName = homeHtml.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/);
  console.log(`og:site_name: "${ogSiteName ? ogSiteName[1] : 'NONE'}"`);

  // H1 and H2
  const h1Matches = homeHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  console.log(`H1 count: ${h1Matches.length}`);
  h1Matches.forEach((h, i) => console.log(`  H1[${i}]: ${h.trim()}`));

  const leadHeadlineH2 = homeHtml.includes('<h2 class="lead-headline">');
  console.log(`Lead story headline is H2: ${leadHeadlineH2}`);

  // Head icon links
  const headIconTags = homeHtml.match(/<link[^>]+rel="[^"]*icon[^"]*"[^>]*>/gi) || [];
  const manifestTag = homeHtml.match(/<link[^>]+rel="manifest"[^>]*>/gi) || [];
  console.log('Head icon links:');
  headIconTags.forEach(t => console.log('  ' + t));
  manifestTag.forEach(t => console.log('  ' + t));

  // JSON-LD entities
  const jsonLdBlocks = [];
  const jsonLdRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(homeHtml)) !== null) {
    try {
      jsonLdBlocks.push(JSON.parse(match[1]));
    } catch (e) {
      console.error('JSON-LD parse error:', e.message);
    }
  }

  console.log('\nJSON-LD Blocks on Homepage:');
  jsonLdBlocks.forEach((block, idx) => {
    console.log(`Block ${idx + 1}:`);
    console.log(JSON.stringify(block, null, 2));
  });

  // 3. Live Articles Audit (3 categories)
  console.log('\n--- 3. LIVE ARTICLES AUDIT ---');
  const articlesToAudit = [
    { cat: 'Tech', path: '/articles/tech/cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence/' },
    { cat: 'Business', path: '/articles/business/bank-strike-hits-assam-demands-fiveday-week-pension-overhaul-pli-repeal/' },
    { cat: 'World', path: '/articles/world/witkoff-and-kushner-arrive-in-moscow-as-zelenskyy-demands-air-pause/' }
  ];

  for (const art of articlesToAudit) {
    console.log(`\nAuditing Article [${art.cat}]: ${art.path}`);
    const artRes = await fetchUrl(art.path);
    console.log(`  Status: ${artRes.statusCode}, Size: ${artRes.contentLength} bytes`);

    const artHtml = artRes.bodyText;
    const artCanonical = artHtml.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
    const artRobots = artHtml.match(/<meta[^>]+name="robots"[^>]+content="([^"]+)"/);
    console.log(`  Canonical: "${artCanonical ? artCanonical[1] : 'NONE'}"`);
    console.log(`  Robots: "${artRobots ? artRobots[1] : 'NONE'}"`);

    let artSchemas = [];
    let sm;
    while ((sm = jsonLdRegex.exec(artHtml)) !== null) {
      try {
        artSchemas.push(JSON.parse(sm[1]));
      } catch (e) {}
    }

    const newsSchema = artSchemas.find(s => s['@type'] === 'NewsArticle');
    const breadcrumbSchema = artSchemas.find(s => s['@type'] === 'BreadcrumbList');

    if (newsSchema) {
      console.log(`  [PASS] NewsArticle schema present`);
      console.log(`    Headline: "${newsSchema.headline}"`);
      console.log(`    Publisher Type: "${newsSchema.publisher?.['@type']}"`);
      console.log(`    Publisher Name: "${newsSchema.publisher?.name}"`);
      console.log(`    Publisher URL: "${newsSchema.publisher?.url}"`);
      console.log(`    Publisher Logo: "${newsSchema.publisher?.logo?.url || newsSchema.publisher?.logo}"`);
    } else {
      console.error(`  [FAIL] NewsArticle schema missing`);
    }

    if (breadcrumbSchema) {
      console.log(`  [PASS] BreadcrumbList schema present (${breadcrumbSchema.itemListElement?.length || 0} items)`);
    } else {
      console.error(`  [FAIL] BreadcrumbList schema missing`);
    }
  }

  // 4. Sitemap & Robots Audit
  console.log('\n--- 4. SITEMAP & ROBOTS AUDIT ---');
  const robotsRes = await fetchUrl('/robots.txt');
  console.log(`GET /robots.txt -> Status: ${robotsRes.statusCode}, Size: ${robotsRes.contentLength} bytes`);
  console.log('Content:\n' + robotsRes.bodyText.trim());

  const sitemapRes = await fetchUrl('/sitemap.xml');
  console.log(`\nGET /sitemap.xml -> Status: ${sitemapRes.statusCode}, Size: ${sitemapRes.contentLength} bytes`);
  const sitemapUrlCount = (sitemapRes.bodyText.match(/<loc>/g) || []).length;
  console.log(`Sitemap <loc> URLs count: ${sitemapUrlCount}`);

  // 5. Static Pages Audit
  console.log('\n--- 5. STATIC PAGES AUDIT ---');
  const staticPages = ['/about/', '/contact/', '/privacy/', '/terms/', '/editorial/'];
  for (const sp of staticPages) {
    const res = await fetchUrl(sp);
    const hasMediaName = res.bodyText.includes('SamacharDaily Media');
    console.log(`GET ${sp} -> Status: ${res.statusCode}, Size: ${res.contentLength} bytes, Contains 'SamacharDaily Media': ${hasMediaName}`);
  }

  console.log('\n============================================================');
  console.log('LIVE PRODUCTION AUDIT COMPLETE');
  console.log('============================================================');
}

runLiveAudit();
