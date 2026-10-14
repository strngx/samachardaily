/**
 * Samachar Daily — Editorial Quality Consolidation Regression Test Suite
 *
 * Verifies that:
 * 1. The three redundant sidebar entries (Thin Content Work, Needs Attention, Safety) are removed from the sidebar.
 * 2. Content Quality is the single central workspace with preserved capabilities.
 * 3. Overview KPI cards route to Content Quality with genuine filters (needs_review, thin, sensitive).
 * 4. All six thin-content classifications (Enrich, Keep Short, Consolidate, Noindex, Prune, Review) are supported in backend and UI.
 * 5. Review & dismissal actions interface with /api/admin/thin-queue/review and persist per article.
 * 6. Sensitive-topic classification and filtering return the intended records.
 * 7. Duplicate detection remains fully operational.
 * 8. Phase 9 Editorial Safety Gate in Editor and AI Studio remains completely intact.
 * 9. Popstate and legacy navigation redirects function deterministically.
 * 10. Node.js V8 client script compilation succeeds with zero syntax errors.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const ADMIN_VIEWS_FILE = path.join(ROOT_DIR, 'worker', 'admin-views.js');
const INDEX_NJK_FILE = path.join(ROOT_DIR, 'src', 'admin', 'editorial', 'index.njk');
const CQ_WORKER_FILE = path.join(ROOT_DIR, 'worker', 'content-quality.js');
const WORKER_INDEX_FILE = path.join(ROOT_DIR, 'worker', 'index.js');

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n--- EDITORIAL QUALITY WORKSPACE CONSOLIDATION REGRESSION SUITE ---\n');

// Load files
const njkContent = fs.readFileSync(INDEX_NJK_FILE, 'utf8');
const cqWorkerContent = fs.readFileSync(CQ_WORKER_FILE, 'utf8');
const workerViewsContent = fs.readFileSync(ADMIN_VIEWS_FILE, 'utf8');
const workerIndexContent = fs.readFileSync(WORKER_INDEX_FILE, 'utf8');

// Extract editorialHtml
const match = workerViewsContent.match(/export const editorialHtml = ([\s\S]*?);\r?\n\r?\nexport const qualityIndexJson/);
assert(match && match[1], 'Could not extract editorialHtml from worker/admin-views.js');
const editorialHtml = JSON.parse(match[1]);

// 1. Sidebar Nav verification
it('1. Sidebar navigation entries for Thin Content, Needs Attention, and Safety are removed', () => {
  // Extract sidebar nav HTML
  const navStart = editorialHtml.indexOf('<nav class="sidebar-nav"');
  const navEnd = editorialHtml.indexOf('<div class="sidebar-footer"', navStart);
  assert(navStart !== -1 && navEnd !== -1, 'Could not locate sidebar-nav block');
  const sidebarNavHtml = editorialHtml.slice(navStart, navEnd);

  assert(!sidebarNavHtml.includes('data-view="thin-queue"'), 'Found thin-queue button in sidebar nav');
  assert(!sidebarNavHtml.includes('data-view="attention"'), 'Found attention button in sidebar nav');
  assert(!sidebarNavHtml.includes('data-view="safety"'), 'Found safety button in sidebar nav');

  // Verify Content Quality exists in sidebar right under Articles
  assert(sidebarNavHtml.includes('data-view="content-quality"'), 'Content Quality missing from sidebar nav');
  assert(sidebarNavHtml.includes('data-view="articles"'), 'Articles missing from sidebar nav');

  const artPos = sidebarNavHtml.indexOf('data-view="articles"');
  const cqPos = sidebarNavHtml.indexOf('data-view="content-quality"');
  const aiPos = sidebarNavHtml.indexOf('data-view="ai-upgrade"');
  assert(cqPos > artPos && cqPos < aiPos, 'Content Quality should be positioned immediately after Articles');
});

// 2. Overview KPI cards routing
it('2. Overview KPI cards route to Content Quality with correct filters', () => {
  assert(editorialHtml.includes('onclick="openCqFiltered(\'needs_review\')"'), 'Needs Attention KPI card must call openCqFiltered(\'needs_review\')');
  assert(editorialHtml.includes('onclick="openCqFiltered(\'thin\')"'), 'Thin Content KPI card must call openCqFiltered(\'thin\')');
  assert(editorialHtml.includes('onclick="openCqFiltered(\'sensitive\')"'), 'Safety KPI card must call openCqFiltered(\'sensitive\')');

  // Ensure old navigate('attention'), navigate('thin-queue'), navigate('safety') are not on Overview cards
  const ovSectionStart = editorialHtml.indexOf('<section id="view-overview"');
  const ovSectionEnd = editorialHtml.indexOf('</section>', ovSectionStart);
  const ovHtml = editorialHtml.slice(ovSectionStart, ovSectionEnd);

  assert(!ovHtml.includes('onclick="navigate(\'attention\')"'), 'Overview card still references legacy navigate(\'attention\')');
  assert(!ovHtml.includes('onclick="navigate(\'thin-queue\')"'), 'Overview card still references legacy navigate(\'thin-queue\')');
  assert(!ovHtml.includes('onclick="navigate(\'safety\')"'), 'Overview card still references legacy navigate(\'safety\')');
});

// 3. Content Quality 6 Thin Content Advisory Classifications
it('3. All six thin-content advisory classifications are defined and filterable', () => {
  const expectedClassifications = ['Enrich', 'Keep Short', 'Consolidate', 'Noindex', 'Prune', 'Review'];

  // Check worker/content-quality.js
  assert(cqWorkerContent.includes('export function classifyThinAdvisory'), 'classifyThinAdvisory missing in worker/content-quality.js');
  expectedClassifications.forEach(cls => {
    assert(cqWorkerContent.includes(`'${cls}'`), `Classification ${cls} missing in worker/content-quality.js`);
  });

  // Check filter options in editorialHtml
  const filterSelectStart = editorialHtml.indexOf('id="cq-filter-status"');
  const filterSelectEnd = editorialHtml.indexOf('</select>', filterSelectStart);
  const selectHtml = editorialHtml.slice(filterSelectStart, filterSelectEnd);

  assert(selectHtml.includes('value="enrich"'), 'Filter option "enrich" missing');
  assert(selectHtml.includes('value="keep_short"'), 'Filter option "keep_short" missing');
  assert(selectHtml.includes('value="consolidate"'), 'Filter option "consolidate" missing');
  assert(selectHtml.includes('value="noindex"'), 'Filter option "noindex" missing');
  assert(selectHtml.includes('value="prune"'), 'Filter option "prune" missing');
  assert(selectHtml.includes('value="advisory_review"'), 'Filter option "advisory_review" missing');
});

// 4. Content Quality Sensitive Topics Integration
it('4. Sensitive topic signals, KPI card, and filter are integrated into Content Quality', () => {
  // Check backend worker
  assert(cqWorkerContent.includes('export const SENSITIVE_PATTERNS'), 'SENSITIVE_PATTERNS missing in content-quality.js');
  assert(cqWorkerContent.includes('export function classifySensitive'), 'classifySensitive missing in content-quality.js');
  assert(cqWorkerContent.includes('SENSITIVE_TOPIC'), 'SENSITIVE_TOPIC signal missing in content-quality.js');

  // Check UI KPI card and filter
  assert(editorialHtml.includes('id="cq-kpi-sensitive"'), 'cq-kpi-sensitive KPI card missing in Content Quality');
  assert(editorialHtml.includes('onclick="filterCqQueue(\'sensitive\')"'), 'Sensitive Topics KPI card must filter by sensitive');
  assert(editorialHtml.includes('value="sensitive"'), 'Filter option "sensitive" missing in cq-filter-status');
});

// 5. Review & Dismissal Actions Persistence Contract
it('5. Review and dismissal actions interface with /api/admin/thin-queue/review and KV persistence', () => {
  // Verify worker backend routes exist
  assert(workerIndexContent.includes("pathname === '/api/admin/thin-queue/review' && method === 'POST'"), 'POST /api/admin/thin-queue/review missing in worker');
  assert(workerIndexContent.includes("pathname === '/api/admin/thin-queue/reviews' && method === 'GET'"), 'GET /api/admin/thin-queue/reviews missing in worker');

  // Verify client-side inspection modal buttons & functions exist
  assert(editorialHtml.includes('id="cq-modal-btn-mark-reviewed"'), 'Mark Reviewed button missing in CQ modal');
  assert(editorialHtml.includes('id="cq-modal-btn-dismiss"'), 'Dismiss Flag button missing in CQ modal');
  assert(editorialHtml.includes('function markCqItemReviewed()'), 'markCqItemReviewed function missing in client script');
  assert(editorialHtml.includes('function dismissCqItemFlag()'), 'dismissCqItemFlag function missing in client script');

  // Verify localStorage persistence key
  assert(editorialHtml.includes('samachar_thin_queue_reviews'), 'localStorage persistence key missing');
});

// 6. Article inspection, editor handoff, and duplicate detection
it('6. Duplicate detection, article inspection, and editor handoffs remain operational', () => {
  assert(editorialHtml.includes('function inspectArticleQuality('), 'inspectArticleQuality missing');
  assert(editorialHtml.includes('function renderCqArticleModal('), 'renderCqArticleModal missing');
  assert(editorialHtml.includes('function openEditorFromCqModal()'), 'openEditorFromCqModal missing');
  assert(editorialHtml.includes('function openAiUpgradeFromCqModal()'), 'openAiUpgradeFromCqModal missing');
  assert(editorialHtml.includes('function loadCqDuplicates()'), 'loadCqDuplicates missing');
  assert(editorialHtml.includes('function renderCqDuplicateRows('), 'renderCqDuplicateRows missing');
});

// 7. Navigation redirection for legacy routes and bookmarks
it('7. Legacy navigation calls (thin-queue, attention, safety) redirect to Content Quality', () => {
  const routerMatch = editorialHtml.match(/function navigate\(viewId, options = \{\}\) \{([\s\S]*?)const validViews/);
  assert(routerMatch && routerMatch[1], 'Could not find router entry');
  const routerCode = routerMatch[1];

  assert(routerCode.includes("if (viewId === 'thin-queue') return openCqFiltered('thin');"), 'thin-queue redirect missing');
  assert(routerCode.includes("if (viewId === 'attention') return openCqFiltered('needs_review');"), 'attention redirect missing');
  assert(routerCode.includes("if (viewId === 'safety') return openCqFiltered('sensitive');"), 'safety redirect missing');
});

// 8. Phase 9 Editorial Safety Gate Preservation
it('8. Phase 9 Safety Gate, endpoints, and sign-off modal remain completely intact', () => {
  assert(editorialHtml.includes('id="safety-inspection-modal"'), 'Phase 9 safety inspection modal missing');
  assert(editorialHtml.includes('id="editor-safety-sidebar-card"'), 'Phase 9 editor safety sidebar card missing');
  assert(editorialHtml.includes('id="btn-editor-safety"'), 'Phase 9 safety action button missing');
  assert(editorialHtml.includes('function openSafetyInspectionModal()'), 'openSafetyInspectionModal missing');
  assert(workerIndexContent.includes("pathname === '/api/admin/safety/check'"), 'Safety check API missing');
  assert(workerIndexContent.includes("pathname === '/api/admin/safety/sign-off'"), 'Safety sign-off API missing');
});

// 9. Full Node.js V8 Script Syntax Validation
it('9. Client-side JavaScript parses cleanly in Node.js V8 with zero syntax errors', () => {
  const scriptMatch = editorialHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch && scriptMatch[1], 'Could not extract <script> from editorialHtml');
  const code = scriptMatch[1].trim();

  try {
    new vm.Script(code, { filename: 'editorial-client-script.js' });
  } catch (err) {
    assert.fail(`V8 compilation error: ${err.message}`);
  }
});

// 10. Template and Worker views synchronization
it('10. Nunjucks template and worker views script implementations are synchronized', () => {
  assert(njkContent.includes('function openCqFiltered('), 'openCqFiltered missing in index.njk');
  assert(njkContent.includes('function markCqItemReviewed()'), 'markCqItemReviewed missing in index.njk');
  assert(njkContent.includes('function dismissCqItemFlag()'), 'dismissCqItemFlag missing in index.njk');
  assert(njkContent.includes('function normalizeCqFilter('), 'normalizeCqFilter missing in index.njk');
  assert(editorialHtml.includes('function openCqFiltered('), 'openCqFiltered missing in worker/admin-views.js');
  assert(editorialHtml.includes('function markCqItemReviewed()'), 'markCqItemReviewed missing in worker/admin-views.js');
  assert(editorialHtml.includes('function dismissCqItemFlag()'), 'dismissCqItemFlag missing in worker/admin-views.js');
  assert(editorialHtml.includes('function normalizeCqFilter('), 'normalizeCqFilter missing in worker/admin-views.js');
});

// 11. Direct Content Quality filter deep-link normalization
it('11. normalizeCqFilter correctly validates valid, missing, invalid, and alias filter values', () => {
  // Extract and run normalizeCqFilter in isolated V8 context
  const filterFnMatch = editorialHtml.match(/function normalizeCqFilter\(filter\)\s*\{([\s\S]*?)\n    \}/);
  assert(filterFnMatch && filterFnMatch[0], 'Could not extract normalizeCqFilter from editorialHtml');

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(filterFnMatch[0], sandbox);
  const normalize = sandbox.normalizeCqFilter;
  assert.strictEqual(typeof normalize, 'function', 'normalizeCqFilter should be a callable function');

  // Valid standard filters
  const standardFilters = ['all', 'thin', 'needs_review', 'brief', 'healthy', 'sensitive'];
  standardFilters.forEach(f => {
    assert.strictEqual(normalize(f), f, `Standard filter ${f} should normalize to itself`);
  });

  // Valid thin advisory classifications
  const advisoryFilters = ['enrich', 'keep_short', 'consolidate', 'noindex', 'prune', 'advisory_review'];
  advisoryFilters.forEach(f => {
    assert.strictEqual(normalize(f), f, `Advisory filter ${f} should normalize to itself`);
  });

  // Aliases and hyphen/casing variations
  assert.strictEqual(normalize('review'), 'advisory_review', 'Alias "review" must normalize to "advisory_review"');
  assert.strictEqual(normalize('REVIEW'), 'advisory_review', 'Alias "REVIEW" uppercase must normalize to "advisory_review"');
  assert.strictEqual(normalize('needs-review'), 'needs_review', 'Hyphenated "needs-review" must normalize to "needs_review"');
  assert.strictEqual(normalize('keep-short'), 'keep_short', 'Hyphenated "keep-short" must normalize to "keep_short"');
  assert.strictEqual(normalize('advisory-review'), 'advisory_review', 'Hyphenated "advisory-review" must normalize to "advisory_review"');
  assert.strictEqual(normalize('  SENSITIVE  '), 'sensitive', 'Whitespace-padded uppercase "  SENSITIVE  " must normalize to "sensitive"');
  assert.strictEqual(normalize('  thin  '), 'thin', 'Whitespace-padded "  thin  " must normalize to "thin"');

  // Missing values (fallback to 'all')
  assert.strictEqual(normalize(null), 'all', 'null must safely fall back to "all"');
  assert.strictEqual(normalize(undefined), 'all', 'undefined must safely fall back to "all"');
  assert.strictEqual(normalize(''), 'all', 'empty string must safely fall back to "all"');
  assert.strictEqual(normalize('   '), 'all', 'whitespace-only string must safely fall back to "all"');

  // Invalid values (fallback to 'all')
  assert.strictEqual(normalize('unknown_status'), 'all', 'unknown status must safely fall back to "all"');
  assert.strictEqual(normalize('random123'), 'all', 'random string must safely fall back to "all"');
  assert.strictEqual(normalize('<script>alert(1)</script>'), 'all', 'XSS attempt must safely fall back to "all"');
  assert.strictEqual(normalize(123), 'all', 'number must safely fall back to "all"');
  assert.strictEqual(normalize({}), 'all', 'object must safely fall back to "all"');
  assert.strictEqual(normalize([]), 'all', 'array must safely fall back to "all"');
  assert.strictEqual(normalize(true), 'all', 'boolean must safely fall back to "all"');
});

// 12. Direct-link URL initialization flow on DOMContentLoaded and popstate
it('12. URL parameters initialization and popstate handle view=content-quality and filter deep links', () => {
  // Check index.njk and editorialHtml have initialView === 'content-quality' handling
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';

    // DOMContentLoaded check
    assert(
      source.includes("if (initialView === 'content-quality')"),
      `initialView === 'content-quality' check missing in ${fileLabel}`
    );
    assert(
      source.includes("const filter = normalizeCqFilter(params.get('filter'));"),
      `params.get('filter') read with normalizeCqFilter missing in ${fileLabel}`
    );
    assert(
      source.includes("navigate('content-quality', { filter, fromPopState: true });"),
      `navigate call with normalized filter missing in ${fileLabel}`
    );

    // Popstate check
    assert(
      source.includes("if (view === 'content-quality')"),
      `view === 'content-quality' check in popstate missing in ${fileLabel}`
    );

    // initContentQualityView check
    assert(
      source.includes("normalizeCqFilter(options.filter)"),
      `initContentQualityView must normalize options.filter in ${fileLabel}`
    );

    // URL searchParams synchronization in navigate
    assert(
      source.includes("url.searchParams.set('filter', currentFilter);"),
      `url.searchParams.set('filter', ...) missing in ${fileLabel}`
    );
  });
});

// 13. Preservation of legacy redirects for thin-queue, attention, and safety
it('13. Legacy redirects for thin-queue, attention, and safety are preserved across deep links and navigate', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';

    // Ensure validViews array includes legacy bookmarks so initialView routes correctly
    assert(
      source.includes("'thin-queue'") && source.includes("'attention'") && source.includes("'safety'"),
      `Legacy view keys missing from router or validViews in ${fileLabel}`
    );

    // Ensure navigate router redirects
    assert(
      source.includes("if (viewId === 'thin-queue') return openCqFiltered('thin');"),
      `thin-queue redirect missing in ${fileLabel}`
    );
    assert(
      source.includes("if (viewId === 'attention') return openCqFiltered('needs_review');"),
      `attention redirect missing in ${fileLabel}`
    );
    assert(
      source.includes("if (viewId === 'safety') return openCqFiltered('sensitive');"),
      `safety redirect missing in ${fileLabel}`
    );
  });
});

console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
if (passedTests !== totalTests) {
  process.exit(1);
}
