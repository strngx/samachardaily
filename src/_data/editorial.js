const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = function () {
  const dataPath = path.join(__dirname, '../../tools/editorial-control-center/editorial-progress.json');
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

  // Dynamic check of staged drafts
  const draftsDir = path.join(__dirname, '../drafts');
  let draftCount = 0;
  const stagedDraftsList = [];
  if (fs.existsSync(draftsDir)) {
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          draftCount++;
          try {
            const content = fs.readFileSync(full, 'utf8');
            const titleMatch = content.match(/^title:\s*"([^"]+)"/m);
            const statusMatch = content.match(/^audit_status:\s*"([^"]+)"/m);
            const reasonMatch = content.match(/^audit_reason:\s*"([^"]+)"/m);
            stagedDraftsList.push({
              file: entry.name,
              title: titleMatch ? titleMatch[1] : entry.name,
              auditStatus: statusMatch ? statusMatch[1] : 'HUMAN_REVIEW',
              auditReason: reasonMatch ? reasonMatch[1] : 'Pending review',
              path: full
            });
          } catch (e) {}
        }
      }
    };
    walk(draftsDir);
  }

  // Dynamic count of published articles
  const articlesDir = path.join(__dirname, '../articles');
  let publishedCount = 0;
  if (fs.existsSync(articlesDir)) {
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          publishedCount++;
        }
      }
    };
    walk(articlesDir);
  }

  // Safety checks from git status
  let modifiedArticlesCount = 0;
  try {
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    const lines = gitStatus.split('\n');
    lines.forEach(line => {
      if (line.includes('src/articles/') && line.trim().startsWith('M ')) {
        // Exclude pre-existing modified articles if checking Phase 2A modifications,
        // but here we report real git observation
        modifiedArticlesCount++;
      }
    });
  } catch (e) {
    // git status fallback
  }

  // Ensure data structures are present
  data.project = data.project || {};
  data.project.gitHead = currentHead;
  data.project.gitBranch = currentBranch;
  data.project.livePublishedCount = publishedCount;
  data.project.liveDraftCount = draftCount;

  if (data.humanReviewQueue) {
    data.humanReviewQueue.stagedDraftsCount = draftCount;
    data.humanReviewQueue.stagedDrafts = stagedDraftsList;
  }

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
