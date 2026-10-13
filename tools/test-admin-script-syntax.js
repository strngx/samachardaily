/**
 * Samachar Daily — Admin Client-Side Script Syntax & Regression Test
 *
 * Verifies that the client-side JavaScript embedded in the compiled
 * Cloudflare Worker views (worker/admin-views.js) parses cleanly with
 * zero syntax errors, duplicate identifiers, or uncompiled template tags.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const ADMIN_VIEWS_FILE = path.join(ROOT_DIR, 'worker', 'admin-views.js');

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

console.log('\n--- ADMIN WORKER VIEWS SCRIPT SYNTAX VERIFICATION SUITE ---\n');

// 1. Verify worker/admin-views.js exists and exports editorialHtml
let editorialHtml = '';
it('1. worker/admin-views.js exists and exports non-empty editorialHtml', () => {
  assert(fs.existsSync(ADMIN_VIEWS_FILE), 'worker/admin-views.js not found');
  const viewsContent = fs.readFileSync(ADMIN_VIEWS_FILE, 'utf8');
  const match = viewsContent.match(/export const editorialHtml = ([\s\S]*?);\r?\n\r?\nexport const qualityIndexJson/);
  assert(match && match[1], 'Could not extract editorialHtml from worker/admin-views.js');
  editorialHtml = JSON.parse(match[1]);
  assert(editorialHtml.length > 100000, `editorialHtml is suspiciously small: ${editorialHtml.length}`);
});

// 2. Verify no raw Nunjucks template tags remain
it('2. Zero uncompiled Nunjucks template tags in editorialHtml', () => {
  const rawTags = editorialHtml.match(/\{[{%][\s\S]*?[%\}]\}/g) || [];
  assert.strictEqual(rawTags.length, 0, `Found uncompiled template tags: ${JSON.stringify(rawTags)}`);
});

// 3. Extract client-side script tag
let scriptContent = '';
it('3. Successfully extract main client-side <script> from editorialHtml', () => {
  const scriptMatch = editorialHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch && scriptMatch[1], 'Could not find <script> tag in editorialHtml');
  scriptContent = scriptMatch[1].trim();
  assert(scriptContent.length > 50000, `Client script length too small: ${scriptContent.length}`);
});

// 4. Node.js V8 Syntax Compilation Validation
it('4. Full client-side JavaScript parses cleanly without SyntaxError in V8', () => {
  try {
    new vm.Script(scriptContent, { filename: 'editorial-client-script.js' });
  } catch (err) {
    assert.fail(`Fatal parse error in client script: ${err.name} - ${err.message}`);
  }
});

// 5. Explicitly verify duplicate declarations are detected by the test mechanism
it('5. Verify that duplicate identifier declarations trigger compile-time SyntaxError', () => {
  assert.throws(
    () => {
      new vm.Script('const testDuplicate = 1; function testDuplicate() {}');
    },
    /SyntaxError: Identifier 'testDuplicate' has already been declared/,
    'VM compiler must detect duplicate identifier declarations'
  );
});

// 6. Regression check: clearSelectedAiUpgradeArticle has no duplicate declaration
it('6. Regression check: clearSelectedAiUpgradeArticle is not declared as duplicate const', () => {
  assert(!scriptContent.includes('const clearSelectedAiUpgradeArticle ='),
    'Found illegal "const clearSelectedAiUpgradeArticle =" declaration'
  );
  assert(scriptContent.includes('function clearSelectedAiUpgradeArticle()'),
    'Expected "function clearSelectedAiUpgradeArticle()" to be preserved'
  );
});

// 7. Verify critical global navigation functions exist in script
it('7. Critical newsroom symbols and navigation handlers exist', () => {
  const requiredSymbols = [
    'window.__CORPUS__',
    'function navigate(',
    'function populateOverviewStats()',
    'function clearAiStudioSession()',
    'function returnToEditor()',
    'function openArticleEditor('
  ];

  for (const sym of requiredSymbols) {
    assert(scriptContent.includes(sym), `Missing critical symbol in script: ${sym}`);
  }
});

console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
if (passedTests !== totalTests) {
  process.exit(1);
}
