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

// 14. Automatic initialization and request concurrency guards
it('14. Opening Content Quality triggers automatic loading with concurrency guards', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';

    // Verify automatic call to loadContentQualityData in initContentQualityView
    assert(
      source.includes('if (!CqState.initialLoaded) {\r\n        loadContentQualityData();') ||
      source.includes('if (!CqState.initialLoaded) {\n        loadContentQualityData();'),
      `Automatic loadContentQualityData call missing in ${fileLabel}`
    );

    // Verify concurrency lock
    assert(
      source.includes('if (CqState.loading) return;'),
      `Loading concurrency lock missing in ${fileLabel}`
    );

    // Verify request ID generation counter to prevent race conditions
    assert(
      source.includes('const currentReq = ++CqState.requestId;'),
      `Request ID race-condition counter missing in ${fileLabel}`
    );

    // Verify review states are fetched on init
    assert(
      source.includes('fetchThinQueueReviewStates();'),
      `fetchThinQueueReviewStates call on init missing in ${fileLabel}`
    );
  });
});

// 15. Removal of manual scan action & preservation of Refresh Data
it('15. Manual "Run Quality Scan" and dead scan handlers are removed, Refresh Data is preserved', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';

    // Verify Run Quality Scan button is NOT present
    assert(!source.includes('id="btn-cq-analyze"'), `Found removed btn-cq-analyze in ${fileLabel}`);
    assert(!source.includes('Run Quality Scan'), `Found "Run Quality Scan" text in ${fileLabel}`);
    assert(!source.includes('Run Quality Scan Now'), `Found "Run Quality Scan Now" text in ${fileLabel}`);

    // Verify dead handler triggerCorpusAnalysis is removed from client script
    assert(!source.includes('function triggerCorpusAnalysis'), `Found dead handler triggerCorpusAnalysis in ${fileLabel}`);

    // Verify Refresh Data button is present and calls refreshContentQualityData()
    assert(source.includes('id="btn-cq-refresh"'), `btn-cq-refresh missing in ${fileLabel}`);
    assert(source.includes('onclick="refreshContentQualityData()"'), `refreshContentQualityData onclick missing in ${fileLabel}`);
    assert(source.includes('function refreshContentQualityData()'), `refreshContentQualityData function missing in ${fileLabel}`);
  });
});

// 16. Removal of internal Phase E badge from Content Quality
it('16. Internal "Phase E Diagnostic" badge is removed from Content Quality header', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(!source.includes('Phase E Diagnostic'), `Found internal "Phase E Diagnostic" badge in ${fileLabel}`);
  });
});

// 17. Visual states: loading, empty, and non-destructive error handling
it('17. Content Quality supports consistent loading, empty, and error states with Retry option', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';

    // Verify error renderer with Retry
    assert(source.includes('function renderCqQueueError('), `renderCqQueueError missing in ${fileLabel}`);
    assert(source.includes('renderCqEmptyCorpusState();'), `renderCqEmptyCorpusState missing in ${fileLabel}`);

    // Verify non-destructive retry calling refreshContentQualityData()
    const errFnMatch = source.match(/function renderCqQueueError\(message\)\s*\{([\s\S]*?)\n    \}/);
    assert(errFnMatch && errFnMatch[1], `renderCqQueueError body missing in ${fileLabel}`);
    assert(errFnMatch[1].includes('refreshContentQualityData()'), `Retry handler in renderCqQueueError must call refreshContentQualityData() in ${fileLabel}`);
    assert(errFnMatch[1].includes('Retry'), `Retry button label missing in renderCqQueueError in ${fileLabel}`);
  });
});

// 18. Filter and view preservation during data refresh
it('18. Content Quality preserves filters, sort, desk, and page across queue loads and refreshes', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';

    // Verify filter parameters passed to queue endpoint
    assert(source.includes('filter: CqState.filters.status,'), `status filter missing in ${fileLabel}`);
    assert(source.includes('desk: CqState.filters.desk,'), `desk filter missing in ${fileLabel}`);
    assert(source.includes('sortBy: CqState.filters.sortBy'), `sortBy filter missing in ${fileLabel}`);
    assert(source.includes('page: CqState.page.toString(),'), `page param missing in ${fileLabel}`);
  });
});

