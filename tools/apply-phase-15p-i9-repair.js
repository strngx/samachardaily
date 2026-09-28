/**
 * tools/apply-phase-15p-i9-repair.js
 * Surgical repair script for Phase 15P-I.9:
 * AI-Provider Reliability Repair (Groq 400 json_validate_failed empty, Gemini 429 quota, OpenRouter 429 & malformed prose)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const codeGsPath = path.join(__dirname, '..', 'Code.gs');
let rawCode = fs.readFileSync(codeGsPath, 'utf8');

const initialSha = crypto.createHash('sha256').update(rawCode).digest('hex');
console.log('Initial Code.gs SHA:', initialSha);

// Detect line endings
const isCrlf = rawCode.includes('\r\n');
const lineEnding = isCrlf ? '\r\n' : '\n';

// Normalize to LF for matching, then restore line endings if needed
let code = rawCode.replace(/\r\n/g, '\n');

// ----------------------------------------------------------------------------
// REPAIR 1: Groq 400 json_validate_failed with empty failed_generation
// ----------------------------------------------------------------------------
const targetGroq400 = `      // Handle Groq 400 json_validate_failed with simplified fallback retry
      if (statusCode === 400) {
        var respText = resp.getContentText();
        if (respText.indexOf('json_validate_failed') !== -1) {
          var retryMaxTokens = (evidenceDensity.tier === 'HIGH_DENSITY') ? 1900 : 1600;
          var fallbackSystemPrompt = systemPrompt + '\\nKeep all string values concise and ensure the JSON is complete and properly closed.';
          var retryPromptTokens = estimateGroqPromptTokens_(fallbackSystemPrompt, userPrompt);
          if ((retryPromptTokens + retryMaxTokens) <= GROQ_SAFETY_CEILING && canReserveGroqTpd_(retryPromptTokens, retryMaxTokens) && getRemainingWaterfallBudgetMs_() > MIN_FALLBACK_BUDGET_MS) {
            Logger.log('AI_PROVIDER_RETRY provider=Groq reason=400_json_validate_failed max_tokens=' + retryMaxTokens);
            var fallbackPayload = {
              model: 'openai/gpt-oss-120b',
              messages: [
                { role: 'system', content: fallbackSystemPrompt },
                { role: 'user', content: userPrompt }
              ],
              response_format: { type: 'json_object' },
              temperature: 0.2,
              max_tokens: retryMaxTokens
            };
            var fallbackOptions = {
              method: 'post',
              contentType: 'application/json',
              headers: {
                'Authorization': 'Bearer ' + config.GROQ_API_KEY
              },
              payload: JSON.stringify(fallbackPayload),
              muteHttpExceptions: true
            };
            var groq400RetryStart = Date.now();
            resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', fallbackOptions);
            statusCode = resp.getResponseCode();
            Logger.log('AI_PROVIDER_ELAPSED provider=Groq_Retry400 elapsed=' + (Date.now() - groq400RetryStart) + 'ms status=' + statusCode);
          } else {
            Logger.log('Groq TPD or size budget insufficient for 400 json_validate_failed retry. Skipping retry and falling back to Tier 2 (Gemini)...');
          }
        }
      }`;

const replacementGroq400 = `      // Handle Groq 400 json_validate_failed with simplified fallback retry
      if (statusCode === 400) {
        var respText = resp.getContentText();
        if (respText.indexOf('json_validate_failed') !== -1) {
          // Check if failed_generation is empty or unavailable
          var isEmptyFailedGen = false;
          try {
            var errJson = JSON.parse(respText);
            var fg = (errJson.error && errJson.error.failed_generation !== undefined) ? errJson.error.failed_generation : null;
            if (fg === '' || fg === null) {
              isEmptyFailedGen = true;
            }
          } catch (e) {
            if (/["']failed_generation["']\\s*:\\s*["']\\s*["']/i.test(respText)) {
              isEmptyFailedGen = true;
            }
          }

          if (isEmptyFailedGen) {
            Logger.log('AI_PROVIDER_FAILURE provider=Groq failureClass=MODEL_JSON_INVALID reason=400_json_validate_failed_empty action=SKIP_PROVIDER');
            Logger.log('[AI_TELEMETRY] candidate="' + ((headline && headline.title) || 'candidate') + '" provider=Groq failureClass=MODEL_JSON_INVALID action=SKIP_PROVIDER');
            isGroq429 = true;
            groqError = new Error('Groq API error (400 json_validate_failed with empty failed_generation): ' + respText);
            groqError.failureClass = 'MODEL_JSON_INVALID';
            // Do NOT perform duplicate retry for empty failed_generation; continue to next tier
          } else {
            var retryMaxTokens = (evidenceDensity.tier === 'HIGH_DENSITY') ? 1900 : 1600;
            var fallbackSystemPrompt = systemPrompt + '\\nKeep all string values concise and ensure the JSON is complete and properly closed.';
            var retryPromptTokens = estimateGroqPromptTokens_(fallbackSystemPrompt, userPrompt);
            if ((retryPromptTokens + retryMaxTokens) <= GROQ_SAFETY_CEILING && canReserveGroqTpd_(retryPromptTokens, retryMaxTokens) && getRemainingWaterfallBudgetMs_() > MIN_FALLBACK_BUDGET_MS) {
              Logger.log('AI_PROVIDER_RETRY provider=Groq reason=400_json_validate_failed max_tokens=' + retryMaxTokens);
              var fallbackPayload = {
                model: 'openai/gpt-oss-120b',
                messages: [
                  { role: 'system', content: fallbackSystemPrompt },
                  { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: retryMaxTokens
              };
              var fallbackOptions = {
                method: 'post',
                contentType: 'application/json',
                headers: {
                  'Authorization': 'Bearer ' + config.GROQ_API_KEY
                },
                payload: JSON.stringify(fallbackPayload),
                muteHttpExceptions: true
              };
              var groq400RetryStart = Date.now();
              resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', fallbackOptions);
              statusCode = resp.getResponseCode();
              Logger.log('AI_PROVIDER_ELAPSED provider=Groq_Retry400 elapsed=' + (Date.now() - groq400RetryStart) + 'ms status=' + statusCode);
            } else {
              Logger.log('Groq TPD or size budget insufficient for 400 json_validate_failed retry. Skipping retry and falling back to Tier 2 (Gemini)...');
            }
          }
        }
      }`;

if (!code.includes(targetGroq400)) {
  console.error('ERROR: Could not find targetGroq400 in Code.gs');
  process.exit(1);
}
code = code.replace(targetGroq400, replacementGroq400);
console.log('REPAIR 1 APPLIED: Groq 400 empty json_validate_failed suppression.');

// ----------------------------------------------------------------------------
// REPAIR 2: Gemini 429 Quota Exhaustion
// ----------------------------------------------------------------------------
const targetGemini = `  var resp = UrlFetchApp.fetch(url, options);
  var statusCode = resp.getResponseCode();
  if (statusCode !== 200) {
    var err = new Error('Gemini API error (' + statusCode + '): ' + resp.getContentText());
    err.failureClass = (statusCode === 503 || statusCode === 429 || statusCode >= 500) ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE';
    err.statusCode = statusCode;
    throw err;
  }`;

const replacementGemini = `  var resp = UrlFetchApp.fetch(url, options);
  var statusCode = resp.getResponseCode();
  if (statusCode !== 200) {
    var respBody = resp.getContentText();
    var err = new Error('Gemini API error (' + statusCode + '): ' + respBody);
    var isDailyQuota = (statusCode === 429) && (
      respBody.indexOf('GenerateRequestsPerDay') !== -1 ||
      respBody.indexOf('RESOURCE_EXHAUSTED') !== -1 ||
      respBody.indexOf('FreeTier') !== -1 ||
      respBody.indexOf('quota') !== -1
    );
    if (isDailyQuota) {
      err.failureClass = 'QUOTA_EXHAUSTED';
      err.isDailyQuota = true;
    } else {
      err.failureClass = (statusCode === 429) ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
    }
    err.statusCode = statusCode;
    throw err;
  }`;

if (!code.includes(targetGemini)) {
  console.error('ERROR: Could not find targetGemini in Code.gs');
  process.exit(1);
}
code = code.replace(targetGemini, replacementGemini);
console.log('REPAIR 2 APPLIED: Gemini Quota Exhaustion classification.');

// ----------------------------------------------------------------------------
// REPAIR 3 & 4: OpenRouter 429 Upstream Rate Limit & Non-JSON Prose Pre-validation
// ----------------------------------------------------------------------------
const targetOpenRouter = `    var resp = UrlFetchApp.fetch(url, options);
    var statusCode = resp.getResponseCode();
    if (statusCode === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        var text = data.choices[0].message.content;
        return parseArticleJson_(text);
      }
    } else {
      Logger.log('OpenRouter model ' + modelName + ' returned HTTP ' + statusCode + ': ' + resp.getContentText());
      lastError = new Error('OpenRouter API error (' + statusCode + ' with ' + modelName + '): ' + resp.getContentText());
      lastError.failureClass = (statusCode === 429 || statusCode >= 500) ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE';
      lastError.statusCode = statusCode;
    }`;

const replacementOpenRouter = `    var resp = UrlFetchApp.fetch(url, options);
    var statusCode = resp.getResponseCode();
    if (statusCode === 200) {
      var respBody = resp.getContentText();
      var data = null;
      try {
        data = JSON.parse(respBody);
      } catch (jsonErr) {
        lastError = new Error('Malformed JSON payload from OpenRouter API: ' + jsonErr.message);
        lastError.failureClass = 'MODEL_JSON_INVALID';
        continue;
      }
      if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        var text = data.choices[0].message.content;
        // Pre-validate textual content contains a JSON object before passing to parseArticleJson_
        var trimmed = text.trim();
        if (trimmed.startsWith('\`\`\`')) {
          trimmed = trimmed.replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/i, '').trim();
        }
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
          Logger.log('OpenRouter model ' + modelName + ' returned non-JSON prose: ' + trimmed.substring(0, 100));
          lastError = new Error('OpenRouter returned prose instead of JSON object: ' + trimmed.substring(0, 80));
          lastError.failureClass = 'MODEL_JSON_INVALID';
          continue;
        }
        try {
          return parseArticleJson_(text);
        } catch (parseErr) {
          lastError = parseErr;
          if (!lastError.failureClass) {
            lastError.failureClass = 'MODEL_JSON_INVALID';
          }
          continue;
        }
      } else {
        lastError = new Error('OpenRouter response missing choices content.');
        lastError.failureClass = 'MODEL_OUTPUT_INVALID';
      }
    } else {
      var respBody = resp.getContentText();
      Logger.log('OpenRouter model ' + modelName + ' returned HTTP ' + statusCode + ': ' + respBody);
      lastError = new Error('OpenRouter API error (' + statusCode + ' with ' + modelName + '): ' + respBody);
      lastError.statusCode = statusCode;
      if (statusCode === 429) {
        var isUpstreamRateLimit = respBody.indexOf('temporarily rate-limited upstream') !== -1 ||
                                  respBody.indexOf('upstream_provider_shared_pool') !== -1;
        if (isUpstreamRateLimit) {
          lastError.failureClass = 'RATE_LIMITED';
          Logger.log('AI_PROVIDER_FAILURE provider=OpenRouter failureClass=RATE_LIMITED reason=upstream_rate_limited action=SKIP_PROVIDER');
          // Terminate OpenRouter model retry loop immediately for upstream pool rate limiting
          break;
        } else {
          lastError.failureClass = 'PROVIDER_UNAVAILABLE';
        }
      } else {
        lastError.failureClass = (statusCode >= 500) ? 'PROVIDER_UNAVAILABLE' : 'MODEL_OUTPUT_INVALID';
      }
    }`;

if (!code.includes(targetOpenRouter)) {
  console.error('ERROR: Could not find targetOpenRouter in Code.gs');
  process.exit(1);
}
code = code.replace(targetOpenRouter, replacementOpenRouter);
console.log('REPAIR 3 & 4 APPLIED: OpenRouter 429 Upstream Rate Limit & Prose Pre-validation.');

// ----------------------------------------------------------------------------
// REPAIR 5 & 7: Waterfall Cascading, Telemetry & Safe Abort
// ----------------------------------------------------------------------------
const targetWaterfall = `    try {
      Logger.log('AI_PROVIDER_ATTEMPT provider=Gemini');
      var geminiStart = Date.now();
      var geminiArticle = rewriteWithGemini_(systemPrompt, userPrompt, config);
      Logger.log('AI_PROVIDER_ELAPSED provider=Gemini elapsed=' + (Date.now() - geminiStart) + 'ms');
      Logger.log('Generated via: Gemini (Groq fallback)');
      return geminiArticle;
    } catch (geminiErr) {
      Logger.log('FALLBACK VALIDATION: Gemini fallback failed: ' + geminiErr.message + '. Tier 3 fallback: OpenRouter...');

      var remainingForOpenRouter = getRemainingWaterfallBudgetMs_();
      Logger.log('AI_WATERFALL_REMAINING_BUDGET: remaining=' + remainingForOpenRouter + 'ms');
      if (remainingForOpenRouter < MIN_FALLBACK_BUDGET_MS) {
        Logger.log('AI_WATERFALL_TERMINATED: Execution budget exhausted (' + remainingForOpenRouter + 'ms remaining). Skipping OpenRouter fallback.');
        var timeoutErr2 = new Error('AI execution time budget exhausted before OpenRouter fallback.');
        timeoutErr2.failureClass = 'PROVIDER_UNAVAILABLE';
        throw timeoutErr2;
      }

      try {
        Logger.log('AI_PROVIDER_ATTEMPT provider=OpenRouter');
        var openRouterStart = Date.now();
        var openRouterArticle = rewriteWithOpenRouter_(systemPrompt, userPrompt, config);
        Logger.log('AI_PROVIDER_ELAPSED provider=OpenRouter elapsed=' + (Date.now() - openRouterStart) + 'ms');
        Logger.log('Generated via: OpenRouter (double fallback)');
        return openRouterArticle;
      } catch (openRouterErr) {
        Logger.log('AI_WATERFALL_TERMINATED: All 3 AI tiers (Groq, Gemini, OpenRouter) failed.');
        var allTiersErr = new Error('Groq failure: ' + (groqError ? groqError.message : 'N/A') + ' | Gemini error: ' + geminiErr.message + ' | OpenRouter error: ' + openRouterErr.message);
        allTiersErr.failureClass = 'PROVIDER_UNAVAILABLE';
        throw allTiersErr;
      }
    }`;

const replacementWaterfall = `    try {
      Logger.log('AI_PROVIDER_ATTEMPT provider=Gemini');
      var geminiStart = Date.now();
      var geminiArticle = rewriteWithGemini_(systemPrompt, userPrompt, config);
      Logger.log('AI_PROVIDER_ELAPSED provider=Gemini elapsed=' + (Date.now() - geminiStart) + 'ms');
      Logger.log('Generated via: Gemini (Groq fallback)');
      return geminiArticle;
    } catch (geminiErr) {
      var geminiClass = geminiErr.failureClass || 'PROVIDER_UNAVAILABLE';
      Logger.log('AI_PROVIDER_FAILURE provider=Gemini failureClass=' + geminiClass + ' action=SKIP_PROVIDER reason="' + geminiErr.message + '"');
      Logger.log('[AI_TELEMETRY] candidate="' + ((headline && headline.title) || 'candidate') + '" provider=Gemini failureClass=' + geminiClass + ' action=SKIP_PROVIDER');
      Logger.log('FALLBACK VALIDATION: Gemini fallback failed: ' + geminiErr.message + '. Tier 3 fallback: OpenRouter...');

      var remainingForOpenRouter = getRemainingWaterfallBudgetMs_();
      Logger.log('AI_WATERFALL_REMAINING_BUDGET: remaining=' + remainingForOpenRouter + 'ms');
      if (remainingForOpenRouter < MIN_FALLBACK_BUDGET_MS) {
        Logger.log('AI_WATERFALL_TERMINATED: Execution budget exhausted (' + remainingForOpenRouter + 'ms remaining). Skipping OpenRouter fallback.');
        var timeoutErr2 = new Error('AI execution time budget exhausted before OpenRouter fallback.');
        timeoutErr2.failureClass = 'PROVIDER_UNAVAILABLE';
        throw timeoutErr2;
      }

      try {
        Logger.log('AI_PROVIDER_ATTEMPT provider=OpenRouter');
        var openRouterStart = Date.now();
        var openRouterArticle = rewriteWithOpenRouter_(systemPrompt, userPrompt, config);
        Logger.log('AI_PROVIDER_ELAPSED provider=OpenRouter elapsed=' + (Date.now() - openRouterStart) + 'ms');
        Logger.log('Generated via: OpenRouter (double fallback)');
        return openRouterArticle;
      } catch (openRouterErr) {
        var openRouterClass = openRouterErr.failureClass || 'PROVIDER_UNAVAILABLE';
        Logger.log('AI_PROVIDER_FAILURE provider=OpenRouter failureClass=' + openRouterClass + ' action=ABORT_PUBLICATION reason="' + openRouterErr.message + '"');
        Logger.log('[AI_TELEMETRY] candidate="' + ((headline && headline.title) || 'candidate') + '" provider=OpenRouter failureClass=' + openRouterClass + ' action=ABORT_PUBLICATION');
        Logger.log('AI_WATERFALL_TERMINATED: All 3 AI tiers (Groq, Gemini, OpenRouter) failed.');
        var allTiersErr = new Error('Groq failure: ' + (groqError ? groqError.message : 'N/A') + ' | Gemini error: ' + geminiErr.message + ' | OpenRouter error: ' + openRouterErr.message);
        allTiersErr.failureClass = 'PROVIDER_UNAVAILABLE';
        allTiersErr.lastTierFailureClass = openRouterClass;
        throw allTiersErr;
      }
    }`;

if (!code.includes(targetWaterfall)) {
  console.error('ERROR: Could not find targetWaterfall in Code.gs');
  process.exit(1);
}
code = code.replace(targetWaterfall, replacementWaterfall);
console.log('REPAIR 5 & 7 APPLIED: Waterfall Telemetry and Error Propagation.');

// Restore original line endings
if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(codeGsPath, code, 'utf8');

const finalSha = crypto.createHash('sha256').update(code).digest('hex');
console.log('Final Code.gs SHA:', finalSha);
console.log('ALL PHASE 15P-I.9 REPAIRS APPLIED SUCCESSFULLY.');
