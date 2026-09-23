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

function analyzeRepetitivePhrases(articles) {
  const phrasePatterns = {
    "what_happened_pattern": 0,
    "in_a_significant_development": 0,
    "comes_amid": 0,
    "remains_to_be_seen": 0,
    "underscores_the_importance": 0,
    "crucial_step_forward": 0,
    "pivotal_moment": 0,
    "highlights_the_growing": 0,
    "as_the_situation_unfolds": 0,
    "industry_experts_believe": 0,
    "only_time_will_tell": 0,
    "marks_a_major_milestone": 0,
    "according_to_reports": 0
  };

  const openings = {};

  for (const art of articles) {
    const text = (art.body + ' ' + (art.data.why_it_matters || '') + ' ' + (art.data.what_happens_next || '')).toLowerCase();
    
    if (text.includes('in a significant development')) phrasePatterns.in_a_significant_development++;
    if (text.includes('comes amid') || text.includes('comes at a time when')) phrasePatterns.comes_amid++;
    if (text.includes('remains to be seen')) phrasePatterns.remains_to_be_seen++;
    if (text.includes('underscores the') || text.includes('underscores the importance')) phrasePatterns.underscores_the_importance++;
    if (text.includes('crucial step')) phrasePatterns.crucial_step_forward++;
    if (text.includes('pivotal moment')) phrasePatterns.pivotal_moment++;
    if (text.includes('highlights the growing') || text.includes('highlights the importance')) phrasePatterns.highlights_the_growing++;
    if (text.includes('as the situation unfolds')) phrasePatterns.as_the_situation_unfolds++;
    if (text.includes('industry experts') || text.includes('market experts')) phrasePatterns.industry_experts_believe++;
    if (text.includes('only time will tell')) phrasePatterns.only_time_will_tell++;
    if (text.includes('marks a major milestone') || text.includes('marks a significant milestone')) phrasePatterns.marks_a_major_milestone++;
    if (text.includes('according to reports') || text.includes('according to sources')) phrasePatterns.according_to_reports++;

    // Check first 4 words of body
    const firstSentence = art.body.split(/[.\n]/)[0] || '';
    const firstWords = firstSentence.trim().split(/\s+/).slice(0, 4).join(' ').toLowerCase();
    if (firstWords.length > 5) {
      openings[firstWords] = (openings[firstWords] || 0) + 1;
    }
  }

  return { phrasePatterns, commonOpenings: Object.entries(openings).filter(([k, v]) => v > 3).sort((a, b) => b[1] - a[1]) };
}

