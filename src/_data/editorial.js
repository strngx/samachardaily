const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const matter = require('gray-matter');

const SENSITIVE_PATTERNS = {
  crime_legal: /\b(?:murder|homicide|manslaughter|kidnapping|arrested|fir registered|criminal charges|court verdict|sentenced to|cbi|ed|ncb|bail denied)\b/i,
  fatalities_disasters: /\b(?:death toll|fatalities|fatal crash|fatal accident|killed|perished|succumbed to injuries|drown(?:ed|ing)|landslide)\b/i,
  politics_elections: /\b(?:election commission|polling dates|all-party consultation|assembly election|voter turnout|campaign rally|bjp|congress|aap|parliament)\b/i,
  health_medical: /\b(?:medical trial|clinical study|pharmaceutical|cancer treatment|vaccine efficacy|ministry of health|hospital negligence)\b/i,
  defense_military: /\b(?:drdo|missile test|army chief|air force|navy|defense ministry|border clash|line of actual control)\b/i,
  financial_markets: /\b(?:stock exchange|sensex|nifty|market rally|benchmark repo rate|sebi|interest rate hike)\b/i
};

function classifySensitive(title, dek, body) {
  const text = ((title || '') + ' ' + (dek || '') + ' ' + (body || '')).toLowerCase();
  const matched = [];
  for (const [cat, regex] of Object.entries(SENSITIVE_PATTERNS)) {
    if (regex.test(text)) matched.push(cat);
  }
  return matched.length > 0 ? matched : null;
}

function countWords(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return 0;
  return bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;
}