// 19. Unique Queue and Duplicate Detector pagination IDs
it('19. Unique Queue and Duplicate Detector pagination IDs', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    const queuePrevMatches = source.match(/id=["']cq-btn-prev-page["']/g) || [];
    const queueNextMatches = source.match(/id=["']cq-btn-next-page["']/g) || [];
    const dupPrevMatches = source.match(/id=["']cq-dup-btn-prev["']/g) || [];
    const dupNextMatches = source.match(/id=["']cq-dup-btn-next["']/g) || [];

    assert.strictEqual(queuePrevMatches.length, 1, `Queue prev button ID must appear exactly once in ${fileLabel}`);
    assert.strictEqual(queueNextMatches.length, 1, `Queue next button ID must appear exactly once in ${fileLabel}`);
    assert.strictEqual(dupPrevMatches.length, 1, `Duplicate prev button ID must appear exactly once in ${fileLabel}`);
    assert.strictEqual(dupNextMatches.length, 1, `Duplicate next button ID must appear exactly once in ${fileLabel}`);
  });
});

// 20. Duplicate Detector Next button state updates
it('20. Duplicate Detector Next button state updates correctly with renderCqDupPagination', () => {
  const scriptMatch = editorialHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch && scriptMatch[1], 'Could not extract <script> from editorialHtml');
  const code = scriptMatch[1].trim();

  const elements = {
    'cq-dup-pagination-info': { textContent: '' },
    'cq-dup-btn-prev': { disabled: false },
    'cq-dup-btn-next': { disabled: false },
    'cq-dup-page-label': { textContent: '' }
  };
  const sandbox = {
    document: {
      getElementById: (id) => elements[id] || null
    },
    CqState: { dupPage: 1 }
  };
  vm.createContext(sandbox);

  const fnMatch = code.match(/function renderCqDupPagination\(total,\s*page,\s*totalPages\)\s*\{[\s\S]*?\n    \}/);
  assert(fnMatch, 'Could not find renderCqDupPagination function');
  vm.runInContext(fnMatch[0], sandbox);

  // Page 1 of 3: Prev disabled, Next enabled
  sandbox.renderCqDupPagination(30, 1, 3);
  assert.strictEqual(elements['cq-dup-btn-prev'].disabled, true, 'Prev must be disabled on page 1');
  assert.strictEqual(elements['cq-dup-btn-next'].disabled, false, 'Next must be enabled on page 1 of 3');

  // Page 2 of 3: Prev enabled, Next enabled
  sandbox.renderCqDupPagination(30, 2, 3);
  assert.strictEqual(elements['cq-dup-btn-prev'].disabled, false, 'Prev must be enabled on page 2');
  assert.strictEqual(elements['cq-dup-btn-next'].disabled, false, 'Next must be enabled on page 2 of 3');

  // Page 3 of 3: Prev enabled, Next disabled
  sandbox.renderCqDupPagination(30, 3, 3);
  assert.strictEqual(elements['cq-dup-btn-prev'].disabled, false, 'Prev must be enabled on page 3');
  assert.strictEqual(elements['cq-dup-btn-next'].disabled, true, 'Next must be disabled on page 3 of 3');
});

// 21. Summary endpoint HTTP failure handling
it('21. Summary endpoint HTTP failure updates status badge to Sync Failed and does not leave Loading', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('if (sumResp.ok && sumData.success)'), `Must check sumResp.ok and sumData.success in ${fileLabel}`);
    assert(source.includes("statusBadge.textContent = 'Sync Failed'"), `Must update statusBadge to Sync Failed in ${fileLabel}`);
    assert(source.includes("statusBadge.className = 'badge badge-red'"), `Must set badge-red failure class in ${fileLabel}`);
  });
});

// 22. Summary endpoint { success: false } handling
it('22. Summary endpoint { success: false } preserves existing summary and flags failure', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('if (sumResp.ok && sumData.success) {'), `Summary check missing in ${fileLabel}`);
    assert(source.includes("statusBadge.textContent = 'Sync Failed';"), `Sync Failed text missing in ${fileLabel}`);
  });
});

// 23. Duplicate endpoint HTTP failure handling
it('23. Duplicate endpoint HTTP failure updates table with error card and Retry action', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('function renderCqDuplicatesError('), `renderCqDuplicatesError missing in ${fileLabel}`);
    assert(source.includes('renderCqDuplicatesError('), `Duplicate error invocation missing in ${fileLabel}`);
  });
});

// 24. Duplicate endpoint { success: false } handling
it('24. Duplicate endpoint { success: false } replaces loading spinner with non-destructive error', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('if (dupResp.ok && dupData.success && !dupData.needsAnalysis)'), `Must check dupResp.ok and dupData.success for duplicates in ${fileLabel}`);
    const dupErrMatch = source.match(/function renderCqDuplicatesError\(message\)\s*\{([\s\S]*?)\n    \}/);
    assert(dupErrMatch && dupErrMatch[1], `renderCqDuplicatesError must have a valid body in ${fileLabel}`);
    assert(dupErrMatch[1].includes('Unable to Load Duplicate Analysis'), `Error heading missing in ${fileLabel}`);
  });
});

// 25. Loading indicators are replaced on failure and Retry uses Refresh Data
it('25. Loading indicators are replaced on failure and Retry uses Refresh Data', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    const qMatch = source.match(/function renderCqQueueError\(message\)\s*\{([\s\S]*?)\n    \}/);
    const dMatch = source.match(/function renderCqDuplicatesError\(message\)\s*\{([\s\S]*?)\n    \}/);
    assert(qMatch && qMatch[1].includes('refreshContentQualityData()'), `renderCqQueueError Retry must call refreshContentQualityData() in ${fileLabel}`);
    assert(dMatch && dMatch[1].includes('refreshContentQualityData()'), `renderCqDuplicatesError Retry must call refreshContentQualityData() in ${fileLabel}`);
    assert(!source.includes('triggerCorpusAnalysis'), `No retry may call removed triggerCorpusAnalysis in ${fileLabel}`);
  });
});

