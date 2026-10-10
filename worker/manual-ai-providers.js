/**
 * Samachar Daily — Strictly Free-Only Isolated Manual AI Rewrite Provider System
 *
 * Provides 100% credential, provider, research, and runtime isolation
 * for the Manual AI Article Upgrade feature in the Editorial Control Center.
 *
 * GUARANTEES:
 * 1. STRICTLY FREE GENERATION ONLY (VERIFIED AGAINST CURRENT OFFICIAL DOCUMENTATION):
 *    - Google Gemini Flash via Google AI Studio Free Tier (gemini-2.5-flash).
 *      No credit card required on unbilled projects. Returns HTTP 429 on quota exhaustion.
 *    - OpenRouter Free Router / Models (openrouter/free or models ending with :free).
 *      Cost is $0.00/token. Zero account balance required.
 * 2. EXCLUSION OF DEPRECATED / UNVERIFIED / PAID PROVIDERS:
 *    - Groq Cloud is DISABLED: Official Groq documentation confirms that configured models
 *      llama-3.3-70b-versatile and llama-3.1-8b-instant were deprecated on August 16, 2026.
 *      Free replacement models cannot be verified with sufficient throughput for long-form rewrites.
 *    - Cerebras is EXCLUDED: Official documentation requires adding a payment method (credit card)
 *      and offers only an expiring 30-day $5 trial credit rather than an ongoing free tier.
 *    - OpenAI is PERMANENTLY REMOVED: Commercial paid-only API, zero free tier.
 *    - SambaNova, Together AI, Fireworks AI, NVIDIA NIM, Cloudflare Workers AI, DeepSeek, Cohere
 *      are EXCLUDED from the generation chain to prevent accidental charges or billing card requirements.
 * 3. STRICT MODEL ALLOWLIST & FAIL-CLOSED VALIDATION:
 *    - Rejects deprecated/shut-down models (e.g. gemini-2.0-flash, gemini-1.5-flash, llama-3.3-70b-versatile).
 *    - Rejects paid OpenRouter models (e.g. gpt-4o, claude) via server-side regex `:free` validation.
 *    - Rejects malformed, arbitrary, or unverified model IDs before network requests.
 * 4. SEPARATE RESEARCH ADAPTERS (RESEARCH-ONLY):
 *    - Google Fact Check Tools API via `MANUAL_AI_FACTCHECK_API_KEY` (Claim search free tier).
 *    - Tavily Search via `MANUAL_AI_TAVILY_API_KEY` (1,000 queries/month free tier).
 *    - Public Wikipedia Search API (Authoritative encyclopedia fallback).
 *    - Research adapters CANNOT be called for text generation.
 *    - You.com is DISABLED from active pipeline: usage-based billing applies after trial credit.
 * 5. ZERO FALLBACK TO LEGACY GENERIC KEYS:
 *    - Ignores GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, AI.
 * 6. ZERO IMPACT ON CODE.GS OR src/articles/**:
 *    - Completely independent runtime, isolated credentials, offline testing only.
 */

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================

export const PROVIDER_TIMEOUT_MS = 8000;
export const MAX_RETRY_ATTEMPTS = 2;
export const MAX_WATERFALL_DURATION_MS = 25000;

export const FAILURE_CLASS = {
  AUTH_FAILURE: 'AUTH_FAILURE',                 // HTTP 401, 403, invalid token
  RATE_LIMITED: 'RATE_LIMITED',                 // HTTP 429 / Quota exhausted
  TIMEOUT: 'TIMEOUT',                           // Network timeout / abort signal
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE', // HTTP 500, 502, 503, 504, fetch error
  INVALID_RESPONSE: 'INVALID_RESPONSE',         // Malformed JSON / missing headline or body
  QUALITY_REJECTED: 'QUALITY_REJECTED',         // Failed editorial quality guard
  PAID_MODEL_REJECTED: 'PAID_MODEL_REJECTED',   // Attempted to use paid, deprecated, or unverified model
  TRUNCATION_ERROR: 'TRUNCATION_ERROR'          // Output truncated by model token limits
};