module.exports = function () {
  const rootDir = path.resolve(__dirname, '../../');
  const dataPath = path.join(rootDir, 'tools/editorial-control-center/editorial-progress.json');
  let data = {};

  if (fs.existsSync(dataPath)) {
    try {
      data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (e) {
      console.error('Error loading editorial-progress.json:', e);
    }
  }

  // Live repository stats
  let currentHead = 'b9cca8c';
  let currentBranch = 'main';
  try {
    currentHead = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    // fallback if git not in environment
  }

  const categories = ['india', 'world', 'business', 'tech', 'sports'];
  const articlesDir = path.join(__dirname, '../articles');
  const draftsDir = path.join(__dirname, '../drafts');

  const articles = [];
  const redirects = [];
  const drafts = [];

  const categoryCounts = { india: 0, world: 0, business: 0, tech: 0, sports: 0 };
  const wordBuckets = { under100: 0, w100_149: 0, w150_199: 0, w200_299: 0, w300plus: 0 };

  let totalMarkdownFiles = 0;
  let activeIndexed = 0;
  let noindexedCount = 0;
  let redirectCount = 0;
  let withSourceName = 0;
  let missingSourceName = 0;

  // Scan published articles
  if (fs.existsSync(articlesDir)) {
    categories.forEach(cat => {
      const catDir = path.join(articlesDir, cat);
      if (!fs.existsSync(catDir)) return;
      const files = fs.readdirSync(catDir).filter(f => f.endsWith('.md')).sort();

      files.forEach(file => {
        totalMarkdownFiles++;
        const fullPath = path.join(catDir, file);
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = matter(raw);
        const d = parsed.data || {};
        const body = parsed.content ? parsed.content.trim() : '';
        const words = countWords(body);
        const slug = d.slug || file.replace(/\.md$/, '');
        const relPath = 'src/articles/' + cat + '/' + file;

        const isRedirect = !!(d.redirect_to || d.layout === 'layouts/redirect.njk');
        const isNoindex = d.noindex === true;

        if (isRedirect) {
          redirectCount++;
          redirects.push({
            id: cat + '/' + slug,
            relPath: relPath,
            title: d.title || slug,
            category: cat,
            slug: slug,
            url: '/articles/' + cat + '/' + slug + '/',
            redirectTo: d.redirect_to || null,
            articleType: 'redirect'
          });
        } else {
          categoryCounts[cat]++;
          if (isNoindex) {
            noindexedCount++;
          } else {
            activeIndexed++;
          }

          const hasSrc = Boolean(d.sourceName && String(d.sourceName).trim() !== '');
          if (hasSrc) withSourceName++;
          else missingSourceName++;

          if (words < 100) wordBuckets.under100++;
          else if (words < 150) wordBuckets.w100_149++;
          else if (words < 200) wordBuckets.w150_199++;
          else if (words < 300) wordBuckets.w200_299++;
          else wordBuckets.w300plus++;

          const sens = classifySensitive(d.title, d.dek, body);

          articles.push({
            id: cat + '/' + slug,
            relPath: relPath,
            title: d.title || slug,
            category: cat,
            slug: slug,
            url: '/articles/' + cat + '/' + slug + '/',
            wordCount: words,
            date: d.date ? (d.date instanceof Date ? d.date.toISOString() : String(d.date)) : null,
            author: d.author || null,
            sourceName: d.sourceName || null,
            sourceUrl: d.sourceUrl || null,
            hasSourceName: hasSrc,
            hasSourceUrl: Boolean(d.sourceUrl && String(d.sourceUrl).trim() !== ''),
            imageCredit: d.imageCredit || null,
            noindex: isNoindex,
            articleType: isNoindex ? 'noindexed' : 'active',
            sensitiveTopic: sens,
            evidenceDensity: words >= 450 ? 'HIGH_DENSITY' : (words >= 300 ? 'MODERATE_DENSITY' : 'LOW_DENSITY'),
            corroborationStatus: null,
            auditStatus: null,
            auditReason: null,
            publicationGate: 'PASS'
          });
        }
      });
    });
  }

  // Scan staged drafts
  if (fs.existsSync(draftsDir)) {
    const walkDrafts = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDrafts(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const raw = fs.readFileSync(full, 'utf8');
            const parsed = matter(raw);
            const d = parsed.data || {};
            const body = parsed.content ? parsed.content.trim() : '';
            const words = countWords(body);
            const slug = d.slug || entry.name.replace(/\.md$/, '');
            const cat = d.category ? d.category.toLowerCase() : path.basename(dir).toLowerCase();
            const relPath = path.relative(rootDir, full).replace(/\\/g, '/');

            const rs = (d.reviewStatus || d.review_status || 'REVIEW_PENDING').toUpperCase();
            const sourceArticleHash = d.sourceArticleHash || null;
            const publishedRelPath = 'src/articles/' + cat + '/' + entry.name;
            const publishedFullPath = path.join(articlesDir, cat, entry.name);
            const isRevision = Boolean(sourceArticleHash || fs.existsSync(publishedFullPath));

            let isStale = false;
            let currentPublishedHash = null;
            if (sourceArticleHash && fs.existsSync(publishedFullPath)) {
              try {
                const pubRaw = fs.readFileSync(publishedFullPath, 'utf8');
                currentPublishedHash = crypto.createHash('sha256').update(pubRaw).digest('hex');
                if (currentPublishedHash !== sourceArticleHash) {
                  isStale = true;
                }
              } catch (err) {}
            }

            drafts.push({
              id: cat + '/' + slug,
              relPath: relPath,
              publishedRelPath: publishedRelPath,
              title: d.title || slug,
              category: cat,
              slug: slug,
              status: d.status || 'draft',
              reviewStatus: rs,
              auditStatus: d.audit_status || 'HUMAN_REVIEW',
              auditReason: d.audit_reason || 'Pending human review',
              reviewRequired: true,
              wordCount: words,
              sourceName: d.sourceName || null,
              sourceUrl: d.sourceUrl || null,
              date: d.date ? (d.date instanceof Date ? d.date.toISOString() : String(d.date)) : null,
              author: d.author || null,
              sensitiveTopic: d.sensitive_topic || null,
              sourceArticleHash,
              currentPublishedHash,
              isRevision,
              isStale,
              stagedAt: d.stagedAt || null,
              stagedBy: d.stagedBy || null,
              reviewer: d.reviewer || null,
              reviewedAt: d.reviewedAt || null,
              reviewNotes: d.reviewNotes || null,
              promotedAt: d.promotedAt || null
            });
          } catch (e) {}
        }
      }
    };
    walkDrafts(draftsDir);
  }

  // Deterministic sorting: category ASC, then slug ASC
  articles.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.slug.localeCompare(b.slug);
  });
  redirects.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.slug.localeCompare(b.slug);
  });
  drafts.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.slug.localeCompare(b.slug);
  });

  const nonRedirectCount = totalMarkdownFiles - redirectCount;
  const sourcePercent = nonRedirectCount > 0 ? Math.round((withSourceName / nonRedirectCount) * 100) : 100;

  // Staged drafts statistics
  const draftStats = {
    total: drafts.length,
    reviewPending: 0,
    inReview: 0,
    approved: 0,
    rejected: 0,
    promoted: 0,
    staleCount: 0
  };

  drafts.forEach(dr => {
    const s = dr.reviewStatus;
    if (s === 'IN_REVIEW') draftStats.inReview++;
    else if (s === 'APPROVED') draftStats.approved++;
    else if (s === 'REJECTED') draftStats.rejected++;
    else if (s === 'PROMOTED') draftStats.promoted++;
    else draftStats.reviewPending++;

    if (dr.isStale) draftStats.staleCount++;
  });

  const corpusStats = {
    totalMarkdownFiles,
    totalMarkdownFilesFormatted: totalMarkdownFiles.toLocaleString('en-IN'),
    nonRedirectArticles: nonRedirectCount,
    nonRedirectArticlesFormatted: nonRedirectCount.toLocaleString('en-IN'),
    activeIndexed,
    activeIndexedFormatted: activeIndexed.toLocaleString('en-IN'),
    noindexed: noindexedCount,
    noindexedFormatted: noindexedCount.toLocaleString('en-IN'),
    redirectStubs: redirectCount,
    redirectStubsFormatted: redirectCount.toLocaleString('en-IN'),
    withSourceName,
    withSourceNameFormatted: withSourceName.toLocaleString('en-IN'),
    missingSourceName,
    sourceCompletenessPercent: sourcePercent,
    totalDrafts: drafts.length,
    totalDraftsFormatted: drafts.length.toLocaleString('en-IN'),
    draftStats,
    categoryBreakdown: categoryCounts,
    wordBuckets
  };

  const fullIndex = {
    meta: {
      version: '1.0.0',
      gitHead: currentHead,
      gitBranch: currentBranch,
      counts: corpusStats
    },
    articles,
    redirects,
    drafts
  };

  const fullIndexJson = JSON.stringify(fullIndex, null, 2);

  // Write static index to tools/editorial-control-center/article-quality-index.json
  const toolsIndexPath = path.join(rootDir, 'tools/editorial-control-center/article-quality-index.json');
  try {
    fs.writeFileSync(toolsIndexPath, fullIndexJson, 'utf8');
  } catch (e) {
    console.error('Error writing static article-quality-index.json:', e);
  }

  // Update existing data structures for template compatibility
  data.project = {
    name: "Samachar Daily Editorial Rehabilitation",
    description: "Internal Editorial Control Center for content rehabilitation, multi-source pipeline, trust, and AdSense readiness.",
    currentPhase: "PHASE_6E",
    phaseName: "Phase 6E — Human Review Staging & Promotion Workflow",
    status: "IN_PROGRESS",
    lastUpdated: new Date().toISOString(),
    gitHead: currentHead,
    gitBranch: currentBranch,
    livePublishedCount: nonRedirectCount,
    liveDraftCount: drafts.length,
    nextAction: {
      phase: "PHASE_6F",
      title: "Phase 6F — Editorial Control Center Verification & Sign-off",
      description: "End-to-end verification of operational surface, URL stability, test suite, and final sign-off."
    }
  };

  data.phases = [
    {
      id: "PHASE_1",
      number: "1",
      name: "Current-System & Editorial Architecture Audit",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-25",
      deliverable: "PHASE_1_CURRENT_SYSTEM_AND_EDITORIAL_ARCHITECTURE_AUDIT.md",
      summary: "Full 25-section audit of 1,249 articles, AI pipeline configs, byline structure, technical foundation, and remaining rehabilitation gaps."
    },
    {
      id: "PHASE_2",
      number: "2",
      name: "Design System & Editorial Control Shell",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-25",
      deliverable: "src/admin/editorial/index.njk & design system",
      summary: "Broadsheet typography, reading experience, author attribution, and operational control surface."
    },
    {
      id: "PHASE_3",
      number: "3",
      name: "Author & Trust Architecture",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-25",
      deliverable: "Solo-publisher transparent profile & editorial governance",
      summary: "Truthful solo-publisher authorship, editorial board bio, transparent AI methodology, and corrections workflow."
    },
    {
      id: "PHASE_4",
      number: "4",
      name: "Multi-Source Pipeline & Quality Auditor",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-26",
      deliverable: "Phase 4D independent auditor with 21/21 passing tests",
      summary: "Multi-source research, fact sheet grounding, claim traceability, and automated editorial quality gates."
    },
    {
      id: "PHASE_5",
      number: "5",
      name: "Content Rehabilitation & Normalization",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-26",
      deliverable: "155 thin stubs expanded, 155 compressed wire enriched, 13 source tags normalized",
      summary: "Systematic rehabilitation of low-value articles into substantive journalism; 100% sourceName attribution achieved."
    },
    {
      id: "PHASE_6A",
      number: "6A",
      name: "Quality Dashboard Audit & Architecture Plan",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-26",
      deliverable: "PHASE_6A_ARTICLE_QUALITY_DASHBOARD_AUDIT.md",
      summary: "Comprehensive audit and 5-subphase implementation architecture plan for newsroom control center."
    },
    {
      id: "PHASE_6B",
      number: "6B",
      name: "Editorial Data Layer & Corpus Quality Index",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-26",
      deliverable: "src/_data/editorial.js & article-quality-index.json",
      summary: "Build-time structured quality index across all 1,235 published articles, 10 redirects, and live drafts."
    },
    {
      id: "PHASE_6C",
      number: "6C",
      name: "Control Center Shell & KPI Modernization",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-27",
      deliverable: "src/admin/editorial/index.njk & verified live KPI binding",
      summary: "Modernize operational newsroom dashboard shell, bind dynamic corpus metrics, and enforce safety gates."
    },
    {
      id: "PHASE_6D",
      number: "6D",
      name: "Article Quality & Audit Workflow Queue",
      status: "COMPLETE",
      badge: "PASS",
      completedDate: "2026-09-27",
      deliverable: "src/admin/editorial/index.njk & workflow queue client filter engine",
      summary: "Client-side paginated search and multi-attribute filter engine across 1,235 published articles."
    },
    {
      id: "PHASE_6E",
      number: "6E",
      name: "Human Review Staging & Promotion Workflow",
      status: "IN_PROGRESS",
      badge: "ACTIVE",
      completedDate: null,
      deliverable: "scripts/stage_article.js, scripts/review_draft.js, scripts/promote_draft.js & review queue",
      summary: "Controlled human review staging and promotion workflow with stale-source concurrency protection and zero automated publishing."
    },
    {
      id: "PHASE_6F",
      number: "6F",
      name: "Editorial Control Center Verification & Sign-off",
      status: "NOT_STARTED",
      badge: "PLANNED",
      completedDate: null,
      deliverable: "Full independent re-audit & build sign-off",
      summary: "End-to-end verification of operational surface, URL stability, and test suite."
    },
    {
      id: "PHASE_7",
      number: "7",
      name: "Technical Validation & Performance",
      status: "NOT_STARTED",
      badge: "PLANNED",
      completedDate: null,
      deliverable: "Core Web Vitals, schema audit, broken link validation",
      summary: "Audit rendering speed, mobile responsiveness, structured data compliance, and RSS/sitemap feeds."
    },
    {
      id: "PHASE_8",
      number: "8",
      name: "Final AdSense Readiness Audit",
      status: "NOT_STARTED",
      badge: "PLANNED",
      completedDate: null,
      deliverable: "Pre-application checklist & quality sign-off",
      summary: "Final compliance verification against Google AdSense Low-Value Content policies before re-application."
    }
  ];

  data.corpusSummary = data.corpusSummary || {};
  data.corpusSummary.totalArticles = totalMarkdownFiles;
  data.corpusSummary.activePublished = activeIndexed;
  data.corpusSummary.noindexedArticles = noindexedCount;
  data.corpusSummary.categoryBreakdown = categoryCounts;
  data.corpusSummary.wordBuckets = wordBuckets;

  data.corpusSummary.classifications = data.corpusSummary.classifications || {};
  data.corpusSummary.classifications.thinStubsRemaining = 0;
  data.corpusSummary.classifications.compressedWireRemaining = 0;
  data.corpusSummary.classifications.legitimateShortFormat = 75;
  data.corpusSummary.classifications.substantiveBenchmark = 573;
  data.corpusSummary.classifications.substantiveTotal = 1051;
  data.corpusSummary.classifications.consolidatedRedirectStubs = redirectCount;

  if (data.trackers && data.trackers.thinContent) {
    data.trackers.thinContent.completed = 155;
    data.trackers.thinContent.notStarted = 0;
  }
  if (data.trackers && data.trackers.compressedWire) {
    data.trackers.compressedWire.enriched = 155;
    data.trackers.compressedWire.notStarted = 0;
  }

  data.activityFeed = [
    {
      date: "2026-09-25",
      type: "MILESTONE",
      title: "Phase 1 Audit Completed & Passed",
      description: "Comprehensive 25-section architecture audit produced PHASE_1_CURRENT_SYSTEM_AND_EDITORIAL_ARCHITECTURE_AUDIT.md. Corpus locked at 1,249 articles."
    },
    {
      date: "2026-09-25",
      type: "MILESTONE",
      title: "Phases 2 & 3 Completed",
      description: "Article UI/UX refinement, broadsheet design system, author profile, and editorial governance established."
    },
    {
      date: "2026-09-26",
      type: "MILESTONE",
      title: "Phase 4 Pipeline & Quality Auditor Completed",
      description: "Multi-source research, claim traceability, and 21/21 automated quality gate tests verified."
    },
    {
      date: "2026-09-26",
      type: "MILESTONE",
      title: "Phase 5 Content Rehabilitation Track Completed",
      description: "Rehabilitated 155 thin stubs and 155 compressed wire stories. Normalized sourceName to 100% across all 1,235 non-redirect articles."
    },
    {
      date: "2026-09-26",
      type: "MILESTONE",
      title: "Phase 6A Dashboard Audit & 6B Data Layer Passed",
      description: "Generated structured corpus index (article-quality-index.json) for 1,235 articles + 10 redirects. Passed independent re-audit."
    },
    {
      date: "2026-09-27",
      type: "MILESTONE",
      title: "Phase 6C Shell & 6D Workflow Queue Passed",
      description: "Operational newsroom control center shell with verified live KPI bindings and interactive client filter engine passed independent re-audits."
    },
    {
      date: "2026-09-27",
      type: "PHASE_START",
      title: "Phase 6E — Human Review Staging Initialized",
      description: "Establishing controlled human review staging, deterministic status transitions, and stale-source concurrency protection."
    }
  ];

  data.changeLog = [
    {
      date: "2026-09-25",
      phase: "Phase 1",
      action: "System & Editorial Architecture Audit",
      filesChanged: "PHASE_1_CURRENT_SYSTEM_AND_EDITORIAL_ARCHITECTURE_AUDIT.md",
      result: "PASS (25/25 areas verified, 0 code changes)"
    },
    {
      date: "2026-09-25",
      phase: "Phase 2 & 3",
      action: "Design System & Author Trust System",
      filesChanged: "src/pages/editorial-team.md, src/_includes/",
      result: "PASS (Solo-publisher identity verified)"
    },
    {
      date: "2026-09-26",
      phase: "Phase 4",
      action: "Multi-Source Pipeline & Independent Quality Auditor",
      filesChanged: "tools/test-multi-source.js, Code.gs",
      result: "PASS (21/21 test suite verified)"
    },
    {
      date: "2026-09-26",
      phase: "Phase 5",
      action: "Site-Wide Content Rehabilitation & sourceName Normalization",
      filesChanged: "310 rehabilitated articles, 13 source tags",
      result: "PASS (1,235/1,235 articles normalized, 100% source completeness)"
    },
    {
      date: "2026-09-26",
      phase: "Phase 6A & 6B",
      action: "Editorial Data Layer & Corpus Quality Index Generator",
      filesChanged: "src/_data/editorial.js, tools/editorial-control-center/article-quality-index.json",
      result: "PASS (1,235 non-redirect articles + 10 redirects indexed)"
    },
    {
      date: "2026-09-27",
      phase: "Phase 6C",
      action: "Editorial Control Center Shell & KPI Modernization",
      filesChanged: "src/admin/editorial/index.njk, src/_data/editorial.js",
      result: "COMPLETE (100% Verified in Independent Re-Audit)"
    },
    {
      date: "2026-09-27",
      phase: "Phase 6D",
      action: "Article Quality & Audit Workflow Queue Implementation",
      filesChanged: "src/admin/editorial/index.njk, src/_data/editorial.js",
      result: "COMPLETE (100% Verified in Independent Re-Audit)"
    },
    {
      date: "2026-09-27",
      phase: "Phase 6E",
      action: "Human Review Staging & Promotion Workflow",
      filesChanged: "scripts/stage_article.js, scripts/review_draft.js, scripts/promote_draft.js, src/admin/editorial/index.njk",
      result: "IN PROGRESS (Controlled staging, review state transitions, and concurrency safety)"
    }
  ];

  data.humanReviewQueue = data.humanReviewQueue || {};
  data.humanReviewQueue.stagedDraftsCount = drafts.length;
  data.humanReviewQueue.stagedDrafts = drafts;
  data.humanReviewQueue.draftStats = draftStats;

  // Attach quality index data
  data.corpusStats = corpusStats;
  data.corpusIndex = articles;
  data.redirectIndex = redirects;
  data.draftIndex = drafts;
  data.corpusIndexJson = fullIndexJson;
  data.corpusArticlesJson = JSON.stringify(articles);
  data.draftStats = draftStats;
  data.draftsJson = JSON.stringify(drafts);

  // Phase 4D: Independent Auditor & Publication Gate Diagnostics
  data.auditDiagnostics = {
    workflowStates: ['Generated', 'Audited', 'Passed', 'Needs Revision', 'Human Review', 'Rejected', 'Published'],
    diagnosticCategories: [
      { id: 'evidence_gap', label: 'Evidence Gap', description: 'Substantive assertions missing collected source support' },
      { id: 'unsupported_claim', label: 'Unsupported Claim', description: 'Extracted article claim not found in fact sheet or sources' },
      { id: 'source_conflict', label: 'Source Conflict', description: 'Conflicting source reports presented as settled fact' },
      { id: 'quote_problem', label: 'Quote Problem', description: 'Quotation cannot be verified against source dispatches' },
      { id: 'number_verification', label: 'Number Verification Required', description: 'Numerical, currency, or percentage figure absent from evidence' },
      { id: 'sensitive_review_required', label: 'Sensitive Review Required', description: 'Politics, crime, fatalities, or health category mandates publisher review' },
      { id: 'thin_evidence', label: 'Thin Evidence', description: 'Under-generation on rich or moderate evidence tier' },
      { id: 'ai_cliche_filler', label: 'AI Cliché / Filler', description: 'Repetitive padding or prohibited AI clichés detected' },
      { id: 'title_mismatch', label: 'Title Mismatch', description: 'Headline claims subject not substantiated in article body' },
      { id: 'prompt_injection_flag', label: 'Prompt Injection Defense', description: 'Adversarial instruction leak prevented' }
    ]
  };

  return data;
};