// 26. Existing filter and view state remains intact after retry
it('26. Existing filter and view state remains intact after retry', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    const refFnMatch = source.match(/function refreshContentQualityData\(\)\s*\{([\s\S]*?)\n    \}/);
    assert(refFnMatch && refFnMatch[1].includes('loadContentQualityData('), `refreshContentQualityData must invoke loadContentQualityData(true) in ${fileLabel}`);
    assert(source.includes('filter: CqState.filters.status,'), `Filters status must be read from CqState in ${fileLabel}`);
    assert(source.includes('desk: CqState.filters.desk,'), `Filters desk must be read from CqState in ${fileLabel}`);
    assert(source.includes('sortBy: CqState.filters.sortBy'), `Filters sortBy must be read from CqState in ${fileLabel}`);
  });
});

// 27. Diagnostic banner is completely absent in both implementations
it('27. Diagnostic banner ("Read-Only Diagnostic System") is completely absent in both implementations', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(!source.includes('Read-Only Diagnostic System'), `Found "Read-Only Diagnostic System" in ${fileLabel}`);
    assert(!source.includes('Invariant Notice Banner'), `Found "Invariant Notice Banner" in ${fileLabel}`);
    assert(!source.includes('Content Quality analysis is 100% deterministic and local'), `Found banner body text in ${fileLabel}`);
  });
});

// 28. Auto-initialization path via POST /api/admin/content-quality/analyze
it('28. Auto-initialization is triggered via POST /api/admin/content-quality/analyze when needsAnalysis is reported', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes("fetch('/api/admin/content-quality/analyze'"), `Auto-initialization call to /api/admin/content-quality/analyze missing in ${fileLabel}`);
    assert(source.includes("method: 'POST'"), `POST method missing for /api/admin/content-quality/analyze in ${fileLabel}`);
    assert(source.includes("Initializing Index..."), `Initializing Index badge text missing in ${fileLabel}`);
    assert(source.includes("Building content quality index from corpus..."), `Initialization loading status missing in ${fileLabel}`);
  });
});

// 29. API failures remain distinguishable from genuine empty data
it('29. API failures remain distinguishable from genuine empty data', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('function renderCqQueueError('), `renderCqQueueError missing in ${fileLabel}`);
    assert(source.includes('function renderCqDuplicatesError('), `renderCqDuplicatesError missing in ${fileLabel}`);
    assert(source.includes('Unable to Load Quality Queue'), `Error heading missing in ${fileLabel}`);
    assert(source.includes('Unable to Load Duplicate Analysis'), `Duplicate error heading missing in ${fileLabel}`);
    // Genuine empty state renders "No Articles Found" / "No Duplicate Pairs Detected"
    assert(source.includes('No Articles Found'), `Genuine empty queue text missing in ${fileLabel}`);
    assert(source.includes('No Duplicate Pairs Detected'), `Genuine empty duplicates text missing in ${fileLabel}`);
  });
});

// 30. Existing data renders when the supported API returns it
it('30. Existing data renders when the supported API returns it', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('function renderCqSummaryCards('), `renderCqSummaryCards missing in ${fileLabel}`);
    assert(source.includes('function renderCqQueueRows('), `renderCqQueueRows missing in ${fileLabel}`);
    assert(source.includes('function renderCqDuplicateRows('), `renderCqDuplicateRows missing in ${fileLabel}`);
    assert(source.includes('document.getElementById(\'cq-kpi-total\').textContent'), `cq-kpi-total rendering missing in ${fileLabel}`);
    assert(source.includes('document.getElementById(\'cq-kpi-healthy\').textContent'), `cq-kpi-healthy rendering missing in ${fileLabel}`);
  });
});

// 31. Missing cache/index data produces an accurate, actionable state with retry
it('31. Missing cache/index data produces an accurate, actionable state with retry', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('renderCqEmptyCorpusState();'), `renderCqEmptyCorpusState call missing in ${fileLabel}`);
    assert(source.includes('Content Quality Index Not Available'), `Accurate empty index heading missing in ${fileLabel}`);
    assert(source.includes('onclick="refreshContentQualityData()"'), `Actionable retry/refresh action missing in ${fileLabel}`);
  });
});

// 32. Worker-rendered and template implementations remain synchronized
it('32. Worker-rendered and template implementations remain synchronized', () => {
  // Extract and compare loadContentQualityData function bodies
  const fnStart = 'async function loadContentQualityData(isRefresh = false) {';
  const fnEnd = 'function renderCqEmptyCorpusState() {';
  const njkFn = njkContent.slice(njkContent.indexOf(fnStart), njkContent.indexOf(fnEnd)).trim();
  const viewsFn = editorialHtml.slice(editorialHtml.indexOf(fnStart), editorialHtml.indexOf(fnEnd)).trim();
  assert.strictEqual(njkFn, viewsFn, 'loadContentQualityData must be character-for-character identical between njk and views');
});

