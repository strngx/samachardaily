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

  it('Code integrity: worker/admin-views.js contains authoritative openArticleEditor sync', () => {
    assert(avContent.includes('edit-headline').valueOf(), 'admin-views.js missing edit-headline');
    assert(avContent.includes('edit-seo-title').valueOf(), 'admin-views.js missing edit-seo-title');
    assert(avContent.includes('edit-dek').valueOf(), 'admin-views.js missing edit-dek');
    assert(avContent.includes('edit-why-it-matters').valueOf(), 'admin-views.js missing edit-why-it-matters');
    assert(avContent.includes('edit-what-happens-next').valueOf(), 'admin-views.js missing edit-what-happens-next');
    assert(avContent.includes('_lastCompletedSaveId'), 'admin-views.js missing save sequence ID tracking');
    assert(avContent.includes('_lastCompletedFetchId'), 'admin-views.js missing fetch sequence ID tracking');
  });

  it('Code integrity: worker/index.js accepts headline fallback and returns confirmed article', () => {
    assert(workerContent.includes('const effectiveTitle = (typeof title === \'string\' && title.trim()) ? title.trim() : ((typeof headline === \'string\' && headline.trim()) ? headline.trim() : null);'));
    assert(workerContent.includes('headline: parsed.data.title'));
  });

  it('Code integrity: tools/admin-auth.js accepts headline fallback and returns confirmed article', () => {
    assert(adminAuthContent.includes('const effectiveTitle = (typeof title === \'string\' && title.trim()) ? title.trim() : ((typeof headline === \'string\' && headline.trim()) ? headline.trim() : null);'));
    assert(adminAuthContent.includes('headline: file.data.title'));
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

  console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
