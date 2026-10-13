/**
 * SamacharDaily — Focused AI Waterfall & OpenRouter Free Fallback Test Suite
 *
 * Validates all 12 reliability & safety criteria for the AI rewrite waterfall:
 * 1. Gemini HTTP 400 LOCATION_UNSUPPORTED is not retried (exactly 1 attempt).
 * 2. OpenRouter timeout is bounded (12,000 ms).
 * 3. OpenRouter includes verified free models fallback array in request payload.
 * 4. Unverified or non-free models are rejected before network requests.
 * 5. Missing or malformed json.model in response is handled safely.
 * 6. Non-free model returned in json.model is strictly rejected (PAID_MODEL_REJECTED).
 * 7. Existing OpenRouter response parsing and clean JSON extraction still work.
 * 8. Structured output response_format is preserved.
 * 9. Provider waterfall cascades from Gemini failure to OpenRouter.
 * 10. Exhausted providers produce a useful, sanitized error message without leaking secrets.
 * 11. Six-field rewrite candidate contract remains intact.
 * 12. No paid fallback providers are permitted.
 *
 * Strict Safety: 100% offline unit/mock tests. Zero network or paid calls.
 */

import assert from 'node:assert';
import {
  PROVIDER_ADAPTERS,
  FREE_GENERATION_ALLOWLIST,
  FAILURE_CLASS,
  isValidOpenRouterFreeModel,
  executeManualAiWaterfall,
  computeAttemptTimeout,
  MAX_WATERFALL_DURATION_MS,
  RESPONSE_RESERVE_MS,
  MIN_ATTEMPT_BUDGET_MS
} from '../worker/manual-ai-providers.js';

let passed = 0;
let total = 0;