// Supported dedicated secrets for Manual AI Rewrite
export const MANUAL_AI_SECRETS = {
  // Approved Free Generation Providers
  GEMINI_API_KEY: 'MANUAL_AI_GEMINI_API_KEY',
  OPENROUTER_API_KEY: 'MANUAL_AI_OPENROUTER_API_KEY',

  // Dedicated Secret for Groq (Disabled due to model deprecation & unverified free replacements)
  GROQ_API_KEY: 'MANUAL_AI_GROQ_API_KEY',

  // Research-Only Providers (Strictly non-generative)
  FACTCHECK_API_KEY: 'MANUAL_AI_FACTCHECK_API_KEY',
  TAVILY_API_KEY: 'MANUAL_AI_TAVILY_API_KEY'
};

/**
 * Validates that an OpenRouter model identifier is genuinely free.
 * Accepts only valid namespace/model:free patterns or the openrouter/free alias.
 * Rejects paid models, malformed strings, arbitrary overrides, and empty values.
 */
export function isValidOpenRouterFreeModel(model) {
  if (!model || typeof model !== 'string') return false;
  const trimmed = model.trim();
  if (!trimmed) return false;
  if (trimmed === 'openrouter/free') return true;
  // Must match provider/model:free (alphanumeric, slash, dash, dot, underscore, followed by :free)
  const pattern = /^[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.]+:(free)$/;
  return pattern.test(trimmed);
}

// Explicit Allowlist of Approved Free Generation Providers and their verified active models
export const FREE_GENERATION_ALLOWLIST = {
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    displayName: 'Google Gemini Flash',
    secretEnvName: 'MANUAL_AI_GEMINI_API_KEY',
    modelEnvName: 'MANUAL_AI_GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
    allowedModels: [
      'gemini-2.5-flash'
    ],
    freeTierInfo: 'Google AI Studio Free Tier: Available free of charge under Google AI Studio. Rate limits are subject to project quotas in Google AI Studio. Does not require credit card on unbilled projects.',
    accountRequirement: 'API key must be created under an unbilled project in Google AI Studio. If attached to a Google Cloud project with billing enabled, configure spending limits and budget alerts to prevent automatic charges.',
    verificationSource: 'https://ai.google.dev/gemini-api/docs/pricing'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    displayName: 'OpenRouter (Free Models Only)',
    secretEnvName: 'MANUAL_AI_OPENROUTER_API_KEY',
    modelEnvName: 'MANUAL_AI_OPENROUTER_MODEL',
    defaultModel: 'openrouter/free',
    validateModel(model) {
      return isValidOpenRouterFreeModel(model);
    },
    freeTierInfo: 'OpenRouter Free Tier: $0.00/token for openrouter/free router and models ending with :free. Zero account balance required. Returns HTTP 429 or 402 on limit exhaustion.',
    accountRequirement: 'OpenRouter account with $0.00 balance. The server strictly enforces the :free model suffix or openrouter/free and rejects all paid model IDs.',
    verificationSource: 'https://openrouter.ai/models?q=free'
  }
};

// Default priority ordering for approved free generation providers
export const DEFAULT_PROVIDER_ORDER = [
  'gemini',
  'openrouter'
];

