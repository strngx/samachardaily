const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const articlesDir = path.join(rootDir, 'src', 'articles');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, body: content };
  const rawYaml = match[1];
  const body = content.slice(match[0].length).trim();
  const data = {};
  
  const lines = rawYaml.split('\n');
  let currentKey = null;
  let multilineVal = [];

  for (let line of lines) {
    line = line.trimEnd();
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey && multilineVal.length > 0) {
        data[currentKey] = multilineVal.join('\n').trim();
        multilineVal = [];
      }
      currentKey = keyMatch[1];
      let val = keyMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.slice(1, -1).replace(/\\"/g, '"');
      } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
        val = val.slice(1, -1);
      }
      data[currentKey] = val;
    } else if (currentKey) {
      multilineVal.push(line);
    }
  }
  if (currentKey && multilineVal.length > 0) {
    data[currentKey] = multilineVal.join('\n').trim();
  }

  return { data, body };
}

function runMasterDataCollection() {
  console.log('--- Collecting Master Data ---');

  // Git data
  const branch = execSync('git branch --show-current', { cwd: rootDir }).toString().trim();
  const headLog = execSync('git log -5 --oneline', { cwd: rootDir }).toString().trim();
  
  // Articles
  const allArticles = getAllFiles(articlesDir);
  const categories = { india: 0, world: 0, business: 0, tech: 0, sports: 0 };
  const wordBuckets = {
    under100: 0,
    w100_149: 0,
    w150_199: 0,
    w200_299: 0,
    w300_499: 0,
    w500plus: 0
  };

  let noindexCount = 0;
  let quarantinedCount = 0;
  const domainSources = {};
  const phraseCounts = {
    "underscores the importance": 0,
    "comes amid": 0,
    "highlights the growing": 0,
    "pivotal moment": 0,
    "crucial step": 0,
    "remains to be seen": 0,
    "in a significant development": 0,
    "according to reports": 0,
    "industry experts": 0,
    "only time will tell": 0
  };

  const articleDetails = [];

  for (const f of allArticles) {
    const raw = fs.readFileSync(f, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const rel = path.relative(rootDir, f).replace(/\\/g, '/');

    const cat = (data.category || '').toLowerCase();
    if (categories[cat] !== undefined) categories[cat]++;

    const isNoindex = data.noindex === 'true' || data.noindex === true;
    const isQuarantined = rel.includes('/quarantine/') || data.quarantine === 'true' || data.quarantine === true;

    if (isNoindex) noindexCount++;
    if (isQuarantined) quarantinedCount++;

    const fullText = (body + ' ' + (data.why_it_matters || '') + ' ' + (data.what_happens_next || '')).replace(/<[^>]+>/g, ' ');
    const words = fullText.trim().split(/\s+/).filter(w => w.length > 0);
    const wc = words.length;

    if (wc < 100) wordBuckets.under100++;
    else if (wc < 150) wordBuckets.w100_149++;
    else if (wc < 200) wordBuckets.w150_199++;
    else if (wc < 300) wordBuckets.w200_299++;
    else if (wc < 500) wordBuckets.w300_499++;
    else wordBuckets.w500plus++;

    // Domain extraction
    if (data.sourceUrl) {
      try {
        const u = new URL(data.sourceUrl);
        const host = u.hostname.replace(/^www\./, '');
        domainSources[host] = (domainSources[host] || 0) + 1;
      } catch (e) {
        domainSources['unknown/invalid'] = (domainSources['unknown/invalid'] || 0) + 1;
      }
    }

    // Phrase counts
    const lower = fullText.toLowerCase();
    for (const ph of Object.keys(phraseCounts)) {
      if (lower.includes(ph)) phraseCounts[ph]++;
    }

    articleDetails.push({
      rel,
      slug: data.slug,
      title: data.title,
      cat,
      wc,
      sourceUrl: data.sourceUrl,
      sourceName: data.sourceName,
      isNoindex
    });
  }

  // Top domains
  const sortedDomains = Object.entries(domainSources).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const stats = {
    branch,
    headLog,
    totalArticles: allArticles.length,
    indexableArticles: allArticles.length - noindexCount - quarantinedCount,
    noindexCount,
    quarantinedCount,
    categories,
    wordBuckets,
    legacyUnder150: wordBuckets.under100 + wordBuckets.w100_149,
    topSourceDomains: sortedDomains,
    phraseCounts
  };

  fs.writeFileSync(path.join(rootDir, 'scratch', 'master_audit_stats.json'), JSON.stringify(stats, null, 2));
  console.log(JSON.stringify(stats, null, 2));
}

runMasterDataCollection();