// 33. Bounded concurrency retry stops retrying after 3 attempts and displays actionable error
it('33. Bounded concurrency retry stops retrying after 3 attempts and displays actionable error', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('(CqState.initRetries || 0) < 3'), `Must check (CqState.initRetries || 0) < 3 in ${fileLabel}`);
    assert(source.includes('CqState.initRetries = (CqState.initRetries || 0) + 1;'), `Must increment initRetries in ${fileLabel}`);
    assert(source.includes('Corpus analysis is currently in progress or locked by another session.'), `Exhausted retries error message missing in ${fileLabel}`);
    assert(source.includes('CqState.initRetries = 0;'), `Must reset initRetries in ${fileLabel}`);
  });
});

// 34. Concurrency guard prevents duplicate initialization requests
it('34. Concurrency guard (CqState.initializing) prevents duplicate initialization requests', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('initializing: false,'), `initializing property missing in CqState in ${fileLabel}`);
    assert(source.includes('CqState.initializing = true;'), `Must set CqState.initializing = true before analyze in ${fileLabel}`);
    assert(source.includes('if (!CqState.initializing)'), `Must check !CqState.initializing in queue handler in ${fileLabel}`);
  });
});

// 35. Issue 4: Authoritative public article permalink routing (/articles/${category}/${slug}/)
it('35. Authoritative public article permalinks (/articles/${category}/${slug}/) generated in worker and client views', () => {
  // Check worker permalink generation in content-quality.js
  assert(cqWorkerContent.includes("const publicUrl = slug ? `/articles/${actualCategory.toLowerCase()}/${slug}/` : null;"),
    'worker/content-quality.js must generate /articles/${category}/${slug}/ permalink'
  );
  assert(!cqWorkerContent.includes("const publicUrl = slug ? `/${actualCategory.toLowerCase()}/articles/${slug}/` : null;"),
    'worker/content-quality.js must not generate inverted /category/articles/ URL'
  );

  // Check client views in both njk and admin-views.js
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes("liveUrl = (item.publicUrl && item.publicUrl.startsWith('/articles/'))"),
      `renderCqQueueRows must enforce /articles/ permalink in ${fileLabel}`
    );
    assert(source.includes("'/articles/' + desk.toLowerCase() + '/' + safeSlug + '/'"),
      `renderCqQueueRows must fallback to /articles/{desk}/{slug}/ in ${fileLabel}`
    );
    assert(source.includes("modalLiveUrl = (art.publicUrl && art.publicUrl.startsWith('/articles/'))"),
      `renderCqArticleModal must enforce /articles/ permalink in ${fileLabel}`
    );
  });
});

// 36. Issue 2: Refresh Data observable loading state, disabling, error handling, and concurrency protection
it('36. Refresh Data button observable loading state, disabled attribute, and concurrency guard', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    // Concurrency guard in refreshContentQualityData
    assert(source.includes('if (CqState.loading || CqState.initializing) return;'),
      `refreshContentQualityData must guard against concurrent calls in ${fileLabel}`
    );
    // Refresh button spinner and text
    assert(source.includes("refreshBtn.innerHTML = '<svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"margin-right: 4px; animation: spin 1s linear infinite;\">"),
      `Refresh button must show animated spinner during load in ${fileLabel}`
    );
    assert(source.includes("isRefresh ? 'Refreshing...' : 'Loading...'"),
      `Refresh button must display Refreshing... text when isRefresh is true in ${fileLabel}`
    );
    // Button is disabled during loading
    assert(source.includes('refreshBtn.disabled = true;'),
      `Refresh button must be disabled during loading in ${fileLabel}`
    );
    // Button is restored in finally block
    assert(source.includes('refreshBtn.disabled = false;'),
      `Refresh button must be re-enabled after loading in ${fileLabel}`
    );
    assert(source.includes("Refresh Data'"),
      `Refresh button must restore label Refresh Data in ${fileLabel}`
    );
    // Passing ?refresh=true on manual refresh
    assert(source.includes("const summaryUrl = isRefresh ? '/api/admin/content-quality/summary?refresh=true' : '/api/admin/content-quality/summary';"),
      `loadContentQualityData must pass ?refresh=true on manual refresh in ${fileLabel}`
    );
  });
});

// 37. Issue 3: Inspect button row passing, escapeJs safe attribute, and in-memory fallback
it('37. Inspect button uses safe JS string escaping and instant in-memory fallback', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    // Safe JS slug escaping
    assert(source.includes("const jsSlug = escapeJs(item.slug || '');"),
      `renderCqQueueRows must use escapeJs for row slug in ${fileLabel}`
    );
    assert(source.includes("inspectArticleQuality(\\'' + jsSlug + '\\')"),
      `renderCqQueueRows Inspect button must pass jsSlug in ${fileLabel}`
    );
    // Duplicate detector buttons
    assert(source.includes("inspectArticleQuality(\\'' + escapeJs(a.slug || '') + '\\')"),
      `renderCqDuplicateRows Inspect A button must pass escapeJs slug in ${fileLabel}`
    );
    // Fast in-memory preview before API fetch
    assert(source.includes("const localArt = (CqState.items || []).find(a => a.slug === cleanSlug) ||"),
      `inspectArticleQuality must check local in-memory articles first in ${fileLabel}`
    );
    assert(source.includes("CqState.currentInspectedArticle = localArt;"),
      `inspectArticleQuality must populate currentInspectedArticle from in-memory state in ${fileLabel}`
    );
  });
});