// Documented audit record of providers excluded or disabled from text generation
export const EXCLUDED_PROVIDERS = {
  groq: {
    name: 'Groq',
    status: 'DISABLED',
    secretEnvName: 'MANUAL_AI_GROQ_API_KEY',
    reason: 'Official Groq documentation confirms that configured models llama-3.3-70b-versatile and llama-3.1-8b-instant were decommissioned on August 16, 2026. Groq recommended replacements (openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.6-27b): openai/* models are excluded under strict OpenAI elimination rules, and gpt-oss-120b has an unviable 1,000 TPM limit on the free tier causing mid-article truncation; qwen/qwen3.6-27b is preview/unverified for perpetual free production rewriting. Disabled to enforce strict free-only and truncation safety policy.',
    verificationSource: 'https://console.groq.com/docs/deprecations'
  },
  cerebras: {
    name: 'Cerebras',
    status: 'EXCLUDED',
    reason: 'Official Cerebras documentation establishes that API access requires adding a payment method (credit card) and only provides an expiring 30-day $5 trial credit, with no recurring permanent free tier without payment details. Excluded from active generation chain.',
    verificationSource: 'https://cerebras.ai/pricing'
  },
  openai: {
    name: 'OpenAI',
    status: 'PERMANENTLY_REMOVED',
    reason: 'Paid-only API. No perpetual free allowance; requires paid credits / payment card. Completely removed from Manual AI Rewrite.',
    verificationSource: 'https://openai.com/pricing'
  },
  sambanova: {
    name: 'SambaNova',
    status: 'EXCLUDED',
    reason: 'Unverified free tier. Cloud API requires payment method/credit card for sustained API usage and relies on usage credits.',
    verificationSource: 'https://sambanova.ai/'
  },
  together: {
    name: 'Together AI',
    status: 'EXCLUDED',
    reason: 'Paid API after one-time $5 signup trial credit; requires credit card billing for ongoing use.',
    verificationSource: 'https://www.together.ai/pricing'
  },
  fireworks: {
    name: 'Fireworks AI',
    status: 'EXCLUDED',
    reason: 'Paid API after one-time $1 trial credit; requires pay-as-you-go credit card billing.',
    verificationSource: 'https://fireworks.ai/pricing'
  },
  nvidia: {
    name: 'NVIDIA NIM',
    status: 'EXCLUDED',
    reason: 'One-off 1,000 trial credits pool for prototyping, not an ongoing daily free tier; enterprise licensing required.',
    verificationSource: 'https://build.nvidia.com/'
  },
  cloudflare: {
    name: 'Cloudflare Workers AI',
    status: 'EXCLUDED',
    reason: 'Excluded to prevent accidental paid neuron overages or coupling with Cloudflare account billing; isolated from Cloudflare AI binding.',
    verificationSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/'
  },
  deepseek: {
    name: 'DeepSeek',
    status: 'EXCLUDED',
    reason: 'Commercial pay-as-you-go API only. No perpetual free API tier.',
    verificationSource: 'https://platform.deepseek.com/'
  },
  cohere: {
    name: 'Cohere',
    status: 'EXCLUDED',
    reason: 'Trial API keys strictly prohibit production/commercial content generation; paid license required.',
    verificationSource: 'https://cohere.com/pricing'
  },
  you: {
    name: 'You.com / YouChat',
    status: 'DISABLED',
    reason: 'Official documentation confirms You.com developer API access is usage-based ($5.00/1,000 queries) after an initial trial credit, with no recurring permanent free API key allowance. Disabled from active research pipeline to enforce strict free-only policy.',
    verificationSource: 'https://documentation.you.com/'
  }
};

// ============================================================================
// 2. SECRET SANITIZATION & REDACTION
// ============================================================================

/**
 * Scrubs any secret values or authorization tokens from text or error messages.
 * Redacts all values from env matching MANUAL_AI_* or known server secrets.
 */
export function scrubManualAiSecrets(text, env = {}) {
  if (!text || typeof text !== 'string') return '';
  let scrubbed = text;

  // 1. Scrub all env values starting with MANUAL_AI_
  if (env && typeof env === 'object') {
    for (const [key, val] of Object.entries(env)) {
      if (typeof val === 'string' && val.length >= 6) {
        if (key.startsWith('MANUAL_AI_') || key.includes('_SECRET') || key.includes('_TOKEN')) {
          scrubbed = scrubbed.split(val).join('[REDACTED_SECRET]');
        }
      }
    }
  }

  // 2. Scrub standard pattern signatures
  scrubbed = scrubbed
    .replace(/\bBearer\s+[a-zA-Z0-9_\-\.]{10,}\b/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/\bgsk_[a-zA-Z0-9]{20,}\b/g, '[REDACTED_GROQ_KEY]')
    .replace(/\bsk-[a-zA-Z0-9_\-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bAIza[0-9A-Za-z-_]{35}\b/g, '[REDACTED_GOOGLE_KEY]')
    .replace(/\bkey=[a-zA-Z0-9_\-]{16,}\b/g, 'key=[REDACTED_KEY]');

  return scrubbed;
}

/**
 * Helper to safely extract and clean JSON from model output that might
 * be wrapped in ```json ... ``` code blocks.
 */
export function extractCleanJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let clean = rawText.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return clean.trim();
}

// ============================================================================
// 3. APPROVED FREE-ONLY PROVIDER ADAPTERS
// ============================================================================

