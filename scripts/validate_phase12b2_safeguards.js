const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const codeGsPath = path.join(rootDir, 'Code.gs');

function validatePhase12B2() {
  console.log('--- VALIDATING PHASE 12B-2 SAFEGUARDS ---');
  const codeContent = fs.readFileSync(codeGsPath, 'utf8');

  // 1. Verify required safety functions are present
  const requiredFunctions = [
    'rewriteWithGroq_',
    'rewriteWithGemini_',
    'rewriteWithOpenRouter_',
    'fetchFromNewsData_',
    'fetchFromCurrents_',
    'isNewsworthyEditorialContent_',
    'isArticleOutputEnglish_',
    'countCandidateSourceWords_',
    'isFingerprintDuplicate_',
    'buildMarkdown_',
    'publishToGitHub_',
    'isPressReleaseSpam_',
    'isLowSubstance_',
    'isCommercialRetailContent_',
    'isGamblingContent_',
    'isAstrologyContent_',
    'hasSearchQueryOrPromptLeak_'
  ];

  const missingFunctions = requiredFunctions.filter(fn => !codeContent.includes(`function ${fn}`) && !codeContent.includes(`${fn} =`));
  console.log(`Safety Functions Check: ${missingFunctions.length === 0 ? 'PASS' : 'FAIL (Missing: ' + missingFunctions.join(', ') + ')'}`);

  // 2. Verify new prompt safeguard phrases are present in systemPrompt
  const requiredPromptClauses = [
    'NATURAL VOCABULARY & CLICHÉ AVOIDANCE',
    'underscores the importance',
    'comes amid',
    'highlights the growing',
    'OPENING VARIETY',
    'SHORT-SOURCE DENSITY',
    'State specific actions and effects directly'
  ];

  const missingClauses = requiredPromptClauses.filter(clause => !codeContent.includes(clause));
  console.log(`Prompt Safeguard Ingestion Check: ${missingClauses.length === 0 ? 'PASS' : 'FAIL (Missing: ' + missingClauses.join(', ') + ')'}`);

  // 3. Contamination and Secret Exposure Checks
  const hasLocalhost = codeContent.includes('http://localhost') || codeContent.includes('http://127.0.0.1');
  const hasHardcodedKey = /GROQ_API_KEY\s*=\s*['"]gsk_[a-zA-Z0-9]+['"]/.test(codeContent);

  console.log(`Localhost URLs Check: ${!hasLocalhost ? 'PASS' : 'FAIL'}`);
  console.log(`Hardcoded Secrets Check: ${!hasHardcodedKey ? 'PASS' : 'FAIL'}`);

  // 4. Verify Fallback Consistency
  const geminiUsesSystemPrompt = codeContent.includes('rewriteWithGemini_(systemPrompt, userPrompt, config)');
  const openRouterUsesSystemPrompt = codeContent.includes('rewriteWithOpenRouter_(systemPrompt, userPrompt, config)');
  console.log(`Fallback Tier 2 (Gemini) Prompt Inheritance: ${geminiUsesSystemPrompt ? 'PASS' : 'FAIL'}`);
  console.log(`Fallback Tier 3 (OpenRouter) Prompt Inheritance: ${openRouterUsesSystemPrompt ? 'PASS' : 'FAIL'}`);

  const allPassed = missingFunctions.length === 0 && missingClauses.length === 0 && !hasLocalhost && !hasHardcodedKey && geminiUsesSystemPrompt && openRouterUsesSystemPrompt;
  console.log(`\nOVERALL VALIDATION: ${allPassed ? 'PASS (SAFE)' : 'FAIL'}`);
}

validatePhase12B2();