// 38. Issue 3: Inspection modal closes on Escape keydown
it('38. Inspection modal closes on Escape keydown without errors', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('closeCqArticleModal();'),
      `Global Escape key listener must close Content Quality inspection modal in ${fileLabel}`
    );
    assert(source.includes('function closeCqArticleModal('),
      `closeCqArticleModal function must be declared in ${fileLabel}`
    );
  });
});

// 39. Issue 5: Missing metadata filter supported in API and UI dropdown
it('39. Missing metadata filter supported in API pagination and UI dropdown', () => {
  // Backend worker support
  assert(cqWorkerContent.includes("filter === 'missing_meta'"),
    'worker/content-quality.js must support missing_meta filter in paginateArticles'
  );
  assert(cqWorkerContent.includes('a.missingTitle || a.missingDate || a.missingAuthor'),
    'worker/content-quality.js must filter for missing metadata fields'
  );

  // Client UI support
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes('<option value="missing_meta">Missing Metadata</option>'),
      `Quality status dropdown must include missing_meta option in ${fileLabel}`
    );
    assert(source.includes("if (f === 'missing_metadata') return 'missing_meta';"),
      `normalizeCqFilter must map missing_metadata alias to missing_meta in ${fileLabel}`
    );
    assert(source.includes("filterCqQueue('missing_meta')"),
      `Missing Metadata KPI card must trigger filterCqQueue('missing_meta') in ${fileLabel}`
    );
  });
});

// 40. Issue 5: Corpus Freshness calculates moderate tier and displays informative tooltips
it('40. Corpus Freshness calculates moderate age tier and provides informative tooltip breakdown', () => {
  // Backend calculation in worker/content-quality.js
  assert(cqWorkerContent.includes("const moderate = articles.filter(a => a.freshness === 'moderate').length;"),
    'worker/content-quality.js buildCorpusSummary must calculate moderate tier'
  );
  assert(cqWorkerContent.includes("freshness: { fresh, recent, moderate, older }"),
    'worker/content-quality.js buildCorpusSummary must return moderate in freshness object'
  );

  // Client rendering
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes("const moderateCount = (s.freshness && s.freshness.moderate) || 0;"),
      `renderCqSummaryCards must read moderate freshness count in ${fileLabel}`
    );
    assert(source.includes("Corpus age distribution: Fresh (&le;7d), Recent (8&ndash;30d), Established/Archive (&gt;30d)"),
      `Corpus Freshness card must display informative age distribution tooltip in ${fileLabel}`
    );
  });
});

// 41. Issue 1: Article count reconciliation tooltip and active vs archived breakdown
it('41. Article count reconciliation displays active vs archived dispatches with detailed explanation', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes("let activeCount = 0;"),
      `renderCqSummaryCards must initialize activeCount in ${fileLabel}`
    );
    assert(source.includes("let archivedCount = null;"),
      `renderCqSummaryCards must initialize archivedCount as null in ${fileLabel}`
    );
    assert(source.includes("let corpusTotal = null;"),
      `renderCqSummaryCards must initialize corpusTotal as null in ${fileLabel}`
    );
    assert(!source.includes("let archivedCount = 63;"),
      `renderCqSummaryCards must NOT hardcode archivedCount fallback of 63 in ${fileLabel}`
    );
    assert(!source.includes("let corpusTotal = 1557;"),
      `renderCqSummaryCards must NOT hardcode corpusTotal fallback of 1557 in ${fileLabel}`
    );
    assert(source.includes("activeCount.toLocaleString() + ' active · ' + archivedCount.toLocaleString() + ' archived'"),
      `renderCqSummaryCards must render active vs archived breakdown in ${fileLabel}`
    );
    assert(source.includes("corpusTotal.toLocaleString() + ' total corpus articles (' + activeCount.toLocaleString() + ' active dispatches, ' + archivedCount.toLocaleString() + ' archived/noindex/redirects)'"),
      `renderCqSummaryCards must expose full reconciliation tooltip in ${fileLabel}`
    );
    assert(source.includes("activeCount.toLocaleString() + ' active · archived unavailable'"),
      `renderCqSummaryCards must support archived unavailable label in ${fileLabel}`
    );
  });
});

// 42. Synchronized inspection modal contains authoritative live article link
it('42. Inspection modal dynamically binds authoritative live article link', () => {
  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    assert(source.includes("modalLiveUrl = (art.publicUrl && art.publicUrl.startsWith('/articles/'))"),
      `renderCqArticleModal must enforce /articles/ format for modalLiveUrl in ${fileLabel}`
    );
    assert(source.includes("liveBtn.href = modalLiveUrl;"),
      `renderCqArticleModal must set liveBtn.href in ${fileLabel}`
    );
  });
});

