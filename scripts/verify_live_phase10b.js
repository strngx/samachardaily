const https = require('https');

const BASE_URL = 'https://thesamachardaily.in';

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    const url = BASE_URL + path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    https.get(url, { headers: { 'User-Agent': 'Phase10BVerifier/1.0' } }, (res) => {
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

async function checkDeployment() {
  console.log('Checking live deployment status...');
  
  // Check favicon.ico
  const fav = await fetchUrl('/favicon.ico');
  console.log(`GET /favicon.ico -> HTTP ${fav.statusCode}, Content-Type: ${fav.contentType}, Size: ${fav.contentLength} bytes`);

  // Check manifest
  const manifest = await fetchUrl('/site.webmanifest');
  console.log(`GET /site.webmanifest -> HTTP ${manifest.statusCode}, Content-Type: ${manifest.contentType}, Size: ${manifest.contentLength} bytes`);

  // Check homepage
  const home = await fetchUrl('/');
  console.log(`GET / -> HTTP ${home.statusCode}, Size: ${home.contentLength} bytes`);
  
  const hasWebsiteSchema = home.bodyText.includes('"@type":"WebSite"') || home.bodyText.includes('"@type": "WebSite"');
  const hasH1Brand = home.bodyText.includes('SamacharDaily — News, Fast. Trends, Explained.</h1>');
  const hasFaviconLink = home.bodyText.includes('rel="icon" href="/favicon.ico"');
  const hasLeadH2 = home.bodyText.includes('<h2 class="lead-headline">');

  console.log(`  - Has WebSite Schema: ${hasWebsiteSchema}`);
  console.log(`  - Has Semantic H1 Brand: ${hasH1Brand}`);
  console.log(`  - Has Favicon <link>: ${hasFaviconLink}`);
  console.log(`  - Has Lead Headline H2: ${hasLeadH2}`);

  const isLive = fav.statusCode === 200 && manifest.statusCode === 200 && hasWebsiteSchema && hasH1Brand;
  return isLive;
}

async function poll(maxAttempts = 30, intervalMs = 10000) {
  for (let i = 1; i <= maxAttempts; i++) {
    console.log(`\n--- Poll Attempt ${i}/${maxAttempts} (${new Date().toISOString()}) ---`);
    try {
      const isLive = await checkDeployment();
      if (isLive) {
        console.log('\n>>> LIVE DEPLOYMENT CONFIRMED! <<<');
        return true;
      }
    } catch (e) {
      console.error('Error during fetch:', e.message);
    }
    if (i < maxAttempts) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  console.error('\n>>> Deployment polling timed out. <<<');
  return false;
}

poll();
