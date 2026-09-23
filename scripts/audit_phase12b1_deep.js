const fs = require('fs');
const path = require('path');

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

function parseArticle(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, body: content, raw: content };
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

  return { data, body, raw: content, filePath };
}

function runDeepPhraseAudit() {
  const allFiles = getAllFiles(articlesDir);
  const articles = allFiles.map(parseArticle);

  const targetPhrases = [
    "underscores the importance",
    "underscores the",
    "comes amid",
    "comes at a time when",
    "highlights the growing",
    "marks a significant",
    "signals a broader",
    "reflects growing",
    "against the backdrop",
    "in a move that",
    "as the industry",
    "the development comes",
    "pivotal moment",
    "remains to be seen",
    "crucial step",
    "only time will tell",
    "industry experts",
    "in a significant development"
  ];

  const phraseStats = {};
  for (const ph of targetPhrases) {
    phraseStats[ph] = { count: 0, sampleUrls: [], locations: { body: 0, why_it_matters: 0, what_happens_next: 0, dek: 0 } };
  }

  for (const art of articles) {
    const slug = art.data.slug || path.basename(art.filePath, '.md');
    const cat = art.data.category ? art.data.category.toLowerCase() : 'india';
    const prodUrl = `https://thesamachardaily.in/articles/${cat}/${slug}/`;

    const body = (art.body || '').toLowerCase();
    const why = (art.data.why_it_matters || '').toLowerCase();
    const next = (art.data.what_happens_next || '').toLowerCase();
    const dek = (art.data.dek || '').toLowerCase();

    for (const ph of targetPhrases) {
      let foundInArt = false;
      if (body.includes(ph)) {
        phraseStats[ph].locations.body++;
        foundInArt = true;
      }
      if (why.includes(ph)) {
        phraseStats[ph].locations.why_it_matters++;
        foundInArt = true;
      }
      if (next.includes(ph)) {
        phraseStats[ph].locations.what_happens_next++;
        foundInArt = true;
      }
      if (dek.includes(ph)) {
        phraseStats[ph].locations.dek++;
        foundInArt = true;
      }

      if (foundInArt) {
        phraseStats[ph].count++;
        if (phraseStats[ph].sampleUrls.length < 5) {
          phraseStats[ph].sampleUrls.push({ url: prodUrl, title: art.data.title });
        }
      }
    }
  }

  fs.writeFileSync(path.join(rootDir, 'scratch', 'phase12b1_phrase_stats.json'), JSON.stringify(phraseStats, null, 2));
  console.log('Phrase Stats:');
  for (const [k, v] of Object.entries(phraseStats)) {
    console.log(`  "${k}": ${v.count} articles (Locations: Body=${v.locations.body}, Why=${v.locations.why_it_matters}, Next=${v.locations.what_happens_next}, Dek=${v.locations.dek})`);
  }
}

runDeepPhraseAudit();