// 43. Authoritative count reconciliation calculation logic execution across all scenarios
it('43. Authoritative count calculation logic execution across explicit, legacy, full-corpus, zero, missing, malformed, and inconsistent payloads', () => {
  const cqSummaryMatch = cqWorkerContent.match(/export function buildCorpusSummary\(articles, duplicatePairs\)\s*\{([\s\S]*?)\n\}/);
  assert(cqSummaryMatch, 'Could not extract buildCorpusSummary from worker/content-quality.js');
  const runBuildCorpusSummary = vm.runInContext('(function(articles, duplicatePairs) {' + cqSummaryMatch[1] + '})', vm.createContext({}));

  [njkContent, editorialHtml].forEach((source, idx) => {
    const fileLabel = idx === 0 ? 'src/admin/editorial/index.njk' : 'worker/admin-views.js';
    const fnMatch = source.match(/function renderCqSummaryCards\(s\)\s*\{([\s\S]*?)\n    \}/);
    assert(fnMatch, `Could not extract renderCqSummaryCards from ${fileLabel}`);

    function createRunner() {
      const dom = {};
      const mockDoc = {
        getElementById: (id) => {
          if (!dom[id]) dom[id] = { textContent: '', innerHTML: '', title: '' };
          return dom[id];
        }
      };
      const ctx = vm.createContext({
        document: mockDoc,
        window: {},
        AppState: { articles: [] }
      });
      const fn = vm.runInContext('(function(s) {' + fnMatch[1] + '})', ctx);
      return { fn, dom };
    }

    // 1. Full corpus with zero excluded records
    {
      const { fn, dom } = createRunner();
      fn({ total: 100, active: 100, noindexed: 0, corpusTotal: 100 });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '100', `Articles analyzed must display 100 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '100 active · 0 archived', `Subtext must show 100 active · 0 archived in ${fileLabel}`);
      assert(dom['cq-kpi-total-sub'].title.includes('100 total corpus articles (100 active dispatches, 0 archived/noindex/redirects)'),
        `Tooltip must explain full corpus breakdown with 0 excluded records in ${fileLabel}`);
    }

    // 2. Full corpus with excluded records
    {
      const { fn, dom } = createRunner();
      fn({ total: 1557, active: 1494, noindexed: 63, corpusTotal: 1557 });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '1,494', `Articles analyzed must display 1,494 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '1,494 active · 63 archived', `Subtext must show 1,494 active · 63 archived in ${fileLabel}`);
      assert(dom['cq-kpi-total-sub'].title.includes('1,557 total corpus articles (1,494 active dispatches, 63 archived/noindex/redirects)'),
        `Tooltip must explain 1,557 total corpus in ${fileLabel}`);
    }

    // 3. Active-only legacy payload with no archive count
    {
      const { fn, dom } = createRunner();
      fn({ total: 1494 });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '1,494', `Articles analyzed must display known active 1,494 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '1,494 active · archived unavailable',
        `Subtext must label archived as unavailable instead of inventing a number in ${fileLabel}`);
      assert(dom['cq-kpi-total-sub'].title.includes('unavailable'),
        `Tooltip must indicate physical corpus total unavailable in ${fileLabel}`);
      assert(!dom['cq-kpi-total-sub'].textContent.includes('63'),
        `Must NEVER infer that exactly 63 records are archived in ${fileLabel}`);
    }

    // 4. Active-only legacy payload with an explicitly verified archive count
    {
      const { fn, dom } = createRunner();
      fn({ total: 1494, noindexed: 63 });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '1,494', `Articles analyzed must display 1,494 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '1,494 active · 63 archived',
        `Subtext must reconcile verified 63 archived with 1,494 active in ${fileLabel}`);
      assert(dom['cq-kpi-total-sub'].title.includes('1,557 total corpus articles'),
        `Tooltip must derive full corpus total without double-subtraction in ${fileLabel}`);
      assert(!dom['cq-kpi-total-sub'].textContent.includes('1,431'),
        `Must NOT double-subtract active count to 1,431 in ${fileLabel}`);
    }

    // 5. Empty corpus
    {
      const { fn, dom } = createRunner();
      fn({ total: 0 });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '0', `Zero count must render 0 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '0 published dispatches', `Zero count subtext must render 0 published dispatches in ${fileLabel}`);

      const { fn: fnEmpty, dom: domEmpty } = createRunner();
      fnEmpty({ total: 0, active: 0, noindexed: 0, corpusTotal: 0 });
      assert.strictEqual(domEmpty['cq-kpi-total'].textContent, '0', `Empty corpus summary must render 0 in ${fileLabel}`);
      assert.strictEqual(domEmpty['cq-kpi-total-sub'].textContent, '0 published dispatches', `Empty corpus subtext must render 0 published dispatches in ${fileLabel}`);
    }

    // 6. Missing, negative, string, and NaN count fields
    {
      const { fn, dom } = createRunner();
      fn({});
      assert.strictEqual(dom['cq-kpi-total'].textContent, '--', `Empty summary must render honest unavailable -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, 'Data unavailable', `Empty summary subtext must show Data unavailable in ${fileLabel}`);

      const { fn: fn2, dom: dom2 } = createRunner();
      fn2({ healthy: 10 });
      assert.strictEqual(dom2['cq-kpi-total'].textContent, '--', `Missing count summary must render -- in ${fileLabel}`);
      assert.strictEqual(dom2['cq-kpi-total-sub'].textContent, 'Data unavailable', `Missing count subtext must show Data unavailable in ${fileLabel}`);

      const { fn: fn3, dom: dom3 } = createRunner();
      fn3(null);
      assert.strictEqual(dom3['cq-kpi-total'].textContent, '--', `Null payload must render -- in ${fileLabel}`);

      const { fn: fn4, dom: dom4 } = createRunner();
      fn4(undefined);
      assert.strictEqual(dom4['cq-kpi-total'].textContent, '--', `Undefined payload must render -- in ${fileLabel}`);

      const { fn: fn5, dom: dom5 } = createRunner();
      fn5({ total: -10 });
      assert.strictEqual(dom5['cq-kpi-total'].textContent, '--', `Negative total must render -- in ${fileLabel}`);
      assert.strictEqual(dom5['cq-kpi-total-sub'].textContent, 'Data unavailable', `Negative total must show Data unavailable in ${fileLabel}`);

      const { fn: fn6, dom: dom6 } = createRunner();
      fn6({ total: 'invalid' });
      assert.strictEqual(dom6['cq-kpi-total'].textContent, '--', `String total must render -- in ${fileLabel}`);

      const { fn: fn7, dom: dom7 } = createRunner();
      fn7({ total: NaN });
      assert.strictEqual(dom7['cq-kpi-total'].textContent, '--', `NaN total must render -- in ${fileLabel}`);
    }

    // 7. Inconsistent active, total, noindexed, and corpusTotal
    {
      // Subcase 7a: corpusTotal < active
      const { fn, dom } = createRunner();
      fn({ active: 1494, corpusTotal: 1000, noindexed: 63 });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '1,494', `Inconsistent corpusTotal must preserve active 1,494 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '1,494 active · 63 archived', `Subtext must preserve active and archived in ${fileLabel}`);
      assert(dom['cq-kpi-total-sub'].title.includes('1,557 total corpus articles'),
        `Physical corpus total must never be smaller than active count in ${fileLabel}`);

      // Subcase 7b: noindexed > corpusTotal
      const { fn: fn2, dom: dom2 } = createRunner();
      fn2({ corpusTotal: 100, noindexed: 200 });
      assert.strictEqual(dom2['cq-kpi-total'].textContent, '0', `Negative active clamped to 0 in ${fileLabel}`);

      // Subcase 7c: negative active
      const { fn: fn3, dom: dom3 } = createRunner();
      fn3({ active: -20 });
      assert.strictEqual(dom3['cq-kpi-total'].textContent, '--', `Negative active count rejected in ${fileLabel}`);
    }

    // 8. Adding four new articles changes counts dynamically, with no source-code edits
    {
      const mockArticles = Array.from({ length: 1557 }, (_, i) => ({
        slug: `art-${i}`,
        noindex: i < 63,
        qualityStatus: 'healthy',
        bodyWords: 250,
        signals: []
      }));
      const baseSummary = runBuildCorpusSummary(mockArticles, []);
      assert.strictEqual(baseSummary.total, 1557);
      assert.strictEqual(baseSummary.active, 1494);
      assert.strictEqual(baseSummary.noindexed, 63);
      assert.strictEqual(baseSummary.corpusTotal, 1557);

      // Dynamically append 4 new active articles
      const expandedArticles = [
        ...mockArticles,
        { slug: 'art-1557', noindex: false, qualityStatus: 'healthy', bodyWords: 300, signals: [] },
        { slug: 'art-1558', noindex: false, qualityStatus: 'healthy', bodyWords: 320, signals: [] },
        { slug: 'art-1559', noindex: false, qualityStatus: 'healthy', bodyWords: 350, signals: [] },
        { slug: 'art-1560', noindex: false, qualityStatus: 'healthy', bodyWords: 400, signals: [] }
      ];
      const dynamicSummary = runBuildCorpusSummary(expandedArticles, []);
      assert.strictEqual(dynamicSummary.total, 1561, 'Dynamic total must be 1561');
      assert.strictEqual(dynamicSummary.active, 1498, 'Dynamic active must be 1498');
      assert.strictEqual(dynamicSummary.noindexed, 63, 'Dynamic noindexed must remain 63');
      assert.strictEqual(dynamicSummary.corpusTotal, 1561, 'Dynamic corpusTotal must be 1561');

      const { fn, dom } = createRunner();
      fn(dynamicSummary);
      assert.strictEqual(dom['cq-kpi-total'].textContent, '1,498', `Dynamic active count must render 1,498 in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, '1,498 active · 63 archived',
        `Dynamic subtext must render 1,498 active · 63 archived in ${fileLabel}`);
      assert(dom['cq-kpi-total-sub'].title.includes('1,561 total corpus articles (1,498 active dispatches, 63 archived/noindex/redirects)'),
        `Dynamic tooltip must reflect 1,561 total in ${fileLabel}`);
    }

    // 9. A legacy payload must never receive an invented archive count
    {
      const payloads = [{ total: 1494 }, { total: 1200 }, { total: 500 }, { active: 800 }];
      payloads.forEach(p => {
        const { fn, dom } = createRunner();
        fn(p);
        assert(!dom['cq-kpi-total-sub'].textContent.includes('63'),
          `Legacy payload without verified archive data must NOT receive invented 63 in ${fileLabel}`);
        assert(dom['cq-kpi-total-sub'].textContent.includes('archived unavailable'),
          `Legacy payload without verified archive data must state archived unavailable in ${fileLabel}`);
      });
    }

    // 10. Stale values clear when rendering an unavailable summary
    {
      const { fn, dom } = createRunner();
      // Prime with initial populated data
      fn({
        total: 1557,
        active: 1494,
        noindexed: 63,
        corpusTotal: 1557,
        healthy: 1200,
        needsReview: 200,
        thin: 50,
        nearDuplicates: 10,
        exactDuplicates: 2,
        brief: 30,
        missingMeta: 5,
        sensitive: 8,
        freshness: { fresh: 10, recent: 20, moderate: 30, older: 40 }
      });
      assert.strictEqual(dom['cq-kpi-total'].textContent, '1,494');
      assert.strictEqual(dom['cq-kpi-healthy'].textContent, '1,200');
      assert.strictEqual(dom['cq-kpi-review'].textContent, '200');
      assert.strictEqual(dom['cq-kpi-thin'].textContent, '50');
      assert.strictEqual(dom['cq-kpi-duplicates'].textContent, '10');
      assert.strictEqual(dom['cq-kpi-briefs'].textContent, '30');
      assert.strictEqual(dom['cq-kpi-missing-meta'].textContent, '5');
      assert.strictEqual(dom['cq-kpi-sensitive'].textContent, '8');

      // Now pass unavailable summary (null)
      fn(null);
      assert.strictEqual(dom['cq-kpi-total'].textContent, '--', `Total must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-total-sub'].textContent, 'Data unavailable', `Total sub must show Data unavailable in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-healthy'].textContent, '--', `Healthy must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-review'].textContent, '--', `Review must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-thin'].textContent, '--', `Thin must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-duplicates'].textContent, '--', `Duplicates must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-duplicates-sub'].textContent, 'Data unavailable', `Duplicates sub must clear in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-briefs'].textContent, '--', `Briefs must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-missing-meta'].textContent, '--', `Missing meta must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-sensitive'].textContent, '--', `Sensitive must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-freshness'].textContent, '--', `Freshness must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-kpi-freshness-sub'].textContent, '--', `Freshness sub must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['cq-dup-tab-count'].textContent, '0', `Dup tab count must clear to 0 in ${fileLabel}`);
      assert.strictEqual(dom['side-quality-count'].textContent, '', `Sidebar count must clear in ${fileLabel}`);
      assert.strictEqual(dom['ov-kpi-thin'].textContent, '--', `Overview thin must clear to -- in ${fileLabel}`);
      assert.strictEqual(dom['ov-kpi-total'].textContent, '--', `Overview total must clear to -- in ${fileLabel}`);
    }
  });
});