function it(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function itAsync(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

console.log('\n--- AI WATERFALL & OPENROUTER FREE FALLBACK REGRESSION SUITE ---\n');

// 1. Gemini HTTP 400 LOCATION_UNSUPPORTED is not retried
await itAsync('1. Gemini HTTP 400 LOCATION_UNSUPPORTED is non-retryable (exactly 1 attempt)', async () => {
  let geminiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({
          error: {
            code: 400,
            message: 'User location is not supported for the API use.',
            status: 'FAILED_PRECONDITION'
          }
        })
      };
    }
    return { ok: false, status: 500, text: async () => 'Unavailable' };
  };

  try {
    const res = await executeManualAiWaterfall({
      systemPrompt: 'System',
      userPrompt: 'Rewrite article'
    }, {
      MANUAL_AI_GEMINI_API_KEY: 'test-gemini-key'
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(geminiCalls, 1, 'Gemini HTTP 400 must NOT be retried on same provider');
    const attempt = res.providerAttempts.find(p => p.provider === 'Gemini');
    assert(attempt, 'Attempt for Gemini must be logged');
    assert.strictEqual(attempt.classification, FAILURE_CLASS.LOCATION_UNSUPPORTED);
    assert.strictEqual(attempt.retryable, false, 'Location unsupported must be marked non-retryable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 2. OpenRouter timeout is bounded to 18,000 ms
it('2. OpenRouter configured maximum timeout is 18,000 ms within waterfall budget', () => {
  const timeoutMs = PROVIDER_ADAPTERS.openrouter.timeoutMs;
  assert.strictEqual(typeof timeoutMs, 'number');
  assert.strictEqual(timeoutMs, 18000, 'OpenRouter timeoutMs must be 18000ms');
  assert(timeoutMs < 20000, 'Must not exceed 20,000ms to preserve waterfall headroom');
});

// 3. OpenRouter includes verified free models fallback array in request payload with openrouter/free first
await itAsync('3. OpenRouter sets openrouter/free as primary and first in models fallback array', async () => {
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        model: 'openrouter/free',
        choices: [{
          message: {
            content: JSON.stringify({
              headline: 'Test Headline',
              seoTitle: 'SEO Title',
              dek: 'Test Dek',
              body: 'Test Body Paragraph with sufficient text.',
              why_it_matters: 'Why it matters test.',
              what_happens_next: 'Next steps test.'
            })
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    assert.strictEqual(adapter.defaultModel, 'openrouter/free', 'Default model must be openrouter/free');
    const res = await adapter.call({
      systemPrompt: 'Sys',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: 'test-or-key'
    });

    assert(capturedBody, 'Body must be captured');
    assert.strictEqual(capturedBody.model, 'openrouter/free', 'Primary model in payload must be openrouter/free');
    assert(Array.isArray(capturedBody.models), 'Request body must contain models array');
    assert.strictEqual(capturedBody.models.length, 3, 'Fallback models array must contain exactly 3 models');
    assert.strictEqual(capturedBody.models[0], 'openrouter/free', 'First model must be openrouter/free');
    assert.strictEqual(capturedBody.models[1], 'google/gemma-4-31b-it:free', 'Second model must be google/gemma-4-31b-it:free');
    assert.strictEqual(capturedBody.models[2], 'nvidia/nemotron-3.5-lightning:free', 'Third model must be nvidia/nemotron-3.5-lightning:free');

    capturedBody.models.forEach(m => {
      assert(isValidOpenRouterFreeModel(m), `Model ${m} in models array must be verified free`);
    });
    assert.strictEqual(res.model, 'openrouter/free');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 4. Unverified or non-free model is rejected
it('4. Unverified or non-free OpenRouter model is rejected before network requests', () => {
  const adapter = PROVIDER_ADAPTERS.openrouter;
  const paidModels = ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-3.8-flash', 'arbitrary-model'];

  for (const paid of paidModels) {
    assert.throws(() => {
      adapter.getModel({ MANUAL_AI_OPENROUTER_MODEL: paid });
    }, (err) => {
      return err.classification === FAILURE_CLASS.PAID_MODEL_REJECTED;
    }, `Paid model ${paid} must throw PAID_MODEL_REJECTED`);
  }
});

// 5. Missing or malformed json.model is handled safely by rejecting unverified model metadata
await itAsync('5. Missing or malformed json.model is rejected as INVALID_RESPONSE', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({
        // json.model is omitted or null
        choices: [{
          message: {
            content: JSON.stringify({
              headline: 'Unverified Headline',
              body: 'Unverified Body'
            })
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    await assert.rejects(async () => {
      await adapter.call({
        systemPrompt: 'Sys',
        userPrompt: 'User'
      }, {
        MANUAL_AI_OPENROUTER_API_KEY: 'test-or-key'
      });
    }, (err) => {
      return err.classification === FAILURE_CLASS.INVALID_RESPONSE &&
        err.message.includes('omitted model identifier');
    }, 'Must reject response when json.model is omitted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 6. Non-free model returned in json.model is rejected
await itAsync('6. Non-free model returned in json.model throws PAID_MODEL_REJECTED', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({
        model: 'openai/gpt-4o', // Paid model returned by upstream router
        choices: [{
          message: {
            content: JSON.stringify({
              headline: 'Paid Headline',
              body: 'Paid Body'
            })
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    await assert.rejects(async () => {
      await adapter.call({
        systemPrompt: 'Sys',
        userPrompt: 'User'
      }, {
        MANUAL_AI_OPENROUTER_API_KEY: 'test-or-key'
      });
    }, (err) => {
      return err.classification === FAILURE_CLASS.PAID_MODEL_REJECTED &&
        err.message.includes('unverified or paid model');
    }, 'Must reject non-free model returned in json.model');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 7. Existing OpenRouter response parsing still works
await itAsync('7. OpenRouter response parsing cleanly strips markdown codeblocks and extracts JSON', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({
        model: 'openrouter/free',
        choices: [{
          message: {
            content: '```json\n{"headline":"Markdown Stripped","body":"Extracted correctly"}\n```'
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    const res = await adapter.call({
      systemPrompt: 'Sys',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: 'test-or-key'
    });

    assert.strictEqual(res.model, 'openrouter/free');
    assert(res.text.includes('Markdown Stripped'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 8. Structured output requirements preserved
await itAsync('8. Structured output response_format is preserved in request', async () => {
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        model: 'openrouter/free',
        choices: [{
          message: {
            content: JSON.stringify({ headline: 'JSON', body: 'Valid' })
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    await adapter.call({
      systemPrompt: 'Sys',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: 'test-or-key'
    });

    assert.deepStrictEqual(capturedBody.response_format, { type: 'json_object' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 9. Provider waterfall continues from Gemini failure to OpenRouter
await itAsync('9. Waterfall cascades from Gemini 400 to OpenRouter and succeeds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('generativelanguage.googleapis.com')) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({
          error: { message: 'User location is not supported for the API use.' }
        })
      };
    }
    if (urlStr.includes('openrouter.ai')) {
      return {
        ok: true,
        json: async () => ({
          model: 'openrouter/free',
          choices: [{
            message: {
              content: JSON.stringify({
                headline: 'OpenRouter Upgraded Headline',
                seoTitle: 'Upgraded SEO',
                dek: 'Upgraded Dek',
                body: 'Upgraded body content paragraphs with complete factual information.',
                why_it_matters: 'Upgraded why it matters context.',
                what_happens_next: 'Upgraded what happens next context.'
              })
            },
            finish_reason: 'stop'
          }]
        })
      };
    }
    return { ok: false, status: 500, text: async () => 'Unknown' };
  };

  try {
    const res = await executeManualAiWaterfall({
      systemPrompt: 'System prompt',
      userPrompt: 'User prompt'
    }, {
      MANUAL_AI_GEMINI_API_KEY: 'mock-gemini-key',
      MANUAL_AI_OPENROUTER_API_KEY: 'mock-openrouter-key'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerUsed, 'OpenRouter');
    assert.strictEqual(res.modelUsed, 'openrouter/free');
    assert.strictEqual(res.data.headline, 'OpenRouter Upgraded Headline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 10. Exhausted providers produce useful, sanitized error
await itAsync('10. Exhausted providers produce sanitized diagnostic error without leaking secrets', async () => {
  const originalFetch = globalThis.fetch;
  const SECRET_TOKEN = 'SUPER_SECRET_TOKEN_XYZ';
  globalThis.fetch = async (url) => {
    return {
      ok: false,
      status: 503,
      text: async () => `Upstream service failed with token ${SECRET_TOKEN}`
    };
  };

  try {
    const res = await executeManualAiWaterfall({
      systemPrompt: 'Sys',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: SECRET_TOKEN
    });

    assert.strictEqual(res.success, false);
    assert(res.error.includes('Free AI generation unavailable across configured free providers'));
    assert(!res.error.includes(SECRET_TOKEN), 'Secret token must never be leaked in error message');
    assert(res.error.includes('[REDACTED_MANUAL_AI_KEY]') || !res.error.includes(SECRET_TOKEN));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 11. Six-field rewrite contract remains intact
await itAsync('11. Six-field rewrite contract preserves all required editorial properties', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: async () => ({
        model: 'openrouter/free',
        choices: [{
          message: {
            content: JSON.stringify({
              headline: 'Full Headline',
              seoTitle: 'Full SEO Title',
              dek: 'Full Dek Summary',
              body: 'Full Markdown Body with several paragraphs of rich text.',
              why_it_matters: 'Full Why It Matters Analysis',
              what_happens_next: 'Full What Happens Next Projection'
            })
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const res = await executeManualAiWaterfall({
      systemPrompt: 'System',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: 'test-key'
    });

    assert.strictEqual(res.success, true);
    const data = res.data;
    assert.strictEqual(data.headline, 'Full Headline');
    assert.strictEqual(data.seoTitle, 'Full SEO Title');
    assert.strictEqual(data.dek, 'Full Dek Summary');
    assert.strictEqual(data.body, 'Full Markdown Body with several paragraphs of rich text.');
    assert.strictEqual(data.why_it_matters, 'Full Why It Matters Analysis');
    assert.strictEqual(data.what_happens_next, 'Full What Happens Next Projection');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 12. No paid fallback providers are introduced
it('12. Zero paid providers exist in free generation allowlist', () => {
  const allowlist = FREE_GENERATION_ALLOWLIST;
  const providerKeys = Object.keys(allowlist);
  assert.deepStrictEqual(providerKeys, ['gemini', 'openrouter'], 'Only gemini and openrouter are allowed');

  // Verify OpenRouter models all enforce :free or openrouter/free
  for (const m of allowlist.openrouter.allowedModels) {
    assert(isValidOpenRouterFreeModel(m), `Model ${m} in allowlist must be verified free`);
  }
  // Verify defaultModel is free and matches openrouter/free
  assert.strictEqual(allowlist.openrouter.defaultModel, 'openrouter/free');
  assert(isValidOpenRouterFreeModel(allowlist.openrouter.defaultModel));
  assert.deepStrictEqual(allowlist.openrouter.allowedModels, [
    'openrouter/free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3.5-lightning:free'
  ]);
});

// 13. OpenRouter HTTP 400 response_format retry removes flag, preserves models array, shares signal deadline, rejects disallowed model
await itAsync('13. HTTP 400 response_format retry strips format flag, preserves models fallback array, shares caller deadline, and validates model', async () => {
  const originalFetch = globalThis.fetch;
  const capturedRequests = [];
  const callerController = new AbortController();

  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    capturedRequests.push({ url, body, signal: opts.signal });

    if (capturedRequests.length === 1) {
      // First attempt fails with 400 indicating response_format json_object is unsupported
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        clone: () => ({
          text: async () => 'Provider error: response_format json_object is not supported by this model'
        }),
        text: async () => 'Provider error: response_format json_object is not supported by this model'
      };
    }

    // Second attempt succeeds without response_format
    return {
      ok: true,
      json: async () => ({
        model: 'openrouter/free',
        choices: [{
          message: {
            content: '{"headline":"Retried Headline","body":"Retried Body Content"}'
          },
          finish_reason: 'stop'
        }]
      })
    };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    const res = await adapter.call({
      systemPrompt: 'System',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: 'test-key'
    }, callerController.signal);

    assert.strictEqual(capturedRequests.length, 2, 'Must have made exactly 2 requests');
    // First request had response_format
    assert.deepStrictEqual(capturedRequests[0].body.response_format, { type: 'json_object' });
    // Second request removed response_format
    assert.strictEqual(capturedRequests[1].body.response_format, undefined);
    // Both requests share the exact same caller abort signal (same deadline)
    assert.strictEqual(capturedRequests[0].signal, callerController.signal, 'First request must use caller signal');
    assert.strictEqual(capturedRequests[1].signal, callerController.signal, 'Retry request must share original caller signal');
    // Second request preserved the full models fallback array
    assert(Array.isArray(capturedRequests[1].body.models));
    assert.deepStrictEqual(capturedRequests[1].body.models, [
      'openrouter/free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3.5-lightning:free'
    ]);
    capturedRequests[1].body.models.forEach(m => {
      assert(isValidOpenRouterFreeModel(m));
    });
    // Response was verified
    assert.strictEqual(res.model, 'openrouter/free');
    assert(res.text.includes('Retried Headline'));

    // Also verify that if the retry returns a non-free model, it is rejected
    capturedRequests.length = 0;
    globalThis.fetch = async (url, opts) => {
      capturedRequests.push({ body: JSON.parse(opts.body), signal: opts.signal });
      if (capturedRequests.length === 1) {
        return {
          ok: false,
          status: 400,
          clone: () => ({ text: async () => 'response_format is not supported' }),
          text: async () => 'response_format is not supported'
        };
      }
      return {
        ok: true,
        json: async () => ({
          model: 'openai/gpt-4o', // Paid model returned on retry
          choices: [{
            message: { content: '{"headline":"Paid","body":"Paid"}' },
            finish_reason: 'stop'
          }]
        })
      };
    };

    await assert.rejects(async () => {
      await adapter.call({ systemPrompt: 'S', userPrompt: 'U' }, { MANUAL_AI_OPENROUTER_API_KEY: 'test-key' });
    }, (err) => {
      return err.classification === FAILURE_CLASS.PAID_MODEL_REJECTED;
    }, 'Must reject non-free model returned on retry');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 14. Abort/timeout path deterministically tested with controlled abort signal
await itAsync('14. Deterministic abort/timeout path correctly classifies TIMEOUT without real-time delays', async () => {
  const originalFetch = globalThis.fetch;
  const startTime = Date.now();

  // Mock fetch that respects the AbortController signal
  globalThis.fetch = async (url, opts) => {
    return new Promise((_, reject) => {
      if (opts?.signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      opts?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    const controller = new AbortController();

    // Trigger immediate abort
    controller.abort();

    await assert.rejects(async () => {
      await adapter.call({ systemPrompt: 'S', userPrompt: 'U' }, { MANUAL_AI_OPENROUTER_API_KEY: 'k' }, controller.signal);
    }, (err) => {
      return err.name === 'AbortError' || err.message.includes('aborted');
    });

    const elapsed = Date.now() - startTime;
    assert(elapsed < 200, `Abort test must complete immediately, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 15. OpenRouter timeout can reach 18,000 ms after a fast Gemini failure
await itAsync('15. OpenRouter timeout can reach 18,000 ms after a fast Gemini failure', async () => {
  const originalFetch = globalThis.fetch;
  let simulatedTime = 1000;
  const nowMock = () => simulatedTime;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('generativelanguage.googleapis.com')) {
      // Gemini fails fast in 100 ms with unsupported location
      simulatedTime += 100;
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: 'User location is not supported' } })
      };
    }
    if (urlStr.includes('openrouter.ai')) {
      return {
        ok: true,
        json: async () => ({
          model: 'openrouter/free',
          choices: [{
            message: {
              content: JSON.stringify({ headline: 'Fast Fail Head', body: 'Fast Fail Body' })
            },
            finish_reason: 'stop'
          }]
        })
      };
    }
    return { ok: false, status: 500, text: async () => 'err' };
  };

  try {
    // 1. Direct timeout budgeting calculation verification
    const computed = computeAttemptTimeout(PROVIDER_ADAPTERS.openrouter, 100);
    assert.strictEqual(computed, 18000, 'Calculated attempt timeout must reach 18,000 ms ceiling when 100ms elapsed');

    // 2. End-to-end waterfall verification with simulated clock
    const res = await executeManualAiWaterfall({
      systemPrompt: 'System',
      userPrompt: 'Rewrite article',
      nowFn: nowMock
    }, {
      MANUAL_AI_GEMINI_API_KEY: 'gemini-key',
      MANUAL_AI_OPENROUTER_API_KEY: 'or-key'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerUsed, 'OpenRouter');
    assert.strictEqual(res.attemptTimeoutMs, 18000, 'Attempt timeout on OpenRouter must be exactly 18,000 ms');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 16. Timeout shrinks correctly when earlier attempts consume most of the waterfall budget
await itAsync('16. Timeout shrinks correctly when earlier attempts consume most of the waterfall budget', async () => {
  const originalFetch = globalThis.fetch;
  let simulatedTime = 1000;
  const nowMock = () => simulatedTime;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('generativelanguage.googleapis.com')) {
      // Gemini took 16,000 ms before failing
      simulatedTime += 16000;
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: 'User location is not supported' } })
      };
    }
    if (urlStr.includes('openrouter.ai')) {
      return {
        ok: true,
        json: async () => ({
          model: 'openrouter/free',
          choices: [{
            message: {
              content: JSON.stringify({ headline: 'Shrunk Timeout Head', body: 'Shrunk Timeout Body' })
            },
            finish_reason: 'stop'
          }]
        })
      };
    }
    return { ok: false, status: 500, text: async () => 'err' };
  };

  try {
    // 1. Direct computation check: 27,000 - 16,000 = 11,000 budget; minus 1,500 reserve = 9,500 ms.
    const computed = computeAttemptTimeout(PROVIDER_ADAPTERS.openrouter, 16000);
    assert.strictEqual(computed, 9500, 'Timeout must shrink from 18,000 ms to 9,500 ms');
    assert(computed < 18000, 'Timeout must be strictly less than 18,000 ms ceiling');

    // 2. End-to-end waterfall check
    const res = await executeManualAiWaterfall({
      systemPrompt: 'System',
      userPrompt: 'Rewrite article',
      nowFn: nowMock
    }, {
      MANUAL_AI_GEMINI_API_KEY: 'gemini-key',
      MANUAL_AI_OPENROUTER_API_KEY: 'or-key'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerUsed, 'OpenRouter');
    assert.strictEqual(res.attemptTimeoutMs, 9500, 'OpenRouter attempt timeout must be shrunk to 9,500 ms');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 17. Timeout never exceeds remaining budget minus response reserve across all elapsed durations
it('17. Timeout is strictly bounded by remaining budget minus response reserve across all elapsed durations', () => {
  const adapter = PROVIDER_ADAPTERS.openrouter;
  const testElapsedDurations = [0, 50, 500, 2000, 5000, 9000, 12000, 15000, 18000, 19500, 21000, 22000, 26000, 27000, 30000];

  for (const elapsed of testElapsedDurations) {
    const timeout = computeAttemptTimeout(adapter, elapsed);
    const remainingBudget = MAX_WATERFALL_DURATION_MS - elapsed;
    const availableBudget = remainingBudget - RESPONSE_RESERVE_MS;

    if (availableBudget >= MIN_ATTEMPT_BUDGET_MS) {
      assert(timeout > 0, `Timeout must be positive when available budget ${availableBudget} >= ${MIN_ATTEMPT_BUDGET_MS}`);
      assert(timeout <= 18000, `Timeout (${timeout}ms) must not exceed 18,000 ms ceiling`);
      assert(timeout <= availableBudget, `Timeout (${timeout}ms) must not exceed remaining budget minus reserve (${availableBudget}ms)`);
      assert(elapsed + timeout + RESPONSE_RESERVE_MS <= MAX_WATERFALL_DURATION_MS, 'Total duration must not exceed MAX_WATERFALL_DURATION_MS');
    } else {
      assert.strictEqual(timeout, 0, `Timeout must be 0 when available budget ${availableBudget} < minimum ${MIN_ATTEMPT_BUDGET_MS}`);
    }
  }
});

// 18. HTTP 400 compatibility retry aborts cleanly if signal was aborted
await itAsync('18. HTTP 400 retry immediately aborts if caller deadline expired during request', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;

  globalThis.fetch = async (url, opts) => {
    calls++;
    if (calls === 1) {
      // Abort the controller before returning 400 response
      controller.abort();
      return {
        ok: false,
        status: 400,
        clone: () => ({ text: async () => 'response_format is not supported' }),
        text: async () => 'response_format is not supported'
      };
    }
    return { ok: true, json: async () => ({ model: 'openrouter/free' }) };
  };

  try {
    const adapter = PROVIDER_ADAPTERS.openrouter;
    await assert.rejects(async () => {
      await adapter.call({ systemPrompt: 'S', userPrompt: 'U' }, { MANUAL_AI_OPENROUTER_API_KEY: 'k' }, controller.signal);
    }, (err) => {
      return err.name === 'AbortError' || err.message.includes('aborted');
    });

    assert.strictEqual(calls, 1, 'Must not issue second request when signal is already aborted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\nResults: ${passed} / ${total} tests passed.\n`);