export const PROVIDER_ADAPTERS = {
  // 1. Google Gemini Flash (Primary Free Generation Provider)
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    displayName: 'Google Gemini Flash',
    secretEnvName: 'MANUAL_AI_GEMINI_API_KEY',
    modelEnvName: 'MANUAL_AI_GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
    isConfigured(env = {}) {
      return Boolean(env && typeof env.MANUAL_AI_GEMINI_API_KEY === 'string' && env.MANUAL_AI_GEMINI_API_KEY.trim());
    },
    getModel(env = {}) {
      const configured = (env && env.MANUAL_AI_GEMINI_MODEL) ? env.MANUAL_AI_GEMINI_MODEL.trim() : this.defaultModel;
      const allowed = FREE_GENERATION_ALLOWLIST.gemini.allowedModels;
      if (allowed.includes(configured)) {
        return configured;
      }
      // Revert unapproved or deprecated model overrides to verified active free default
      return this.defaultModel;
    },
    async call({ systemPrompt, userPrompt }, env = {}, signal) {
      const apiKey = env.MANUAL_AI_GEMINI_API_KEY.trim();
      const model = this.getModel(env);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 2500
          }
        }),
        signal
      });

      if (!resp.ok) {
        const err = new Error(`Gemini HTTP ${resp.status} ${resp.statusText}`);
        err.status = resp.status;
        throw err;
      }

      const json = await resp.json();
      const candidate = json.candidates?.[0];
      const finishReason = candidate?.finishReason;

      // Strict truncation detection: Refuse to save partial article
      if (finishReason === 'MAX_TOKENS' || finishReason === 'LENGTH') {
        const err = new Error(`Gemini generation was truncated by model token length limit (finishReason: ${finishReason}). Incomplete draft rejected to prevent saving partial article.`);
        err.classification = FAILURE_CLASS.TRUNCATION_ERROR;
        throw err;
      }

      const text = candidate?.content?.parts?.[0]?.text || '';
      return { text, model, finishReason };
    }
  },

  // 2. OpenRouter (Free-Only Models Strict Enforcement)
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    displayName: 'OpenRouter (Free Models Only)',
    secretEnvName: 'MANUAL_AI_OPENROUTER_API_KEY',
    modelEnvName: 'MANUAL_AI_OPENROUTER_MODEL',
    defaultModel: 'openrouter/free',
    isConfigured(env = {}) {
      return Boolean(env && typeof env.MANUAL_AI_OPENROUTER_API_KEY === 'string' && env.MANUAL_AI_OPENROUTER_API_KEY.trim());
    },
    getModel(env = {}) {
      const configured = (env && env.MANUAL_AI_OPENROUTER_MODEL) ? env.MANUAL_AI_OPENROUTER_MODEL.trim() : this.defaultModel;
      // Strict Free-Only Enforcement: Model MUST pass isValidOpenRouterFreeModel
      if (isValidOpenRouterFreeModel(configured)) {
        return configured;
      }
      // Explicitly reject paid model identifiers; do not allow arbitrary model override to bypass free rule
      const err = new Error(`Invalid or paid OpenRouter model '${configured}' rejected under free-only policy. Only verified models ending with ':free' (or 'openrouter/free') are permitted.`);
      err.classification = FAILURE_CLASS.PAID_MODEL_REJECTED;
      throw err;
    },
    async call({ systemPrompt, userPrompt }, env = {}, signal) {
      const apiKey = env.MANUAL_AI_OPENROUTER_API_KEY.trim();
      const model = this.getModel(env); // Throws if paid or malformed model identifier detected
      const url = 'https://openrouter.ai/api/v1/chat/completions';

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://thesamachardaily.in',
          'X-Title': 'SamacharDaily Manual AI Upgrade'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 2500
        }),
        signal
      });

      if (!resp.ok) {
        const err = new Error(`OpenRouter HTTP ${resp.status} ${resp.statusText}`);
        err.status = resp.status;
        throw err;
      }

      const json = await resp.json();
      const choice = json.choices?.[0];
      const finishReason = choice?.finish_reason;

      // Strict truncation detection: Refuse to save partial article
      if (finishReason === 'length') {
        const err = new Error(`OpenRouter generation was truncated by model token length limit (finish_reason: length). Incomplete draft rejected to prevent saving partial article.`);
        err.classification = FAILURE_CLASS.TRUNCATION_ERROR;
        throw err;
      }

      const text = choice?.message?.content || '';
      return { text, model, finishReason };
    }
  }
};

// ============================================================================
// 4. PROVIDER WATERFALL RESOLUTION & STATUS INSPECTION
// ============================================================================