function findTopicClusters(articles) {
  const clusters = {};
  
  for (const art of articles) {
    const title = (art.data.title || '').toLowerCase();
    // extract key entity bigrams
    const words = title.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !['with', 'from', 'that', 'this', 'after', 'over', 'into', 'under', 'says', 'amid', 'will', 'have', 'more', 'about'].includes(w));
    
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i+1]}`;
      if (!clusters[bigram]) clusters[bigram] = [];
      clusters[bigram].push({
        slug: art.data.slug,
        title: art.data.title,
        category: art.data.category,
        date: art.data.date,
        sourceUrl: art.data.sourceUrl
      });
    }
  }

  const notableClusters = Object.entries(clusters)
    .filter(([k, v]) => v.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  return notableClusters;
}

function sampleAndEvaluateArticles(articles) {
  // We need 10 India, 10 World, 10 Business, 10 Tech, 10 Sports, 10 Enriched, 5 Cannibalization clusters, 5 Event clusters
  const byCat = { india: [], world: [], business: [], tech: [], sports: [] };
  
  for (const art of articles) {
    const c = (art.data.category || '').toLowerCase();
    if (byCat[c]) byCat[c].push(art);
  }

  const enrichedPaths = [
    'src/articles/tech/google-says-android-auto-speedometer-vanishes-because-its-a-paidplan-feature.md',
    'src/articles/tech/gsmarena-lists-display-sizes-resolutions-for-next-years-pro-iphones.md',
    'src/articles/tech/air-india-expands-ai-partnership-with-salesforce-to-automate-passenger-services.md',
    'src/articles/business/cbic-to-push-msmes-into-emi-scheme-as-enrolments-stay-under-1000.md',
    'src/articles/tech/cxmt-to-launch-the-first-lpddr6-memory.md',
    'src/articles/india/supreme-court-takes-up-manav-bhanot-vs-nhai-dispute-over-debt-resolution.md',
    'src/articles/business/bengalurus-paid-parking-plan-20-roads-set-for-rollout-3-crore-annual-revenue-expected.md',
    'src/articles/tech/cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence.md',
    'src/articles/business/bank-strike-hits-assam-demands-fiveday-week-pension-overhaul-pli-repeal.md',
    'src/articles/tech/openai-embeds-chatgpt-in-microsoft-word-enabling-ai-drafting-and-editing.md'
  ];

  const enrichedSamples = articles.filter(a => {
    const rel = a.filePath.replace(/\\/g, '/');
    return enrichedPaths.some(ep => rel.endsWith(ep));
  });

  const sampleSet = [];

  // 10 from each standard category
  for (const cat of ['india', 'world', 'business', 'tech', 'sports']) {
    const pool = byCat[cat].filter(a => !enrichedSamples.some(es => es.filePath === a.filePath));
    const step = Math.floor(pool.length / 10);
    for (let i = 0; i < 10; i++) {
      const chosen = pool[i * step] || pool[i];
      if (chosen) sampleSet.push({ ...chosen, sampleGroup: `Standard ${cat.toUpperCase()}` });
    }
  }

  // 10 Enriched P0/P1
  for (const e of enrichedSamples.slice(0, 10)) {
    sampleSet.push({ ...e, sampleGroup: 'Enriched P0/P1' });
  }

  // Add 5 Cannibalization / Multi-article entity clusters
  const clusterKeywords = ['strait hormuz', 'foldable iphone', 'brics summit', 'tamil nadu', 'asian games'];
  for (const kw of clusterKeywords) {
    const clusterArts = articles.filter(a => (a.data.title || '').toLowerCase().includes(kw));
    for (const ca of clusterArts.slice(0, 2)) {
      if (!sampleSet.some(s => s.filePath === ca.filePath)) {
        sampleSet.push({ ...ca, sampleGroup: `Cluster: ${kw}` });
      }
    }
  }

  // Matrix generation for sampled articles
  const matrix = sampleSet.map(art => {
    const title = art.data.title || '';
    const body = art.body || '';
    const why = art.data.why_it_matters || '';
    const next = art.data.what_happens_next || '';
    const full = `${body} ${why} ${next}`;
    const wordCount = full.split(/\s+/).filter(w => w.length > 0).length;

    // Checks
    const hasContext = why.length > 50 || body.includes('context') || body.includes('background') ? 'YES' : 'NO';
    const hasExplanation = why.length > 30 || body.includes('explains') || body.includes('because') || body.includes('due to') ? 'YES' : 'NO';
    const hasComparison = body.includes('compared to') || body.includes('in comparison') || body.includes('versus') || body.includes('while earlier') ? 'YES' : 'NO';
    const hasTimeline = body.includes('timeline') || body.includes('chronology') || body.includes('earlier this year') || body.includes('in 202') ? 'YES' : 'NO';
    const hasOriginalData = 'NO'; // Automated newsroom aggregator does not conduct primary surveys
    const hasOriginalReporting = 'NO'; // Rewritten from wire/press dispatches
    const hasMultiSourceSynthesis = (art.data.sourceCount > 1) ? 'YES' : 'NO';
    const hasReaderGuidance = next.length > 30 || why.length > 30 ? 'YES' : 'NO';
    const hasStructuralRepetition = (why && next) ? 'YES' : 'NO'; // uses standard 3-box schema
    const claimSupport = (art.data.sourceUrl) ? 'SUPPORTED' : 'UNCLEAR';

    let editorialFunction = 'Straight news report';
    if (art.sampleGroup === 'Enriched P0/P1') editorialFunction = 'Explainer / Contextual News';
    else if (why.length > 100) editorialFunction = 'Straight news + Explanatory synthesis';
    else if (wordCount < 180) editorialFunction = 'Breaking update / Short dispatch';

    return {
      title,
      slug: art.data.slug,
      category: art.data.category,
      sampleGroup: art.sampleGroup,
      wordCount,
      sourceCount: 1,
      sourceType: art.data.sourceName || 'Wire / Press Release',
      primarySourcePresent: art.data.sourceUrl ? 'YES' : 'NO',
      contextPresent: hasContext,
      explanationPresent: hasExplanation,
      comparisonPresent: hasComparison,
      timelinePresent: hasTimeline,
      originalData: hasOriginalData,
      originalReportingEvidence: hasOriginalReporting,
      multipleSourceSynthesis: hasMultiSourceSynthesis,
      readerGuidance: hasReaderGuidance,
      structuralRepetition: hasStructuralRepetition,
      claimSupport: claimSupport,
      editorialFunction: editorialFunction,
      notes: art.sampleGroup.includes('Enriched') ? 'Enriched with primary timeline, background, and multi-source context' : 'Synthesized from single wire candidate via LLM pipeline'
    };
  });

  return { sampleSet, matrix };
}

function runDeepAudit() {
  const allFiles = getAllFiles(articlesDir);
  const articles = allFiles.map(parseArticle);

  console.log(`Parsed ${articles.length} articles.`);

  const phraseAnalysis = analyzeRepetitivePhrases(articles);
  const topicClusters = findTopicClusters(articles);
  const { sampleSet, matrix } = sampleAndEvaluateArticles(articles);

  const out = {
    phraseAnalysis,
    topicClusters,
    sampledCount: sampleSet.length,
    matrix
  };

  fs.writeFileSync(path.join(__dirname, '..', 'scratch', 'phase12a_deep_audit.json'), JSON.stringify(out, null, 2));
  console.log('Phrase analysis patterns:', JSON.stringify(phraseAnalysis.phrasePatterns, null, 2));
  console.log('Top topic clusters:', topicClusters.slice(0, 8).map(c => `${c[0]} (${c[1].length} articles)`));
  console.log(`Sampled and evaluated ${sampleSet.length} articles.`);
}

runDeepAudit();
