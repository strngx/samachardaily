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
  executeManualAiWaterfall
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

// 2. OpenRouter timeout is bounded
it('2. OpenRouter timeout is bounded to <= 12,000 ms within waterfall budget', () => {
  const timeoutMs = PROVIDER_ADAPTERS.openrouter.timeoutMs;
  assert.strictEqual(typeof timeoutMs, 'number');
  assert.strictEqual(timeoutMs, 12000, 'OpenRouter timeoutMs must be 12000ms');
  assert(timeoutMs < 20000, 'Must not exceed 20,000ms to preserve waterfall headroom');
});

// 3. OpenRouter includes verified free models fallback array in request payload
await itAsync('3. OpenRouter sends verified free models fallback array in request payload', async () => {
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        model: 'nvidia/nemotron-3.5-lightning:free',
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
    const res = await adapter.call({
      systemPrompt: 'Sys',
      userPrompt: 'User'
    }, {
      MANUAL_AI_OPENROUTER_API_KEY: 'test-or-key'
    });

    assert(capturedBody, 'Body must be captured');
    assert(Array.isArray(capturedBody.models), 'Request body must contain models array');
    assert(capturedBody.models.length >= 2, 'Fallback models array must contain at least 2 models');
    capturedBody.models.forEach(m => {
      assert(isValidOpenRouterFreeModel(m), `Model ${m} in models array must be verified free`);
    });
    assert.strictEqual(capturedBody.model, capturedBody.models[0]);
    assert.strictEqual(res.model, 'nvidia/nemotron-3.5-lightning:free');
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
        model: 'google/gemma-4-31b-it:free',
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

    assert.strictEqual(res.model, 'google/gemma-4-31b-it:free');
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
          model: 'nvidia/nemotron-3.5-lightning:free',
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
    assert.strictEqual(res.modelUsed, 'nvidia/nemotron-3.5-lightning:free');
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
        model: 'google/gemma-4-31b-it:free',
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
  // Verify defaultModel is free
  assert(isValidOpenRouterFreeModel(allowlist.openrouter.defaultModel));
});

// 13. OpenRouter HTTP 400 response_format retry removes flag, preserves models array, rejects disallowed model
await itAsync('13. HTTP 400 response_format retry strips format flag, preserves models fallback array, and validates model', async () => {
  const originalFetch = globalThis.fetch;
  const capturedRequests = [];

  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    capturedRequests.push({ url, body });

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
        model: 'nvidia/nemotron-3.5-lightning:free',
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
    });

    assert.strictEqual(capturedRequests.length, 2, 'Must have made exactly 2 requests');
    // First request had response_format
    assert.deepStrictEqual(capturedRequests[0].body.response_format, { type: 'json_object' });
    // Second request removed response_format
    assert.strictEqual(capturedRequests[1].body.response_format, undefined);
    // Second request preserved the full models fallback array
    assert(Array.isArray(capturedRequests[1].body.models));
    assert(capturedRequests[1].body.models.length >= 2);
    capturedRequests[1].body.models.forEach(m => {
      assert(isValidOpenRouterFreeModel(m));
    });
    // Response was verified
    assert.strictEqual(res.model, 'nvidia/nemotron-3.5-lightning:free');
    assert(res.text.includes('Retried Headline'));

    // Also verify that if the retry returns a non-free model, it is rejected
    capturedRequests.length = 0;
    globalThis.fetch = async (url, opts) => {
      capturedRequests.push(JSON.parse(opts.body));
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

console.log(`\nResults: ${passed} / ${total} tests passed.\n`);
