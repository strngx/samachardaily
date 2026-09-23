const fs = require('fs');
const path = require('path');

const articlesDir = path.join(__dirname, '..', 'src', 'articles');

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
  
  // Basic parsing for key fields
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

function runInventoryAudit() {
  const allFiles = getAllFiles(articlesDir);
  console.log(`Total article markdown files: ${allFiles.length}`);

  const inventory = [];
  const categories = { india: 0, world: 0, business: 0, tech: 0, sports: 0, other: 0 };
  const wordCountBuckets = {
    under150: 0,
    w150_250: 0,
    w250_400: 0,
    w400_600: 0,
    w600_800: 0,
    over800: 0
  };

  let noindexCount = 0;
  let quarantinedCount = 0;
  let singleSourceCount = 0;
  let multiSourceCount = 0;
  let noSourceCount = 0;
  let pexelsImageCount = 0;
  let unsplashImageCount = 0;
  let otherImageCount = 0;
  let videoCount = 0;
  let whatHappensNextCount = 0;
  let whyItMattersCount = 0;

  for (const file of allFiles) {
    const raw = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const relPath = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');

    // determine category
    const cat = (data.category || '').toLowerCase();
    if (categories[cat] !== undefined) {
      categories[cat]++;
    } else {
      categories.other++;
    }

    const isNoindex = data.noindex === 'true' || data.noindex === true;
    const isQuarantined = relPath.includes('/quarantine/') || data.quarantine === 'true' || data.quarantine === true;

    if (isNoindex) noindexCount++;
    if (isQuarantined) quarantinedCount++;

    // word count of full content + why_it_matters + what_happens_next
    const fullText = (body + ' ' + (data.why_it_matters || '') + ' ' + (data.what_happens_next || '')).replace(/<[^>]+>/g, ' ');
    const words = fullText.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    if (wordCount < 150) wordCountBuckets.under150++;
    else if (wordCount < 250) wordCountBuckets.w150_250++;
    else if (wordCount < 400) wordCountBuckets.w250_400++;
    else if (wordCount < 600) wordCountBuckets.w400_600++;
    else if (wordCount < 800) wordCountBuckets.w600_800++;
    else wordCountBuckets.over800++;

    // source analysis
    const hasSourceUrl = Boolean(data.sourceUrl && data.sourceUrl.trim().length > 0);
    const hasSourceName = Boolean(data.sourceName && data.sourceName.trim().length > 0);
    
    // Check for multiple sources in body or frontmatter
    const bodyLinks = (body.match(/https?:\/\/[^\s\)"']+/g) || []);
    const sourceCount = (hasSourceUrl ? 1 : 0) + (bodyLinks.filter(l => !l.includes('thesamachardaily.in') && !l.includes('youtube.com') && !l.includes('images.pexels.com')).length);

    if (sourceCount === 0) noSourceCount++;
    else if (sourceCount === 1) singleSourceCount++;
    else multiSourceCount++;

    // image check
    const imgUrl = data.image || '';
    if (imgUrl.includes('pexels.com')) pexelsImageCount++;
    else if (imgUrl.includes('unsplash.com')) unsplashImageCount++;
    else if (imgUrl.length > 0) otherImageCount++;

    // video check
    if (data.video_id && data.video_id.trim().length > 0) videoCount++;
    if (data.what_happens_next && data.what_happens_next.trim().length > 0) whatHappensNextCount++;
    if (data.why_it_matters && data.why_it_matters.trim().length > 0) whyItMattersCount++;

    inventory.push({
      relPath,
      title: data.title || '',
      seoTitle: data.seoTitle || '',
      category: data.category || '',
      date: data.date || '',
      author: data.author || '',
      sourceName: data.sourceName || '',
      sourceUrl: data.sourceUrl || '',
      sourceCount,
      wordCount,
      isNoindex,
      isQuarantined,
      imageCredit: data.imageCredit || '',
      hasVideo: Boolean(data.video_id),
      hasWhyItMatters: Boolean(data.why_it_matters),
      hasWhatHappensNext: Boolean(data.what_happens_next)
    });
  }

  const result = {
    totalArticles: allFiles.length,
    indexable: allFiles.length - noindexCount - quarantinedCount,
    noindexCount,
    quarantinedCount,
    categories,
    wordCountBuckets,
    sources: {
      singleSourceCount,
      singleSourcePercent: ((singleSourceCount / allFiles.length) * 100).toFixed(2),
      multiSourceCount,
      multiSourcePercent: ((multiSourceCount / allFiles.length) * 100).toFixed(2),
      noSourceCount,
      noSourcePercent: ((noSourceCount / allFiles.length) * 100).toFixed(2)
    },
    media: {
      pexelsImageCount,
      unsplashImageCount,
      otherImageCount,
      videoCount,
      whyItMattersCount,
      whatHappensNextCount
    }
  };

  fs.writeFileSync(path.join(__dirname, '..', 'scratch', 'phase12a_inventory_summary.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'scratch', 'phase12a_articles_inventory.json'), JSON.stringify(inventory, null, 2));

  console.log('Summary:', JSON.stringify(result, null, 2));
}

runInventoryAudit();