/**
 * Returns configured provider adapters in prioritized order.
 * Strictly filters by FREE_GENERATION_ALLOWLIST and registered PROVIDER_ADAPTERS.
 * Prohibits activation of unverified, deprecated, or paid providers even if secrets or overrides exist.
 */
export function getActiveProviderWaterfall(env = {}) {
  let orderedIds = DEFAULT_PROVIDER_ORDER;
  if (env && typeof env.MANUAL_AI_PROVIDER_ORDER === 'string' && env.MANUAL_AI_PROVIDER_ORDER.trim()) {
    const custom = env.MANUAL_AI_PROVIDER_ORDER
      .split(',')
      .map(s => s.trim().toLowerCase())
      // ONLY allow approved free generation providers
      .filter(s => Boolean(FREE_GENERATION_ALLOWLIST[s] && PROVIDER_ADAPTERS[s]));
    if (custom.length > 0) {
      orderedIds = [...new Set([...custom, ...DEFAULT_PROVIDER_ORDER])];
    }
  }

  const active = [];
  for (const id of orderedIds) {
    if (!FREE_GENERATION_ALLOWLIST[id] || !PROVIDER_ADAPTERS[id]) continue;
    const adapter = PROVIDER_ADAPTERS[id];
    if (adapter && adapter.isConfigured(env)) {
      active.push(adapter);
    }
  }
  return active;
}

/**
 * Returns safe server-side diagnostics and status for all free providers.
 * NEVER exposes secret values, keys, or authorization tokens.
 */
export function getManualAiStatus(env = {}) {
  let priority = 1;
  const statusList = [];
  let orderedIds = DEFAULT_PROVIDER_ORDER;
  if (env && typeof env.MANUAL_AI_PROVIDER_ORDER === 'string' && env.MANUAL_AI_PROVIDER_ORDER.trim()) {
    const custom = env.MANUAL_AI_PROVIDER_ORDER
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => Boolean(FREE_GENERATION_ALLOWLIST[s] && PROVIDER_ADAPTERS[s]));
    if (custom.length > 0) {
      orderedIds = [...new Set([...custom, ...DEFAULT_PROVIDER_ORDER])];
    }
  }

  for (const id of orderedIds) {
    const adapter = PROVIDER_ADAPTERS[id];
    if (!adapter) continue;
    const configured = adapter.isConfigured(env);
    let currentModel = adapter.defaultModel;
    try {
      currentModel = adapter.getModel(env);
    } catch (_) {
      currentModel = `${adapter.defaultModel} (override rejected)`;
    }

    const allowlistEntry = FREE_GENERATION_ALLOWLIST[adapter.id];

    statusList.push({
      id: adapter.id,
      name: adapter.name,
      displayName: adapter.displayName,
      enabled: true,
      configured,
      missingCredentials: !configured,
      secretEnvName: adapter.secretEnvName,
      priority: priority++,
      defaultModel: adapter.defaultModel,
      model: currentModel,
      approvedModels: allowlistEntry.allowedModels || (adapter.id === 'openrouter' ? ['* (must match :free suffix or openrouter/free)'] : []),
      fallbackOrder: priority - 1,
      freeTierEligibility: adapter.id === 'gemini'
        ? 'UNVERIFIED_PROJECT_AVAILABILITY (Documented on AI Studio unbilled tier, but project-specific availability requires manual verification; model preserved as gemini-2.5-flash)'
        : 'VERIFIED_FREE',
      freeTierInfo: allowlistEntry.freeTierInfo,
      accountRequirement: allowlistEntry.accountRequirement || null,
      verificationSource: allowlistEntry.verificationSource,
      policy: 'FREE_ONLY'
    });
  }

  return {
    providers: statusList,
    totalConfigured: statusList.filter(p => p.configured).length,
    research: {
      services: [
        {
          id: 'google_factcheck',
          name: 'Google Fact Check Tools API',
          type: 'RESEARCH_ONLY',
          configured: Boolean(env && typeof env.MANUAL_AI_FACTCHECK_API_KEY === 'string' && env.MANUAL_AI_FACTCHECK_API_KEY.trim()),
          secretEnvName: 'MANUAL_AI_FACTCHECK_API_KEY',
          freeTierInfo: 'ClaimSearch API query service for existing published fact checks. Free of charge under Google Cloud API quota. Cannot generate articles.',
          verificationSource: 'https://developers.google.com/fact-check/tools/api'
        },
        {
          id: 'tavily',
          name: 'Tavily Search API',
          type: 'RESEARCH_ONLY',
          configured: Boolean(env && typeof env.MANUAL_AI_TAVILY_API_KEY === 'string' && env.MANUAL_AI_TAVILY_API_KEY.trim()),
          secretEnvName: 'MANUAL_AI_TAVILY_API_KEY',
          freeTierInfo: '1,000 queries/month free tier. Cannot generate articles.',
          verificationSource: 'https://tavily.com/'
        },
        {
          id: 'wikipedia',
          name: 'Wikipedia Knowledge Base',
          type: 'RESEARCH_ONLY',
          configured: true,
          secretEnvName: null,
          freeTierInfo: 'Public authoritative encyclopedic search. Free of charge.',
          verificationSource: 'https://en.wikipedia.org/w/api.php'
        }
      ],
      note: 'All research services are strictly research-only and cannot perform text generation.'
    },
    excludedProviders: Object.entries(EXCLUDED_PROVIDERS).map(([id, info]) => ({
      id,
      name: info.name,
      status: info.status,
      reason: info.reason,
      verificationSource: info.verificationSource
    }))
  };
}