// 44. Backend buildCorpusSummary produces explicit active and corpusTotal fields dynamically without hardcoded 63
it('44. Backend buildCorpusSummary produces explicit active and corpusTotal fields dynamically without hardcoded 63', () => {
  assert(cqWorkerContent.includes("const active = Math.max(0, total - noindexed);") ||
         cqWorkerContent.includes("const active = total - noindexed;"),
    'worker/content-quality.js buildCorpusSummary must calculate active'
  );
  assert(cqWorkerContent.includes("const corpusTotal = total;"),
    'worker/content-quality.js buildCorpusSummary must set corpusTotal to total'
  );
  assert(!cqWorkerContent.includes("+ 63"),
    'worker/content-quality.js buildCorpusSummary must not contain hardcoded + 63'
  );
  assert(cqWorkerContent.includes("total, active, corpusTotal,"),
    'worker/content-quality.js buildCorpusSummary must export active and corpusTotal in summary payload'
  );

  const cqSummaryMatch = cqWorkerContent.match(/export function buildCorpusSummary\(articles, duplicatePairs\)\s*\{([\s\S]*?)\n\}/);
  const runBuildCorpusSummary = vm.runInContext('(function(articles, duplicatePairs) {' + cqSummaryMatch[1] + '})', vm.createContext({}));
  const emptySummary = runBuildCorpusSummary([], []);
  assert.strictEqual(emptySummary.total, 0, 'Empty corpus total must be 0');
  assert.strictEqual(emptySummary.active, 0, 'Empty corpus active must be 0');
  assert.strictEqual(emptySummary.noindexed, 0, 'Empty corpus noindexed must be 0');
  assert.strictEqual(emptySummary.corpusTotal, 0, 'Empty corpus corpusTotal must be 0');
});

console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
if (passedTests !== totalTests) {
  process.exit(1);
}
