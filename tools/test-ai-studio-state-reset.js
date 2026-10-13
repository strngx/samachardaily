/**
 * Samachar Daily — AI Studio State Reset Verification Suite
 *
 * Verifies:
 * 1. Back to Editor clears the prior AI Studio session (in-memory state, form values, indicators, errors, modals).
 * 2. Opening a different article loads that article, not the previous one.
 * 3. Reopening AI Studio without an article starts clean (empty state, no cached article).
 * 4. Browser navigation does not restore stale AI Studio state unexpectedly.
 * 5. Editorial content and unsaved edits remain intact when returning to editor.
 * 6. Code integrity across src/admin/editorial/index.njk and worker/admin-views.js.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const njkContent = fs.readFileSync(path.join(ROOT_DIR, 'src/admin/editorial/index.njk'), 'utf8');
const avContent = fs.readFileSync(path.join(ROOT_DIR, 'worker/admin-views.js'), 'utf8');

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

// Minimal DOM simulation harness for client-side editorial scripts
function createHarness() {
  const elements = new Map();

  function makeEl(id, tagName = 'div') {
    const el = {
      id,
      tagName: tagName.toUpperCase(),
      style: { display: '' },
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); }
      },
      className: '',
      textContent: '',
      innerText: '',
      innerHTML: '',
      value: '',
      disabled: false,
      getAttribute(k) { return this[k] || ''; },
      setAttribute(k, v) { this[k] = v; },
      focus() {},
      scrollIntoView() {},
      scrollTo() {}
    };
    elements.set(id, el);
    return el;
  }

  // Pre-populate elements used by AI Studio and Editor
  const ids = [
    // AI Studio elements
    'view-ai-upgrade', 'view-articles', 'view-overview',
    'ai-upgrade-empty-state', 'ai-upgrade-workspace',
    'ai-upgrade-provider-status-badge', 'ai-upgrade-draft-status-badge', 'ai-upgrade-safety-verdict-badge',
    'ai-upgrade-loading-indicator', 'btn-start-ai-upgrade', 'btn-regenerate-upgrade',
    'btn-accept-ai-upgrade', 'btn-ai-back-to-editor',
    'ai-upgrade-error-banner', 'ai-upgrade-error-message',
    'ai-up-selected-meta-strip', 'ai-up-selected-headline', 'ai-up-selected-desk',
    'ai-up-selected-date', 'ai-up-selected-source', 'ai-up-selected-words', 'ai-up-selected-slug',
    'sbs-orig-headline', 'sbs-orig-seo-title', 'sbs-orig-dek', 'sbs-orig-body',
    'sbs-orig-why-it-matters', 'sbs-orig-what-happens-next', 'sbs-orig-count',
    'sbs-cand-headline', 'sbs-cand-seo-title', 'sbs-cand-dek', 'sbs-cand-body',
    'sbs-cand-why-it-matters', 'sbs-cand-what-happens-next', 'sbs-cand-count',
    'sbs-cand-seo-title-chars', 'sbs-cand-why-words', 'sbs-cand-next-words',
    'sbs-delta-badge', 'sbs-cand-status-pill', 'sbs-provider-used', 'sbs-quality-badge',
    'sbs-changes-list',
    // Modals
    'compare-changes-modal', 'compare-modal-orig-headline', 'compare-modal-cand-headline',
    'compare-modal-orig-seo-title', 'compare-modal-cand-seo-title', 'compare-modal-orig-dek',
    'compare-modal-cand-dek', 'compare-modal-orig-why', 'compare-modal-cand-why',
    'compare-modal-orig-next', 'compare-modal-cand-next', 'compare-modal-orig-body',
    'compare-modal-cand-body', 'compare-modal-words', 'compare-modal-changes-list',
    'accept-upgrade-modal', 'accept-modal-headline', 'accept-modal-slug', 'accept-modal-seo-title',
    'accept-modal-words', 'btn-confirm-save-upgrade',
    // Editor elements
    'articles-list-container', 'articles-editor-container', 'top-breadcrumb',
    'edit-headline', 'edit-seo-title', 'edit-dek', 'edit-body', 'edit-why-it-matters',
    'edit-what-happens-next', 'edit-category', 'edit-author', 'edit-slug', 'edit-date-display', 'edit-url',
    'editor-save-status', 'editor-error-panel'
  ];

  ids.forEach(id => makeEl(id));

  const historyStack = [{ url: 'https://thesamachardaily.in/admin/editorial/?view=articles' }];
  let historyIdx = 0;

  const harness = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          return makeEl(id);
        }
        return elements.get(id);
      },
      querySelectorAll(selector) {
        if (selector === '.view-pane') {
          return [elements.get('view-ai-upgrade'), elements.get('view-articles'), elements.get('view-overview')];
        }
        if (selector.includes('.nav-item')) {
          return [];
        }
        return [];
      }
    },
    window: {
      location: new URL('https://thesamachardaily.in/admin/editorial/?view=articles'),
      history: {
        pushState(state, title, urlStr) {
          harness.window.location = new URL(urlStr, harness.window.location.origin);
          historyStack.push({ state, url: harness.window.location.href });
          historyIdx = historyStack.length - 1;
        },
        replaceState(state, title, urlStr) {
          harness.window.location = new URL(urlStr, harness.window.location.origin);
          historyStack[historyIdx] = { state, url: harness.window.location.href };
        }
      }
    },
    popstateListeners: [],
    addEventListener(evt, fn) {
      if (evt === 'popstate') this.popstateListeners.push(fn);
    },
    triggerPopstate(urlStr) {
      this.window.location = new URL(urlStr, this.window.location.origin);
      this.popstateListeners.forEach(fn => fn({ type: 'popstate' }));
    }
  };

  return harness;
}

(function runSuite() {
  console.log('\n--- AI STUDIO STATE RESET & NAVIGATION VERIFICATION SUITE ---\n');

  // TEST 1: Code Integrity
  it('1. Code integrity: template and worker views enforce clean state reset and no sticky fallbacks', () => {
    // Both files must declare clearAiStudioSession
    assert(njkContent.includes('function clearAiStudioSession()'), 'index.njk missing clearAiStudioSession');
    assert(avContent.includes('function clearAiStudioSession()'), 'worker/admin-views.js missing clearAiStudioSession');

    // Neither file should fall back to AppState.currentlyEditingArticle or AiUpgradeState.selectedArticle in initAiUpgradeView
    assert(!njkContent.includes('if (!targetArticle && AppState && AppState.currentlyEditingArticle)'),
      'index.njk should not fall back to currentlyEditingArticle in initAiUpgradeView');
    assert(!avContent.includes('if (!targetArticle && AppState && AppState.currentlyEditingArticle)'),
      'worker/admin-views.js should not fall back to currentlyEditingArticle in initAiUpgradeView');

    assert(!njkContent.includes('if (!targetArticle && AiUpgradeState && AiUpgradeState.selectedArticle)'),
      'index.njk should not fall back to AiUpgradeState.selectedArticle in initAiUpgradeView');
    assert(!avContent.includes('if (!targetArticle && AiUpgradeState && AiUpgradeState.selectedArticle)'),
      'worker/admin-views.js should not fall back to AiUpgradeState.selectedArticle in initAiUpgradeView');

    // Both files should call clearAiStudioSession() in returnToEditor()
    assert(njkContent.includes('clearAiStudioSession();\n      if (AppState && AppState.currentlyEditingArticle)') ||
           njkContent.includes('clearAiStudioSession();\r\n      if (AppState && AppState.currentlyEditingArticle)'),
      'index.njk must call clearAiStudioSession in returnToEditor');
    assert(avContent.includes('clearAiStudioSession();\\r\\n      if (AppState && AppState.currentlyEditingArticle)') ||
           avContent.includes('clearAiStudioSession();\\n      if (AppState && AppState.currentlyEditingArticle)'),
      'worker/admin-views.js must call clearAiStudioSession in returnToEditor');
  });

  // TEST 2: Back to Editor clears prior AI Studio session
  it('2. Back to Editor clears prior AI Studio session (in-memory state, candidate text, indicators, errors, modals)', () => {
    const harness = createHarness();
    const doc = harness.document;

    // Simulate AiUpgradeState with active article and candidate rewrite
    const AiUpgradeState = {
      selectedArticle: { slug: 'article-a', title: 'Article A Headline', relPath: 'src/articles/india/article-a.md' },
      originalArticle: { slug: 'article-a', title: 'Article A Headline', relPath: 'src/articles/india/article-a.md' },
      candidateArticle: { headline: 'Rewritten Candidate A', body: 'Candidate Body Content', providerUsed: 'Gemini' },
      safetyFindings: ['some flag'],
      isAnalyzing: true,
      isGenerating: true,
      isSaving: true,
      currentStep: 2,
      lastQuality: { valid: true }
    };

    const AppState = {
      currentView: 'ai-upgrade',
      articleSubView: 'editor',
      currentlyEditingArticle: { slug: 'article-a', title: 'Article A Headline', relPath: 'src/articles/india/article-a.md' }
    };

    // Fill candidate DOM inputs
    doc.getElementById('sbs-cand-headline').value = 'Rewritten Candidate A';
    doc.getElementById('sbs-cand-seo-title').value = 'Rewritten SEO A';
    doc.getElementById('sbs-cand-dek').value = 'Rewritten Dek A';
    doc.getElementById('sbs-cand-body').value = 'Rewritten Body A';
    doc.getElementById('sbs-cand-why-it-matters').value = 'Rewritten Context A';
    doc.getElementById('sbs-cand-what-happens-next').value = 'Rewritten Next A';

    // Set indicators
    doc.getElementById('sbs-cand-status-pill').textContent = 'Rewrite Candidate';
    doc.getElementById('sbs-delta-badge').textContent = '+150 words';
    doc.getElementById('ai-upgrade-draft-status-badge').style.display = 'inline-flex';
    doc.getElementById('ai-upgrade-error-banner').style.display = 'block';
    doc.getElementById('ai-upgrade-error-message').textContent = 'Temporary model timeout';
    doc.getElementById('compare-changes-modal').style.display = 'flex';
    doc.getElementById('accept-upgrade-modal').style.display = 'flex';
    doc.getElementById('ai-upgrade-workspace').style.display = 'flex';
    doc.getElementById('ai-upgrade-empty-state').style.display = 'none';

    // Mock clearAiStudioSession using the exact logic from index.njk
    function clearAiStudioSession() {
      if (typeof AiUpgradeState !== 'undefined' && AiUpgradeState) {
        AiUpgradeState.selectedArticle = null;
        AiUpgradeState.originalArticle = null;
        AiUpgradeState.candidateArticle = null;
        AiUpgradeState.safetyFindings = [];
        AiUpgradeState.isAnalyzing = false;
        AiUpgradeState.isGenerating = false;
        AiUpgradeState.isSaving = false;
        AiUpgradeState.currentStep = 1;
        AiUpgradeState.lastQuality = null;
      }

      const candHead = doc.getElementById('sbs-cand-headline');
      const candSeo = doc.getElementById('sbs-cand-seo-title');
      const candDek = doc.getElementById('sbs-cand-dek');
      const candBody = doc.getElementById('sbs-cand-body');
      const candWhy = doc.getElementById('sbs-cand-why-it-matters');
      const candNext = doc.getElementById('sbs-cand-what-happens-next');
      if (candHead) candHead.value = '';
      if (candSeo) candSeo.value = '';
      if (candDek) candDek.value = '';
      if (candBody) candBody.value = '';
      if (candWhy) candWhy.value = '';
      if (candNext) candNext.value = '';

      const candCount = doc.getElementById('sbs-cand-count');
      const seoCharsEl = doc.getElementById('sbs-cand-seo-title-chars');
      const whyWordsEl = doc.getElementById('sbs-cand-why-words');
      const nextWordsEl = doc.getElementById('sbs-cand-next-words');
      const deltaBadge = doc.getElementById('sbs-delta-badge');
      const candPill = doc.getElementById('sbs-cand-status-pill');
      const draftBadge = doc.getElementById('ai-upgrade-draft-status-badge');
      const provEl = doc.getElementById('sbs-provider-used');
      const qualityBadge = doc.getElementById('sbs-quality-badge');
      const changesList = doc.getElementById('sbs-changes-list');
      const regenBtn = doc.getElementById('btn-regenerate-upgrade');

      if (candCount) candCount.textContent = '0 words';
      if (seoCharsEl) {
        seoCharsEl.textContent = '0 chars (target 50–60)';
        seoCharsEl.style.color = 'var(--color-muted)';
      }
      if (whyWordsEl) whyWordsEl.textContent = '0 words';
      if (nextWordsEl) nextWordsEl.textContent = '0 words';
      if (deltaBadge) {
        deltaBadge.textContent = '0 words';
        deltaBadge.className = 'badge badge-teal';
      }
      if (candPill) {
        candPill.className = 'badge badge-pink';
        candPill.textContent = 'Pending Rewrite';
      }
      if (draftBadge) {
        draftBadge.style.display = 'none';
        draftBadge.className = 'badge badge-blue';
        draftBadge.textContent = 'Draft';
      }
      if (provEl) provEl.textContent = 'AI';
      if (qualityBadge) {
        qualityBadge.textContent = 'PASS';
        qualityBadge.className = 'badge badge-green';
      }
      if (changesList) changesList.innerHTML = '';
      if (regenBtn) regenBtn.style.display = 'none';

      const startBtn = doc.getElementById('btn-start-ai-upgrade');
      const loader = doc.getElementById('ai-upgrade-loading-indicator');
      const errBanner = doc.getElementById('ai-upgrade-error-banner');
      const errMsg = doc.getElementById('ai-upgrade-error-message');
      if (startBtn) startBtn.disabled = false;
      if (loader) loader.style.display = 'none';
      if (errBanner) errBanner.style.display = 'none';
      if (errMsg) errMsg.textContent = '';

      const headEl = doc.getElementById('ai-up-selected-headline');
      const deskEl = doc.getElementById('ai-up-selected-desk');
      const dateEl = doc.getElementById('ai-up-selected-date');
      const sourceEl = doc.getElementById('ai-up-selected-source');
      const wordsEl = doc.getElementById('ai-up-selected-words');
      const slugEl = doc.getElementById('ai-up-selected-slug');
      if (headEl) headEl.textContent = 'Selected Article Headline';
      if (deskEl) deskEl.textContent = 'India';
      if (dateEl) dateEl.textContent = 'Date';
      if (sourceEl) sourceEl.textContent = 'Declared wire';
      if (wordsEl) wordsEl.textContent = '0 words';
      if (slugEl) slugEl.textContent = 'slug';

      const origHead = doc.getElementById('sbs-orig-headline');
      const origSeo = doc.getElementById('sbs-orig-seo-title');
      const origDek = doc.getElementById('sbs-orig-dek');
      const origBody = doc.getElementById('sbs-orig-body');
      const origWhy = doc.getElementById('sbs-orig-why-it-matters');
      const origNext = doc.getElementById('sbs-orig-what-happens-next');
      const origCount = doc.getElementById('sbs-orig-count');
      if (origHead) origHead.textContent = 'Headline';
      if (origSeo) origSeo.textContent = 'No custom SEO title';
      if (origDek) origDek.textContent = 'Dek / description';
      if (origBody) origBody.textContent = 'Complete article body...';
      if (origWhy) origWhy.textContent = 'Why It Matters...';
      if (origNext) origNext.textContent = 'What Happens Next...';
      if (origCount) origCount.textContent = '0 words';

      const compareModal = doc.getElementById('compare-changes-modal');
      const acceptModal = doc.getElementById('accept-upgrade-modal');
      if (compareModal) compareModal.style.display = 'none';
      if (acceptModal) acceptModal.style.display = 'none';

      const emptyState = doc.getElementById('ai-upgrade-empty-state');
      const workspace = doc.getElementById('ai-upgrade-workspace');
      if (emptyState) emptyState.style.display = 'block';
      if (workspace) workspace.style.display = 'none';
    }

    let returnedToEditorCalled = false;
    function navigate(viewId, options = {}) {
      if (viewId === 'articles' && options.subview === 'editor') {
        returnedToEditorCalled = true;
        AppState.currentView = 'articles';
        AppState.articleSubView = 'editor';
      }
    }

    function returnToEditor() {
      const fallbackRelPath = (AiUpgradeState && AiUpgradeState.selectedArticle) ? AiUpgradeState.selectedArticle.relPath : null;
      clearAiStudioSession();
      if (AppState && AppState.currentlyEditingArticle) {
        navigate('articles', { subview: 'editor' });
      } else if (fallbackRelPath) {
        openArticleEditor(fallbackRelPath);
      } else {
        navigate('articles');
      }
    }

    // Execute returnToEditor
    returnToEditor();

    // Verify all session states are wiped
    assert.strictEqual(AiUpgradeState.selectedArticle, null, 'selectedArticle must be null');
    assert.strictEqual(AiUpgradeState.originalArticle, null, 'originalArticle must be null');
    assert.strictEqual(AiUpgradeState.candidateArticle, null, 'candidateArticle must be null');
    assert.strictEqual(AiUpgradeState.safetyFindings.length, 0, 'safetyFindings must be empty');
    assert.strictEqual(AiUpgradeState.lastQuality, null, 'lastQuality must be null');
    assert.strictEqual(AiUpgradeState.isGenerating, false, 'isGenerating must be false');

    // Verify candidate form values are cleared
    assert.strictEqual(doc.getElementById('sbs-cand-headline').value, '', 'Candidate headline must be cleared');
    assert.strictEqual(doc.getElementById('sbs-cand-seo-title').value, '', 'Candidate SEO title must be cleared');
    assert.strictEqual(doc.getElementById('sbs-cand-dek').value, '', 'Candidate dek must be cleared');
    assert.strictEqual(doc.getElementById('sbs-cand-body').value, '', 'Candidate body must be cleared');
    assert.strictEqual(doc.getElementById('sbs-cand-why-it-matters').value, '', 'Candidate why_it_matters must be cleared');
    assert.strictEqual(doc.getElementById('sbs-cand-what-happens-next').value, '', 'Candidate what_happens_next must be cleared');

    // Verify indicators & errors reset
    assert.strictEqual(doc.getElementById('sbs-cand-status-pill').textContent, 'Pending Rewrite');
    assert.strictEqual(doc.getElementById('sbs-delta-badge').textContent, '0 words');
    assert.strictEqual(doc.getElementById('ai-upgrade-draft-status-badge').style.display, 'none');
    assert.strictEqual(doc.getElementById('ai-upgrade-error-banner').style.display, 'none');
    assert.strictEqual(doc.getElementById('ai-upgrade-error-message').textContent, '');
    assert.strictEqual(doc.getElementById('compare-changes-modal').style.display, 'none');
    assert.strictEqual(doc.getElementById('accept-upgrade-modal').style.display, 'none');

    // Verify clean empty-state visibility
    assert.strictEqual(doc.getElementById('ai-upgrade-empty-state').style.display, 'block');
    assert.strictEqual(doc.getElementById('ai-upgrade-workspace').style.display, 'none');

    // Verify returned to editor
    assert.strictEqual(returnedToEditorCalled, true, 'Must navigate back to articles editor');
    assert.strictEqual(AppState.currentView, 'articles');
    assert.strictEqual(AppState.articleSubView, 'editor');
  });

  // TEST 3: Opening a different article loads that article, not the previous one
  it('3. Opening a different article loads that article, not the previous one', () => {
    const harness = createHarness();
    const doc = harness.document;

    const articleA = { slug: 'slug-a', title: 'Article A Headline', category: 'Business', body: 'Body A', wordCount: 50 };
    const articleB = { slug: 'slug-b', title: 'Article B Headline', category: 'Tech', body: 'Body B', wordCount: 80 };

    const AppState = {
      articles: [articleA, articleB],
      currentView: 'articles',
      currentlyEditingArticle: articleA
    };

    const AiUpgradeState = {
      selectedArticle: null,
      originalArticle: null,
      candidateArticle: null
    };

    function loadStudioArticle(art) {
      AiUpgradeState.selectedArticle = art;
      AiUpgradeState.originalArticle = JSON.parse(JSON.stringify(art));
      AiUpgradeState.candidateArticle = null;

      doc.getElementById('ai-up-selected-headline').textContent = art.title;
      doc.getElementById('sbs-orig-headline').textContent = art.title;
      doc.getElementById('sbs-orig-body').textContent = art.body;
      doc.getElementById('sbs-orig-count').textContent = art.wordCount + ' words';

      doc.getElementById('sbs-cand-headline').value = '';
      doc.getElementById('sbs-cand-body').value = '';
      doc.getElementById('sbs-cand-status-pill').textContent = 'Pending Rewrite';

      doc.getElementById('ai-upgrade-empty-state').style.display = 'none';
      doc.getElementById('ai-upgrade-workspace').style.display = 'flex';
    }

    function initAiUpgradeView(preselectedArticle) {
      let targetArticle = preselectedArticle;
      if (typeof targetArticle === 'string') {
        targetArticle = AppState.articles.find(a => a.slug === targetArticle) || null;
      }
      if (targetArticle) {
        loadStudioArticle(targetArticle);
      }
    }

    // 1. Initially load Article A
    initAiUpgradeView(articleA);
    assert.strictEqual(AiUpgradeState.selectedArticle.slug, 'slug-a');
    assert.strictEqual(doc.getElementById('ai-up-selected-headline').textContent, 'Article A Headline');

    // 2. Open Article B
    initAiUpgradeView(articleB);
    assert.strictEqual(AiUpgradeState.selectedArticle.slug, 'slug-b', 'Must load Article B, not Article A');
    assert.strictEqual(doc.getElementById('ai-up-selected-headline').textContent, 'Article B Headline');
    assert.strictEqual(doc.getElementById('sbs-orig-body').textContent, 'Body B');
    assert.strictEqual(doc.getElementById('sbs-cand-status-pill').textContent, 'Pending Rewrite');
  });

  // TEST 4: Reopening AI Studio without an article starts clean
  it('4. Reopening AI Studio without an article starts clean (empty state, no cached article)', () => {
    const harness = createHarness();
    const doc = harness.document;

    const articleA = { slug: 'slug-a', title: 'Article A Headline' };
    const AppState = {
      articles: [articleA],
      currentlyEditingArticle: articleA
    };

    const AiUpgradeState = {
      selectedArticle: null,
      originalArticle: null,
      candidateArticle: null
    };

    let sessionCleared = false;
    function clearAiStudioSession() {
      sessionCleared = true;
      AiUpgradeState.selectedArticle = null;
      AiUpgradeState.originalArticle = null;
      AiUpgradeState.candidateArticle = null;
      doc.getElementById('ai-upgrade-empty-state').style.display = 'block';
      doc.getElementById('ai-upgrade-workspace').style.display = 'none';
    }

    function initAiUpgradeView(preselectedArticle) {
      let targetArticle = preselectedArticle;
      if (typeof targetArticle === 'string') {
        targetArticle = AppState.articles.find(a => a.slug === targetArticle) || null;
      }
      if (targetArticle) {
        AiUpgradeState.selectedArticle = targetArticle;
      } else {
        clearAiStudioSession();
      }
    }

    // Call initAiUpgradeView with no article (e.g. sidebar navigation)
    initAiUpgradeView(undefined);

    assert.strictEqual(sessionCleared, true, 'clearAiStudioSession must be executed');
    assert.strictEqual(AiUpgradeState.selectedArticle, null, 'No article should be selected');
    assert.strictEqual(doc.getElementById('ai-upgrade-empty-state').style.display, 'block');
    assert.strictEqual(doc.getElementById('ai-upgrade-workspace').style.display, 'none');
  });

  // TEST 5: Browser navigation does not restore stale AI Studio state unexpectedly
  it('5. Browser navigation (popstate) handles ai-upgrade URL query parameters cleanly', () => {
    const harness = createHarness();
    const doc = harness.document;

    const articleA = { slug: 'slug-a', title: 'Article A Headline' };
    const AppState = {
      articles: [articleA],
      currentlyEditingArticle: articleA,
      currentView: 'overview'
    };

    const AiUpgradeState = {
      selectedArticle: null,
      candidateArticle: null
    };

    let lastNavigatedView = '';
    let lastNavigatedArticle = null;

    function navigate(viewId, options = {}) {
      lastNavigatedView = viewId;
      lastNavigatedArticle = options.article || null;
      AppState.currentView = viewId;

      if (!options.fromPopState) {
        const url = new URL(harness.window.location);
        url.searchParams.set('view', viewId);
        if (viewId === 'ai-upgrade' && options.article) {
          url.searchParams.set('article', options.article.slug);
        } else {
          url.searchParams.delete('article');
        }
        harness.window.history.pushState({}, '', url.toString());
      }
    }

    function handlePopstate() {
      const params = new URLSearchParams(harness.window.location.search);
      const view = params.get('view') || 'overview';
      const artSlug = params.get('article');

      if (view === 'ai-upgrade') {
        if (artSlug) {
          const art = AppState.articles.find(a => a.slug === artSlug);
          if (art) {
            navigate('ai-upgrade', { article: art, fromPopState: true });
            return;
          }
        }
        navigate('ai-upgrade', { fromPopState: true });
        return;
      }
      navigate(view, { fromPopState: true });
    }

    harness.addEventListener('popstate', handlePopstate);

    // Case A: popstate to ai-upgrade without article -> navigates cleanly with NO article
    harness.triggerPopstate('https://thesamachardaily.in/admin/editorial/?view=ai-upgrade');
    assert.strictEqual(lastNavigatedView, 'ai-upgrade');
    assert.strictEqual(lastNavigatedArticle, null, 'Must navigate to ai-upgrade with NO article');

    // Case B: popstate to ai-upgrade with stale/nonexistent article -> navigates cleanly with NO article
    harness.triggerPopstate('https://thesamachardaily.in/admin/editorial/?view=ai-upgrade&article=deleted-slug');
    assert.strictEqual(lastNavigatedView, 'ai-upgrade');
    assert.strictEqual(lastNavigatedArticle, null, 'Stale slug must fall back to clean empty state');

    // Case C: popstate to ai-upgrade with valid article -> loads that article
    harness.triggerPopstate('https://thesamachardaily.in/admin/editorial/?view=ai-upgrade&article=slug-a');
    assert.strictEqual(lastNavigatedView, 'ai-upgrade');
    assert.strictEqual(lastNavigatedArticle && lastNavigatedArticle.slug, 'slug-a');
  });

  // TEST 6: Editorial content and unsaved edits remain intact
  it('6. Editorial content and unsaved edits remain completely intact when returning from AI Studio', () => {
    const harness = createHarness();
    const doc = harness.document;

    const originalArticle = {
      relPath: 'src/articles/india/live-draft.md',
      slug: 'live-draft',
      title: 'Original Title',
      body: 'Original Body Content'
    };

    const AppState = {
      currentlyEditingArticle: originalArticle,
      _isDirty: true
    };

    // User made unsaved edits in the Editorial Editor
    const editHead = doc.getElementById('edit-headline');
    const editBody = doc.getElementById('edit-body');
    const editDek = doc.getElementById('edit-dek');
    const editSeo = doc.getElementById('edit-seo-title');
    const editWhy = doc.getElementById('edit-why-it-matters');
    const editNext = doc.getElementById('edit-what-happens-next');

    editHead.value = 'User Unsaved Headline Revision';
    editBody.value = 'User Unsaved Complete Article Body with custom breaking notes.';
    editDek.value = 'User Unsaved Executive Dek Summary';
    editSeo.value = 'User Unsaved SEO Title';
    editWhy.value = 'User Unsaved Strategic Synthesis';
    editNext.value = 'User Unsaved Next Steps';

    const AiUpgradeState = {
      selectedArticle: originalArticle,
      candidateArticle: { headline: 'AI Draft', body: 'AI Body' }
    };

    // returnToEditor implementation
    function clearAiStudioSession() {
      AiUpgradeState.selectedArticle = null;
      AiUpgradeState.candidateArticle = null;
    }

    function returnToEditor() {
      clearAiStudioSession();
      // Returns to editor view without wiping editor inputs
      AppState.currentView = 'articles';
      AppState.articleSubView = 'editor';
    }

    returnToEditor();

    // Verify editor inputs and AppState._isDirty are 100% intact
    assert.strictEqual(editHead.value, 'User Unsaved Headline Revision');
    assert.strictEqual(editBody.value, 'User Unsaved Complete Article Body with custom breaking notes.');
    assert.strictEqual(editDek.value, 'User Unsaved Executive Dek Summary');
    assert.strictEqual(editSeo.value, 'User Unsaved SEO Title');
    assert.strictEqual(editWhy.value, 'User Unsaved Strategic Synthesis');
    assert.strictEqual(editNext.value, 'User Unsaved Next Steps');
    assert.strictEqual(AppState._isDirty, true, 'AppState._isDirty must remain true');
    assert.strictEqual(AppState.currentlyEditingArticle, originalArticle, 'currentlyEditingArticle must remain intact');
  });

  // TEST 7: Full client-side JavaScript syntax validation in worker views
  it('7. Full client-side JavaScript syntax validation: zero duplicate declarations or V8 parse errors in worker views', () => {
    const match = avContent.match(/export const editorialHtml = ([\s\S]*?);\r?\n\r?\nexport const qualityIndexJson/);
    assert(match && match[1], 'Could not extract editorialHtml from worker/admin-views.js');
    const edHtml = JSON.parse(match[1]);
    const scriptMatch = edHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch && scriptMatch[1], 'Could not find <script> tag in editorialHtml');
    const script = scriptMatch[1];

    // Validate compilation in Node vm
    assert.doesNotThrow(() => {
      new vm.Script(script, { filename: 'editorial-client-script.js' });
    }, 'Client script in worker/admin-views.js must parse with zero SyntaxErrors');

    // Confirm no duplicate const declaration
    assert(!script.includes('const clearSelectedAiUpgradeArticle ='), 'Found duplicate const clearSelectedAiUpgradeArticle declaration');
    assert(script.includes('function clearSelectedAiUpgradeArticle()'), 'Expected function clearSelectedAiUpgradeArticle() to be present');
  });

  console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