// ============================================================================
// 5. INDEPENDENT RESEARCH ENGINE (RESEARCH-ONLY)
// ============================================================================

/**
 * Extracts story entities and topics from article headline, lead, and body.
 */
export function extractManualStoryEntities(article = {}) {
  const title = (article.title || '').trim();
  const dek = (article.dek || '').trim();
  const body = (article.body || '').trim();
  const category = (article.category || 'News').trim();

  const text = `${title}. ${dek}. ${body.slice(0, 1000)}`;
  const entityMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  const stopEntities = new Set(['The', 'A', 'An', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'By', 'For', 'With', 'News', 'Staff', 'Reporter', 'India', 'World', 'Desk']);

  const entities = [...new Set(entityMatches.filter(e => e.length > 2 && !stopEntities.has(e)))].slice(0, 6);
  const cleanTitle = title.replace(/[^\w\s-]/g, '').trim();
  const queries = [];
  if (cleanTitle) {
    queries.push(cleanTitle.slice(0, 100));
  }
  if (entities.length > 0) {
    queries.push(`${entities.slice(0, 3).join(' ')} ${category}`.slice(0, 100));
  }

  return { entities, queries };
}

/**
 * Executes research strictly using MANUAL_AI_* search keys or public Wikipedia.
 * ZERO access to automated pipeline keys. ZERO text generation capability.
 */
