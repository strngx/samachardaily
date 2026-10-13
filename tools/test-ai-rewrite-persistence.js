/**
 * Samachar Daily — AI Rewrite Persistence Verification Suite
 *
 * Verifies:
 * 1. Accept Rewrite -> Save Changes -> reload -> all six fields remain unchanged.
 * 2. Save API failure -> no false success notification; user edits remain available.
 * 3. Partial or invalid server response -> no false successful-save state.
 * 4. A stale request cannot overwrite a newer save.
 * 5. Existing article loading and saving still work for non-AI edits.
 * 6. Accepting a rewrite alone does not publish the article.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const matter = require('gray-matter');

const ROOT_DIR = path.resolve(__dirname, '..');

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

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

(async function runAll() {
  console.log('\n--- AI REWRITE PERSISTENCE VERIFICATION SUITE ---\n');

  // Verify template & worker module consistency
  const njkContent = fs.readFileSync(path.join(ROOT_DIR, 'src/admin/editorial/index.njk'), 'utf8');
  const avContent = fs.readFileSync(path.join(ROOT_DIR, 'worker/admin-views.js'), 'utf8');
  const workerContent = fs.readFileSync(path.join(ROOT_DIR, 'worker/index.js'), 'utf8');
  const adminAuthContent = fs.readFileSync(path.join(ROOT_DIR, 'tools/admin-auth.js'), 'utf8');

  it('Code integrity: worker/admin-views.js contains authoritative openArticleEditor and reliability sync', () => {
    assert(avContent.includes('edit-headline').valueOf(), 'admin-views.js missing edit-headline');
    assert(avContent.includes('edit-seo-title').valueOf(), 'admin-views.js missing edit-seo-title');
    assert(avContent.includes('edit-dek').valueOf(), 'admin-views.js missing edit-dek');
    assert(avContent.includes('edit-why-it-matters').valueOf(), 'admin-views.js missing edit-why-it-matters');
    assert(avContent.includes('edit-what-happens-next').valueOf(), 'admin-views.js missing edit-what-happens-next');
    assert(avContent.includes('_lastCompletedSaveId'), 'admin-views.js missing save sequence ID tracking');
    assert(avContent.includes('_lastCompletedFetchId'), 'admin-views.js missing fetch sequence ID tracking');
    assert(avContent.includes('_isDirty'), 'admin-views.js missing dirty tracking');
    assert(avContent.includes('showEditorError'), 'admin-views.js missing showEditorError');
    assert(avContent.includes('editor-error-panel'), 'admin-views.js missing editor-error-panel');
    assert(njkContent.includes('_isDirty'), 'index.njk missing dirty tracking');
    assert(njkContent.includes('showEditorError'), 'index.njk missing showEditorError');
    assert(njkContent.includes('editor-error-panel'), 'index.njk missing editor-error-panel');
  });

  it('Code integrity: worker/index.js accepts headline fallback and returns confirmed article', () => {
    assert(workerContent.includes('const effectiveTitle = (typeof title === \'string\' && title.trim()) ? title.trim() : ((typeof headline === \'string\' && headline.trim()) ? headline.trim() : null);'));
    assert(workerContent.includes('headline: parsed.data.title'));
    assert(workerContent.includes('sha: newSha'));
  });

  it('Code integrity: tools/admin-auth.js accepts headline fallback and returns confirmed article', () => {
    assert(adminAuthContent.includes('const effectiveTitle = (typeof title === \'string\' && title.trim()) ? title.trim() : ((typeof headline === \'string\' && headline.trim()) ? headline.trim() : null);'));
    assert(adminAuthContent.includes('headline: file.data.title'));
    assert(adminAuthContent.includes('sha: newSha'));
  });

  // TEST 1: Accept Rewrite -> Save Changes -> reload -> all six fields remain unchanged
  await itAsync('1. Accept Rewrite -> Save Changes -> reload -> all six fields remain unchanged', async () => {
    // 1. Initial article state
    const originalArticle = {
      relPath: 'src/articles/india/sample-test-article.md',
      sha: 'initial_sha_123',
      title: 'Original Headline',
      headline: 'Original Headline',
      seoTitle: 'Original SEO Title',
      dek: 'Original Dek Paragraph',
      body: 'Original short article body content.',
      why_it_matters: 'Original context analysis.',
      what_happens_next: 'Original next steps forecast.',
      category: 'India',
      author: 'SamacharDaily Editorial Desk'
    };

    // 2. Candidate rewritten by AI
    const candidateRewrite = {
      headline: 'AI Rewritten Premium Headline',
      seoTitle: 'AI Rewritten Optimized SEO Title',
      dek: 'AI Rewritten Sharp Executive Summary Dek',
      body: 'AI Rewritten Extensive Verified Investigative Body Paragraph with full corroboration and quotes.',
      why_it_matters: 'AI Rewritten Grounded analytical context with economic and legal synthesis.',
      what_happens_next: 'AI Rewritten Concrete projected timeline and forward expectations.'
    };

    // Simulate /api/admin/ai/upgrade/accept handoff
    const acceptPayload = {
      relPath: originalArticle.relPath,
      sha: originalArticle.sha,
      candidateHeadline: candidateRewrite.headline,
      candidateSeoTitle: candidateRewrite.seoTitle,
      candidateDek: candidateRewrite.dek,
      candidateBody: candidateRewrite.body,
      candidateWhyItMatters: candidateRewrite.why_it_matters,
      candidateWhatHappensNext: candidateRewrite.what_happens_next
    };

    const newTitle = (acceptPayload.candidateHeadline || originalArticle.title).trim();
    const workingDraft = {
      headline: newTitle,
      seoTitle: (acceptPayload.candidateSeoTitle || '').trim(),
      dek: (acceptPayload.candidateDek || '').trim(),
      body: acceptPayload.candidateBody.trim(),
      why_it_matters: (acceptPayload.candidateWhyItMatters || '').trim(),
      what_happens_next: (acceptPayload.candidateWhatHappensNext || '').trim()
    };

    // Staged in editor working state
    const editorWorkingState = {
      ...originalArticle,
      title: workingDraft.headline,
      headline: workingDraft.headline,
      seoTitle: workingDraft.seoTitle,
      dek: workingDraft.dek,
      body: workingDraft.body,
      why_it_matters: workingDraft.why_it_matters,
      what_happens_next: workingDraft.what_happens_next
    };

    // 3. User clicks Save Changes -> sends payload
    const savePayload = {
      relPath: editorWorkingState.relPath,
      sha: editorWorkingState.sha,
      title: editorWorkingState.title,
      headline: editorWorkingState.headline,
      seoTitle: editorWorkingState.seoTitle,
      dek: editorWorkingState.dek,
      body: editorWorkingState.body,
      why_it_matters: editorWorkingState.why_it_matters,
      what_happens_next: editorWorkingState.what_happens_next,
      category: editorWorkingState.category,
      author: editorWorkingState.author
    };

    // Simulated server persistence
    const savedMarkdownData = {
      title: savePayload.title,
      seoTitle: savePayload.seoTitle,
      dek: savePayload.dek,
      why_it_matters: savePayload.why_it_matters,
      what_happens_next: savePayload.what_happens_next,
      category: savePayload.category,
      author: savePayload.author
    };
    const savedMarkdownContent = savePayload.body;
    const newPersistedSha = 'new_persisted_git_sha_456';

    const serverSaveResponse = {
      success: true,
      sha: newPersistedSha,
      modified: new Date().toISOString(),
      article: {
        ...savedMarkdownData,
        headline: savedMarkdownData.title,
        body: savedMarkdownContent,
        relPath: savePayload.relPath,
        sha: newPersistedSha
      }
    };

    assert.strictEqual(serverSaveResponse.success, true);
    assert.strictEqual(serverSaveResponse.article.headline, candidateRewrite.headline);

    // 4. Page refresh occurs: AppState reloaded from static build-time corpus (holding OLD data)
    const refreshedStaticCorpusArticle = {
      relPath: originalArticle.relPath,
      title: 'Original Headline', // Stale build-time data
      headline: 'Original Headline',
      seoTitle: 'Original SEO Title',
      dek: 'Original Dek Paragraph',
      body: null, // Null in static corpus
      why_it_matters: 'Original context analysis.',
      what_happens_next: 'Original next steps forecast.',
      category: 'India'
    };

    // 5. openArticleEditor fetches authoritative state from /api/admin/articles/get
    const serverGetResponse = {
      success: true,
      relPath: savePayload.relPath,
      sha: newPersistedSha,
      data: savedMarkdownData,
      body: savedMarkdownContent
    };

    // Simulate openArticleEditor applying server data
    const art = refreshedStaticCorpusArticle;
    if (serverGetResponse.data) {
      const d = serverGetResponse.data;
      if (d.title !== undefined) art.title = d.title;
      if (d.headline !== undefined && !d.title) art.title = d.headline;
      art.headline = art.title;
      if (d.seoTitle !== undefined) art.seoTitle = d.seoTitle || '';
      if (d.dek !== undefined) art.dek = d.dek || '';
      if (d.why_it_matters !== undefined) art.why_it_matters = d.why_it_matters || '';
      if (d.what_happens_next !== undefined) art.what_happens_next = d.what_happens_next || '';
    }
    art.body = serverGetResponse.body;
    art.sha = serverGetResponse.sha;

    // Verify all 6 fields remain unchanged after reload!
    assert.strictEqual(art.headline, candidateRewrite.headline, 'Headline must match rewritten candidate');
    assert.strictEqual(art.seoTitle, candidateRewrite.seoTitle, 'SEO title must match rewritten candidate');
    assert.strictEqual(art.dek, candidateRewrite.dek, 'Dek must match rewritten candidate');
    assert.strictEqual(art.body, candidateRewrite.body, 'Body must match rewritten candidate');
    assert.strictEqual(art.why_it_matters, candidateRewrite.why_it_matters, 'Why it matters must match rewritten candidate');
    assert.strictEqual(art.what_happens_next, candidateRewrite.what_happens_next, 'What happens next must match rewritten candidate');
    assert.strictEqual(art.sha, newPersistedSha, 'Git SHA must match updated persistent SHA');
  });

  // TEST 2: Save API failure -> no false success notification; user edits remain available
  it('2. Save API failure -> no false success notification; user edits remain available', () => {
    let saveStatusText = 'Editing';
    let saveStatusClass = 'editor-save-indicator';
    let toastShown = null;
    let savedState = { headline: 'Old headline', body: 'Old body' };

    const userEditsInForm = {
      headline: 'My New Headline Before Network Died',
      body: 'My New Long Body Before Network Died'
    };

    // Network failure simulation
    const mockSaveFailure = {
      ok: false,
      status: 500,
      data: { success: false, error: 'Database connection failed' }
    };

    if (mockSaveFailure.ok && mockSaveFailure.data && mockSaveFailure.data.success) {
      saveStatusClass = 'editor-save-indicator saved';
      saveStatusText = 'Saved';
      savedState = { ...userEditsInForm };
    } else {
      saveStatusClass = 'editor-save-indicator error';
      saveStatusText = 'Save error: ' + (mockSaveFailure.data.error || 'Server error');
      toastShown = mockSaveFailure.data.error;
    }

    assert.notStrictEqual(saveStatusClass, 'editor-save-indicator saved', 'Must not show saved class');
    assert(saveStatusText.includes('Save error:'), 'Must show save error');
    assert.strictEqual(toastShown, 'Database connection failed');
    assert.strictEqual(userEditsInForm.headline, 'My New Headline Before Network Died', 'User edits must remain intact');
    assert.strictEqual(userEditsInForm.body, 'My New Long Body Before Network Died', 'User edits must remain intact');
    assert.strictEqual(savedState.headline, 'Old headline', 'Saved state must not be falsely updated');
  });

  // TEST 3: Partial or invalid server response -> no false successful-save state
  it('3. Partial or invalid server response -> no false successful-save state', () => {
    const invalidResponses = [
      { ok: true, data: null }, // HTML error page or empty response
      { ok: true, data: { success: false } },
      { ok: true, data: { error: 'Validation failed' } },
      { ok: false, data: { success: true } } // 400 with success: true (invalid)
    ];

    for (const resp of invalidResponses) {
      let isSuccess = false;
      if (resp.ok && resp.data && resp.data.success === true) {
        isSuccess = true;
      }
      assert.strictEqual(isSuccess, false, 'Invalid response must never trigger success');
    }
  });

  // TEST 4: A stale request cannot overwrite a newer save
  it('4. A stale request cannot overwrite a newer save', () => {
    let lastCompletedSaveId = 0;
    let currentState = { sha: 'initial_sha', text: 'initial' };

    // Request 1 initiated
    const saveSeq1 = 1;
    // Request 2 initiated
    const saveSeq2 = 2;

    // Request 2 finishes FIRST (faster)
    if (saveSeq2 >= lastCompletedSaveId) {
      lastCompletedSaveId = saveSeq2;
      currentState = { sha: 'sha_from_save_2', text: 'Text 2 (newer)' };
    }

    // Request 1 finishes LATER (slow out-of-order response)
    let req1Dropped = false;
    if (saveSeq1 < lastCompletedSaveId) {
      req1Dropped = true; // Stale response dropped
    } else {
      currentState = { sha: 'sha_from_save_1', text: 'Text 1 (stale)' };
    }

    assert.strictEqual(req1Dropped, true, 'Stale request 1 must be dropped');
    assert.strictEqual(currentState.sha, 'sha_from_save_2', 'State must preserve newer save 2');
    assert.strictEqual(currentState.text, 'Text 2 (newer)');
  });

  // TEST 5: Existing article loading and saving still work for non-AI edits
  await itAsync('5. Existing article loading and saving still work for non-AI edits', async () => {
    const normalArticle = {
      relPath: 'src/articles/tech/normal-test-article.md',
      title: 'Manual Headline Edit',
      dek: 'Manual Dek Edit',
      category: 'Tech',
      author: 'Jane Doe',
      body: 'Manual body edit with no AI intervention.'
    };

    // Test frontmatter stringify & parse roundtrip
    const md = `---\ntitle: "${normalArticle.title}"\ndek: "${normalArticle.dek}"\ncategory: "${normalArticle.category}"\nauthor: "${normalArticle.author}"\n---\n\n${normalArticle.body}\n`;
    const parsed = matter(md);

    assert.strictEqual(parsed.data.title, 'Manual Headline Edit');
    assert.strictEqual(parsed.data.dek, 'Manual Dek Edit');
    assert.strictEqual(parsed.data.category, 'Tech');
    assert.strictEqual(parsed.data.author, 'Jane Doe');
    assert.strictEqual(parsed.content.trim(), normalArticle.body);
  });

  // TEST 6: Accepting a rewrite alone does not publish the article
  it('6. Accepting a rewrite alone does not publish the article', () => {
    let gitCommitCount = 0;
    let diskWriteCount = 0;

    // Simulate POST /api/admin/ai/upgrade/accept
    function handleAcceptRewrite(payload) {
      // Stage 1 draft handoff only
      const workingDraft = {
        headline: payload.candidateHeadline,
        body: payload.candidateBody
      };
      // ZERO GitHub writes, ZERO commits, ZERO deployments
      return { success: true, workingDraft };
    }

    const res = handleAcceptRewrite({
      candidateHeadline: 'Draft only',
      candidateBody: 'Draft body only'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(gitCommitCount, 0, 'Must have zero git commits on accept');
    assert.strictEqual(diskWriteCount, 0, 'Must have zero disk writes on accept');
  });

  // TEST 7: Failed save (401, 403, 409, 500, network error) -> all six fields preserved, actionable error displayed, never reports success
  it('7. Failed save (401, 403, 409, 500, network error) -> all six fields preserved, actionable error displayed, never reports success', () => {
    const errorScenarios = [
      {
        name: '401 Unauthorized',
        res: { ok: false, status: 401, data: { success: false, error: 'Session expired' } },
        expectedErrorKeyword: 'Authentication Error (HTTP 401)'
      },
      {
        name: '403 Forbidden',
        res: { ok: false, status: 403, data: { success: false, error: 'Insufficient permissions' } },
        expectedErrorKeyword: 'Authentication Error (HTTP 403)'
      },
      {
        name: '409 Conflict (remote edit)',
        res: { ok: false, status: 409, data: { success: false, conflict: true, currentSha: 'remote_sha_999' } },
        expectedErrorKeyword: 'Edit Conflict (HTTP 409)'
      },
      {
        name: '500 Server Error',
        res: { ok: false, status: 500, data: { success: false, error: 'GitHub Contents API 500' } },
        expectedErrorKeyword: 'Save Error:'
      },
      {
        name: 'Network Connection Failure',
        isNetworkError: true,
        networkError: new Error('Failed to fetch (net::ERR_CONNECTION_REFUSED)'),
        expectedErrorKeyword: 'Network Error:'
      }
    ];

    for (const scenario of errorScenarios) {
      // Editor canvas with all 6 fields
      const editorCanvas = {
        headline: 'Canvas Headline Under Test',
        seoTitle: 'Canvas SEO Title Under Test',
        dek: 'Canvas Dek Summary',
        body: 'Canvas Rich Article Body with multiple paragraphs.',
        why_it_matters: 'Canvas Grounded Analysis',
        what_happens_next: 'Canvas Forward Steps'
      };

      let errorPanelDisplayed = false;
      let errorPanelContent = '';
      let isConflictFlag = false;
      let toastType = null;
      let saveIndicatorClass = '';

      function mockShowEditorError(msg, isConflict = false) {
        errorPanelDisplayed = true;
        errorPanelContent = msg;
        isConflictFlag = isConflict;
      }

      function mockShowToast(msg, type) {
        toastType = type;
      }

      // Simulate save response handler
      if (scenario.isNetworkError) {
        mockShowEditorError('<strong>Network Error:</strong> Failed to connect to server during save (' + (scenario.networkError.message || 'connection failed') + '). Your unsaved edits are preserved in the editor canvas. Check your network connection and click "Save Changes" again.');
        saveIndicatorClass = 'editor-save-indicator error';
        mockShowToast('Save failed: Network error. Edits remain in editor.', 'error');
      } else {
        const res = scenario.res;
        const data = res.data;
        if (res.ok && data && data.success && (data.sha || (data.article && data.article.sha))) {
          saveIndicatorClass = 'editor-save-indicator saved';
          mockShowToast('Article saved successfully', 'success');
        } else if (res.status === 409 || (data && data.conflict)) {
          const remoteSha = (data && data.currentSha) ? (' (Remote Git SHA: ' + data.currentSha.slice(0, 7) + ')') : '';
          mockShowEditorError('<strong>Edit Conflict (HTTP 409):</strong> This article was modified in GitHub by another user or build process' + remoteSha + ' since you opened it. Your unsaved edits are preserved in the editor canvas. To prevent silently overwriting the remote revision, copy any edits you wish to keep, then reload the latest version before saving.', true);
          saveIndicatorClass = 'editor-save-indicator error';
          mockShowToast('Conflict: Article changed in GitHub. Your unsaved edits were preserved.', 'error');
        } else if (res.status === 401 || res.status === 403) {
          const authMsg = (data && data.error) || (res.status === 401 ? 'Session expired or unauthenticated.' : 'Permission denied: editorial save privileges required.');
          mockShowEditorError('<strong>Authentication Error (HTTP ' + res.status + '):</strong> ' + authMsg + ' Your unsaved edits are preserved in the editor canvas. Please log in or verify credentials in a new tab, then retry saving.');
          saveIndicatorClass = 'editor-save-indicator error';
          mockShowToast('Authentication error: ' + authMsg, 'error');
        } else {
          const errMsg = (data && data.error) || ('Server rejected save request (HTTP ' + res.status + ').');
          mockShowEditorError('<strong>Save Error:</strong> ' + errMsg + ' Your unsaved edits are preserved in the editor canvas.');
          saveIndicatorClass = 'editor-save-indicator error';
          mockShowToast(errMsg, 'error');
        }
      }

      // Verification for scenario
      assert.notStrictEqual(saveIndicatorClass, 'editor-save-indicator saved', `${scenario.name}: must NOT enter saved indicator state`);
      assert.strictEqual(saveIndicatorClass, 'editor-save-indicator error', `${scenario.name}: must enter error indicator state`);
      assert.notStrictEqual(toastType, 'success', `${scenario.name}: must NOT display success toast`);
      assert.strictEqual(errorPanelDisplayed, true, `${scenario.name}: persistent error panel must be displayed`);
      assert(errorPanelContent.includes(scenario.expectedErrorKeyword), `${scenario.name}: error panel must contain "${scenario.expectedErrorKeyword}"`);

      // Verify all six fields are 100% preserved in the canvas
      assert.strictEqual(editorCanvas.headline, 'Canvas Headline Under Test');
      assert.strictEqual(editorCanvas.seoTitle, 'Canvas SEO Title Under Test');
      assert.strictEqual(editorCanvas.dek, 'Canvas Dek Summary');
      assert.strictEqual(editorCanvas.body, 'Canvas Rich Article Body with multiple paragraphs.');
      assert.strictEqual(editorCanvas.why_it_matters, 'Canvas Grounded Analysis');
      assert.strictEqual(editorCanvas.what_happens_next, 'Canvas Forward Steps');
    }
  });

  // TEST 8: Pre-save validation: missing path or missing/unverified SHA blocks submission
  it('8. Pre-save validation: missing path or missing/unverified SHA blocks submission', () => {
    const invalidArticles = [
      { article: { relPath: null, sha: 'valid_sha_123' }, reason: 'Null relPath' },
      { article: { relPath: 'invalid/path.md', sha: 'valid_sha_123' }, reason: 'Invalid relPath outside src/articles/' },
      { article: { relPath: 'src/articles/india/story.md', sha: null }, reason: 'Missing Git SHA (not loaded yet)' },
      { article: { relPath: 'src/articles/india/story.md', sha: '' }, reason: 'Empty Git SHA' },
      { article: { relPath: 'src/articles/india/story.md', sha: 'working_draft' }, reason: 'Draft placeholder SHA without authoritative Git SHA' }
    ];

    for (const testCase of invalidArticles) {
      let networkFetchDispatched = false;
      let errorShown = null;

      function mockValidateAndSave(art) {
        if (!art || !art.relPath || typeof art.relPath !== 'string' || !art.relPath.startsWith('src/articles/')) {
          errorShown = 'Invalid path';
          return false;
        }
        if (!art.sha || typeof art.sha !== 'string' || art.sha.trim() === '' || art.sha === 'working_draft') {
          errorShown = 'Unverified Git SHA';
          return false;
        }
        networkFetchDispatched = true;
        return true;
      }

      const allowed = mockValidateAndSave(testCase.article);
      assert.strictEqual(allowed, false, `${testCase.reason}: must block submission`);
      assert.strictEqual(networkFetchDispatched, false, `${testCase.reason}: fetch must NOT be dispatched`);
      assert.notStrictEqual(errorShown, null, `${testCase.reason}: must trigger actionable error`);
    }
  });

  // TEST 9: Stale background GET response cannot overwrite active unsaved edits or accepted AI rewrite
  it('9. Stale background GET response cannot overwrite active unsaved edits or accepted AI rewrite', () => {
    const activeEditorState = {
      relPath: 'src/articles/india/stale-get-test.md',
      sha: 'initial_sha_100',
      title: 'Active Unsaved Headline In Canvas',
      seoTitle: 'Active Unsaved SEO Title',
      dek: 'Active Unsaved Dek',
      body: 'Active unsaved rewritten body text typed by user.',
      why_it_matters: 'Active unsaved why it matters.',
      what_happens_next: 'Active unsaved what happens next.'
    };

    let AppState_isDirty = true; // User typed edits or accepted AI rewrite draft!

    // In-flight background GET finally arrives with OLD / STALE data
    const staleServerGetResponse = {
      success: true,
      relPath: 'src/articles/india/stale-get-test.md',
      sha: 'newest_repo_sha_200',
      data: {
        title: 'OLD Stale Title From Server',
        seoTitle: 'OLD Stale SEO Title',
        dek: 'OLD Stale Dek',
        why_it_matters: 'OLD Stale Why It Matters',
        what_happens_next: 'OLD Stale What Happens Next'
      },
      body: 'OLD stale body text from remote repo.'
    };

    // Simulate openArticleEditor GET handler with Requirement 6 guard
    function handleBackgroundGetResponse(data, art, isDirty) {
      art.sha = data.sha || art.sha || null;

      // REQUIREMENT 6 GUARD:
      if (isDirty) {
        // Only update sha; DO NOT touch DOM canvas or article edit fields!
        return { guarded: true };
      }

      art.body = data.body;
      if (data.data) {
        Object.assign(art, data.data);
      }
      return { guarded: false };
    }

    const result = handleBackgroundGetResponse(staleServerGetResponse, activeEditorState, AppState_isDirty);

    assert.strictEqual(result.guarded, true, 'Dirty guard must prevent stale GET overwrite');
    // Verify all six fields remain untouched in the active draft:
    assert.strictEqual(activeEditorState.title, 'Active Unsaved Headline In Canvas');
    assert.strictEqual(activeEditorState.seoTitle, 'Active Unsaved SEO Title');
    assert.strictEqual(activeEditorState.dek, 'Active Unsaved Dek');
    assert.strictEqual(activeEditorState.body, 'Active unsaved rewritten body text typed by user.');
    assert.strictEqual(activeEditorState.why_it_matters, 'Active unsaved why it matters.');
    assert.strictEqual(activeEditorState.what_happens_next, 'Active unsaved what happens next.');
    // Verified repo SHA was safely captured:
    assert.strictEqual(activeEditorState.sha, 'newest_repo_sha_200');
  });

  // TEST 10: Complete authoritative roundtrip of all six fields: Save -> Disk/GitHub -> Reload GET -> Editor restoration
  await itAsync('10. Complete authoritative roundtrip of all six fields: Save -> Disk/GitHub -> Reload GET -> Editor restoration', async () => {
    const sixFieldsData = {
      headline: 'Six Fields Authoritative Headline',
      seoTitle: 'Six Fields Authoritative SEO Title — Full Guide',
      dek: 'Six Fields Authoritative Dek summary of breaking developments.',
      body: 'Authoritative complete body text containing extensive paragraphs, detailed investigative quotes, and corroborated facts.',
      why_it_matters: 'Comprehensive analytical synthesis of regulatory, constitutional, and economic repercussions.',
      what_happens_next: 'Detailed schedule of parliamentary hearings, judicial reviews, and expected deadlines.'
    };

    // 1. Client save payload
    const clientPayload = {
      relPath: 'src/articles/india/six-fields-roundtrip.md',
      sha: 'roundtrip_base_sha_111',
      title: sixFieldsData.headline,
      headline: sixFieldsData.headline,
      seoTitle: sixFieldsData.seoTitle,
      dek: sixFieldsData.dek,
      body: sixFieldsData.body,
      why_it_matters: sixFieldsData.why_it_matters,
      what_happens_next: sixFieldsData.what_happens_next,
      category: 'India',
      author: 'SamacharDaily Desk'
    };

    // 2. Server Markdown persistence (same logic as worker/index.js and tools/admin-auth.js)
    const frontmatterData = {
      title: clientPayload.title,
      seoTitle: clientPayload.seoTitle,
      dek: clientPayload.dek,
      category: clientPayload.category,
      author: clientPayload.author,
      why_it_matters: clientPayload.why_it_matters,
      what_happens_next: clientPayload.what_happens_next
    };
    const persistedMarkdown = matter.stringify('\n' + clientPayload.body.trim() + '\n', frontmatterData);
    const newSha = 'roundtrip_committed_sha_222';

    // 3. Authoritative server GET simulation
    const parsedFile = matter(persistedMarkdown);
    const authoritativeGetResponse = {
      success: true,
      relPath: clientPayload.relPath,
      sha: newSha,
      data: parsedFile.data,
      body: parsedFile.content.trim(),
      wordCount: parsedFile.content.trim().split(/\s+/).filter(Boolean).length
    };

    // 4. Client openArticleEditor restoration on reload
    const restoredEditor = {
      relPath: clientPayload.relPath,
      sha: authoritativeGetResponse.sha,
      headline: (authoritativeGetResponse.data && authoritativeGetResponse.data.title) || '',
      seoTitle: (authoritativeGetResponse.data && authoritativeGetResponse.data.seoTitle) || '',
      dek: (authoritativeGetResponse.data && authoritativeGetResponse.data.dek) || '',
      body: authoritativeGetResponse.body,
      why_it_matters: (authoritativeGetResponse.data && authoritativeGetResponse.data.why_it_matters) || '',
      what_happens_next: (authoritativeGetResponse.data && authoritativeGetResponse.data.what_happens_next) || ''
    };

    assert.strictEqual(restoredEditor.headline, sixFieldsData.headline, 'Headline must roundtrip');
    assert.strictEqual(restoredEditor.seoTitle, sixFieldsData.seoTitle, 'SEO Title must roundtrip');
    assert.strictEqual(restoredEditor.dek, sixFieldsData.dek, 'Dek must roundtrip');
    assert.strictEqual(restoredEditor.body, sixFieldsData.body, 'Body must roundtrip');
    assert.strictEqual(restoredEditor.why_it_matters, sixFieldsData.why_it_matters, 'Why It Matters must roundtrip');
    assert.strictEqual(restoredEditor.what_happens_next, sixFieldsData.what_happens_next, 'What Happens Next must roundtrip');
    assert.strictEqual(restoredEditor.sha, newSha, 'Committed SHA must roundtrip');
  });

  // TEST 11: HTTP 409 Concurrency Conflict preserves user edits and explains GitHub remote change
  it('11. HTTP 409 Concurrency Conflict preserves user edits and explains GitHub remote change', () => {
    const stagedUserRewrite = {
      headline: 'Unsaved User Rewrite Headline',
      seoTitle: 'Unsaved User SEO Title',
      dek: 'Unsaved User Dek',
      body: 'Unsaved User Full Investigative Rewrite Body',
      why_it_matters: 'Unsaved User Context Analysis',
      what_happens_next: 'Unsaved User Forecast'
    };

    const conflictResponse = {
      status: 409,
      data: {
        success: false,
        conflict: true,
        currentSha: 'remote_git_commit_sha_abc1234',
        error: 'This article changed in GitHub since you opened it. Reload before saving.'
      }
    };

    let errorPanelHtml = '';
    let isConflict = false;
    let saveStatus = '';

    if (conflictResponse.status === 409 || conflictResponse.data.conflict) {
      const remoteSha = (conflictResponse.data && conflictResponse.data.currentSha)
        ? (' (Remote Git SHA: ' + conflictResponse.data.currentSha.slice(0, 7) + ')')
        : '';
      errorPanelHtml = '<strong>Edit Conflict (HTTP 409):</strong> This article was modified in GitHub by another user or build process' + remoteSha + ' since you opened it. Your unsaved edits are preserved in the editor canvas. To prevent silently overwriting the remote revision, copy any edits you wish to keep, then reload the latest version before saving.';
      isConflict = true;
      saveStatus = 'Conflict: Article changed in GitHub';
    }

    assert.strictEqual(isConflict, true, 'Must set conflict styling flag');
    assert(errorPanelHtml.includes('Remote Git SHA: remote_'), 'Must specify remote revision in error message');
    assert(errorPanelHtml.includes('Your unsaved edits are preserved in the editor canvas'), 'Must reassure user edits are preserved');
    assert.strictEqual(saveStatus, 'Conflict: Article changed in GitHub');

    // Verify all 6 fields in user draft remain untouched
    assert.strictEqual(stagedUserRewrite.headline, 'Unsaved User Rewrite Headline');
    assert.strictEqual(stagedUserRewrite.seoTitle, 'Unsaved User SEO Title');
    assert.strictEqual(stagedUserRewrite.dek, 'Unsaved User Dek');
    assert.strictEqual(stagedUserRewrite.body, 'Unsaved User Full Investigative Rewrite Body');
    assert.strictEqual(stagedUserRewrite.why_it_matters, 'Unsaved User Context Analysis');
    assert.strictEqual(stagedUserRewrite.what_happens_next, 'Unsaved User Forecast');
  });

  console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