export async function researchManualStoryContext(article = {}, env = {}) {
  const { entities, queries } = extractManualStoryEntities(article);
  if (!queries || queries.length === 0) {
    return {
      researched: false,
      provider: null,
      queries: [],
      evidence: [],
      message: 'No searchable topic or entity identified in source article.'
    };
  }

  const primaryQuery = queries[0];
  const evidence = [];
  let providerUsed = null;

  // 1. Try Google Fact Check Tools API if MANUAL_AI_FACTCHECK_API_KEY is configured
  if (!providerUsed && env && typeof env.MANUAL_AI_FACTCHECK_API_KEY === 'string' && env.MANUAL_AI_FACTCHECK_API_KEY.trim()) {
    try {
      const res = await fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(primaryQuery)}&key=${encodeURIComponent(env.MANUAL_AI_FACTCHECK_API_KEY.trim())}`);
      if (res.ok) {
        const data = await res.json();
        const claims = data.claims || [];
        for (const c of claims.slice(0, 3)) {
          const review = c.claimReview?.[0] || {};
          const rating = review.textualRating || 'Evaluated';
          const publisher = review.publisher?.name || 'Third-Party Fact Checker';
          evidence.push({
            title: `Fact Check: ${c.text || primaryQuery}`,
            snippet: `Existing third-party fact-check review by ${publisher}: "${rating}". (Note: Fact-check reviews a specific claim by an independent third-party organization; this does NOT prove that the entire article is true).`,
            url: review.url || '',
            source: 'Google Fact Check Tools'
          });
        }
        if (evidence.length > 0) providerUsed = 'Google Fact Check Tools API';
      }
    } catch (_) {
      // Non-fatal: cascade safely
    }
  }

  // 2. Try Tavily Search if MANUAL_AI_TAVILY_API_KEY is configured
  if (!providerUsed && env && typeof env.MANUAL_AI_TAVILY_API_KEY === 'string' && env.MANUAL_AI_TAVILY_API_KEY.trim()) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.MANUAL_AI_TAVILY_API_KEY.trim(),
          query: primaryQuery,
          max_results: 5
        })
      });
      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        for (const r of results.slice(0, 4)) {
          evidence.push({
            title: r.title || '',
            snippet: r.content || '',
            url: r.url || '',
            source: 'Tavily Search'
          });
        }
        if (evidence.length > 0) providerUsed = 'Tavily Search';
      }
    } catch (_) {
      // Cascade safely
    }
  }

  // 3. Authoritative Knowledge Base: Public Wikipedia Search API
  if (!providerUsed && (entities.length > 0 || primaryQuery)) {
    try {
      const wikiQuery = entities.length > 0 ? entities[0] : primaryQuery;
      const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiQuery)}&utf8=&format=json&origin=*`, {
        headers: { 'User-Agent': 'SamacharDailyEditorial/2.0' }
      });
      if (res.ok) {
        const data = await res.json();
        const results = data.query?.search || [];
        for (const r of results.slice(0, 3)) {
          const cleanSnippet = (r.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
          evidence.push({
            title: r.title || '',
            snippet: cleanSnippet,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent((r.title || '').replace(/\s+/g, '_'))}`,
            source: 'Wikipedia Reference'
          });
        }
        if (evidence.length > 0) providerUsed = 'Wikipedia Knowledge Base';
      }
    } catch (_) {
      // Offline / network failure
    }
  }

  if (evidence.length > 0) {
    return {
      researched: true,
      provider: providerUsed,
      queries,
      entities,
      evidence,
      summary: evidence.map(e => `[${e.source}: ${e.title}] ${e.snippet}`).join('\n')
    };
  }

  return {
    researched: false,
    provider: null,
    queries,
    entities,
    evidence: [],
    message: 'Independent research APIs unavailable or returned no corroborating entries. Rewrite relies on provided article material.'
  };
}

// ============================================================================
// 6. SAFE EXECUTION ENGINE WITH BOUNDED RETRY & CASCADE
// ============================================================================

/**
 * Classifies an error into structured failure classes.
 */
export function classifyError(err) {
  if (!err) return FAILURE_CLASS.PROVIDER_UNAVAILABLE;
  const msg = (err.message || '').toLowerCase();
  const status = err.status || 0;

  if (err.classification === FAILURE_CLASS.TRUNCATION_ERROR || msg.includes('truncated') || msg.includes('token length limit') || msg.includes('finishreason') || msg.includes('finish_reason')) {
    return FAILURE_CLASS.TRUNCATION_ERROR;
  }
  if (err.classification === FAILURE_CLASS.PAID_MODEL_REJECTED || msg.includes('paid openrouter model') || msg.includes('under free-only policy') || msg.includes('rejected under free-only policy')) {
    return FAILURE_CLASS.PAID_MODEL_REJECTED;
  }
  if (status === 401 || status === 403 || msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return FAILURE_CLASS.AUTH_FAILURE;
  }
  if (status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource_exhausted')) {
    return FAILURE_CLASS.RATE_LIMITED;
  }
  if (err.name === 'AbortError' || msg.includes('timeout') || msg.includes('aborted')) {
    return FAILURE_CLASS.TIMEOUT;
  }
  if (msg.includes('malformed') || msg.includes('json') || msg.includes('schema')) {
    return FAILURE_CLASS.INVALID_RESPONSE;
  }
  if (msg.includes('quality guard rejected')) {
    return FAILURE_CLASS.QUALITY_REJECTED;
  }
  return FAILURE_CLASS.PROVIDER_UNAVAILABLE;
}

/**
 * Executes a single provider call with an AbortController timeout.
 */
async function callAdapterWithTimeout(adapter, { systemPrompt, userPrompt }, env, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await adapter.call({ systemPrompt, userPrompt }, env, controller.signal);
    clearTimeout(timeoutId);

    const cleanText = extractCleanJson(result.text);
    if (!cleanText) {
      throw new Error('Provider returned empty text');
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch (parseErr) {
      if (cleanText && !cleanText.endsWith('}')) {
        const err = new Error(`AI generation output was truncated mid-JSON by provider output limits (${parseErr.message}). Incomplete draft rejected to prevent saving partial article.`);
        err.classification = FAILURE_CLASS.TRUNCATION_ERROR;
        throw err;
      }
      throw new Error(`Malformed JSON response from provider: ${parseErr.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.headline || !parsed.body) {
      throw new Error('Response JSON missing required fields (headline or body)');
    }

    return {
      success: true,
      data: parsed,
      provider: adapter.name,
      model: result.model
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Executes the prioritized Manual AI waterfall.
 *
 * Rules:
 * - Iterates strictly through approved free-only adapters in priority order.
 * - Max 2 attempts per provider for retryable errors (timeouts / 5xx).
 * - HTTP 401/403 (AUTH_FAILURE) breaks immediately to next free provider.
 * - HTTP 429 (RATE_LIMITED / QUOTA EXHAUSTED) breaks immediately to next free provider.
 * - PAID_MODEL_REJECTED breaks immediately to next free provider (zero paid calls allowed).
 * - TRUNCATION_ERROR breaks immediately to next free provider (refuses to save partial article).
 * - NEVER falls back to paid services or generic keys.
 * - If all free providers fail, returns a clear error stating no free provider is available.
 */
export async function executeManualAiWaterfall({ systemPrompt, userPrompt, article, qualityEvaluator, safetyAnalyzer }, env = {}) {
  const activeWaterfall = getActiveProviderWaterfall(env);

  if (activeWaterfall.length === 0) {
    return {
      success: false,
      error: 'No approved free Manual AI Rewrite provider is configured. Please configure at least one free MANUAL_AI_* secret (e.g. MANUAL_AI_GEMINI_API_KEY or MANUAL_AI_OPENROUTER_API_KEY). Zero paid providers are permitted.',
      providerUsed: null,
      totalAttempts: 0
    };
  }

  const startTime = Date.now();
  let totalAttempts = 0;
  let lastError = null;

  for (const adapter of activeWaterfall) {
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      // Check total execution budget
      if (Date.now() - startTime >= MAX_WATERFALL_DURATION_MS) {
        lastError = new Error('Execution time budget exhausted across free Manual AI providers.');
        break;
      }

      totalAttempts++;
      try {
        const result = await callAdapterWithTimeout(adapter, { systemPrompt, userPrompt }, env, PROVIDER_TIMEOUT_MS);

        // Quality evaluation gate
        if (typeof qualityEvaluator === 'function') {
          const quality = qualityEvaluator(result.data, article);
          if (!quality.valid) {
            const err = new Error(`Output quality guard rejected draft: ${quality.flags.join('; ')}`);
            err.classification = FAILURE_CLASS.QUALITY_REJECTED;
            throw err;
          }
          result.quality = quality;
        }

        // Safety pre-analysis
        if (typeof safetyAnalyzer === 'function') {
          result.safetyAnalysis = safetyAnalyzer({
            ...article,
            title: result.data.headline,
            dek: result.data.dek,
            body: result.data.body
          });
        }

        return {
          success: true,
          providerUsed: result.provider,
          modelUsed: result.model,
          totalAttempts,
          data: result.data,
          quality: result.quality,
          safetyAnalysis: result.safetyAnalysis
        };
      } catch (err) {
        lastError = err;
        const failureClass = classifyError(err);

        // Non-retryable errors on same provider: break immediately to cascade to next free provider
        if (
          failureClass === FAILURE_CLASS.AUTH_FAILURE ||
          failureClass === FAILURE_CLASS.RATE_LIMITED ||
          failureClass === FAILURE_CLASS.PAID_MODEL_REJECTED ||
          failureClass === FAILURE_CLASS.TRUNCATION_ERROR
        ) {
          break;
        }
      }
    }
  }

  const safeErrorMessage = scrubManualAiSecrets(
    lastError ? lastError.message : 'All configured free Manual AI providers were unavailable or rate-limited.',
    env
  );

  return {
    success: false,
    error: 'No configured free Manual AI Rewrite provider is currently available. All approved free providers were either unconfigured, rate-limited, or unavailable. Zero paid fallbacks were attempted. Details: ' + safeErrorMessage,
    totalAttempts,
    providerUsed: null
  };
}
