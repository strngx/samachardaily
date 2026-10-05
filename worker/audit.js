/**
 * Samachar Daily — Editorial Revision & Audit History Engine
 *
 * Implements Phase 6 Audit History tracking for all editorial actions:
 * 1. Durable storage in Cloudflare KV (env.AUTH_KV) under isolated namespaces.
 * 2. Field-level before/after diff tracking for headline, desk, deck, byline, SEO, attribution, and body.
 * 3. Validation result logging (successful mutations and rejected validation attempts).
 * 4. Lifecycle action recording: Save/Edit, Archive (noindex), Restore (active), Delete.
 * 5. Strict security: zero secrets, passwords, tokens, hashes, or subscriber data are ever recorded or returned.
 * 6. Concurrency-safe: tracks Git SHAs alongside actions.
 */

// Memory fallback for tests or transient environments where KV is unbound
export const memoryAuditStore = new Map();

/**
 * Valid categories/desks in the publication
 */
export const VALID_DESKS = ['India', 'World', 'Business', 'Tech', 'Sports'];

/**
 * Strict path regex for article Markdown files in src/articles/<category>/<slug>.md
 */
export const ARTICLE_PATH_REGEX = /^src\/articles\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.md$/;

/**
 * Validates an article payload before saving
 *
 * @param {Object} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateArticlePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Invalid request payload. Must be a JSON object.'] };
  }

  // 1. Path validation
  if (!payload.relPath || typeof payload.relPath !== 'string') {
    errors.push('Missing or invalid article path (relPath).');
  } else {
    const forwardPath = payload.relPath.replace(/\\/g, '/');
    if (!ARTICLE_PATH_REGEX.test(forwardPath)) {
      errors.push('Invalid target path format. Target must match src/articles/<desk>/<slug>.md');
    }
  }

  // 2. Headline validation
  if (typeof payload.title !== 'undefined') {
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      errors.push('Article headline (title) cannot be empty.');
    } else if (payload.title.trim().length > 300) {
      errors.push('Article headline exceeds maximum limit of 300 characters.');
    }
  }

  // 3. Category/Desk validation
  if (typeof payload.category !== 'undefined') {
    if (typeof payload.category !== 'string' || !payload.category.trim()) {
      errors.push('Editorial desk (category) cannot be empty.');
    } else {
      const match = VALID_DESKS.some(d => d.toLowerCase() === payload.category.trim().toLowerCase());
      if (!match) {
        errors.push(`Invalid editorial desk "${payload.category}". Allowed desks: ${VALID_DESKS.join(', ')}`);
      }
    }
  }

  // 4. URL validations if provided
  if (payload.sourceUrl && typeof payload.sourceUrl === 'string' && payload.sourceUrl.trim()) {
    try {
      const parsed = new URL(payload.sourceUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('Wire source URL must use http or https protocol.');
      }
    } catch (_) {
      errors.push('Wire source URL is not a valid URL.');
    }
  }

  if (payload.image && typeof payload.image === 'string' && payload.image.trim()) {
    const img = payload.image.trim();
    if (!img.startsWith('/') && !img.startsWith('http://') && !img.startsWith('https://')) {
      errors.push('Image path must be a valid absolute URL or root-relative path.');
    }
  }

  // Phase 13D: Deterministic YouTube video_id validation if present
  if (payload.video_id !== undefined && payload.video_id !== null && String(payload.video_id).trim()) {
    const vid = String(payload.video_id).trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(vid)) {
      errors.push('YouTube video ID must be a valid 11-character identifier.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Counts words in a string
 */
export function countWords(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Computes structured diff between previous article state and updated state
 *
 * @param {Object} oldData - Frontmatter data from existing file
 * @param {string} oldBody - Markdown content body from existing file
 * @param {Object} updatedFields - Fields being saved
 * @returns {Object} Structured diff containing changedFields and fieldChanges
 */
export function computeArticleDiff(oldData = {}, oldBody = '', updatedFields = {}) {
  const changedFields = [];
  const fieldChanges = {};

  const scalarFields = [
    'title',
    'dek',
    'category',
    'author',
    'image',
    'imageCredit',
    'sourceName',
    'sourceUrl',
    'seoTitle',
    'why_it_matters',
    'what_happens_next',
    'video_id',
    'video_caption'
  ];

  for (const field of scalarFields) {
    if (field in updatedFields && updatedFields[field] !== undefined) {
      const oldVal = oldData[field] !== undefined && oldData[field] !== null ? String(oldData[field]).trim() : '';
      const newVal = updatedFields[field] !== null ? String(updatedFields[field]).trim() : '';

      if (oldVal !== newVal) {
        changedFields.push(field);
        fieldChanges[field] = {
          old: oldVal,
          new: newVal
        };
      }
    }
  }

  // Handle body diff
  if (typeof updatedFields.body === 'string') {
    const cleanOldBody = (oldBody || '').trim();
    const cleanNewBody = updatedFields.body.trim();

    if (cleanOldBody !== cleanNewBody) {
      changedFields.push('body');
      const oldWords = countWords(cleanOldBody);
      const newWords = countWords(cleanNewBody);
      const wordDiff = newWords - oldWords;

      fieldChanges['body'] = {
        oldLength: cleanOldBody.length,
        newLength: cleanNewBody.length,
        oldWords: oldWords,
        newWords: newWords,
        wordDiff: wordDiff,
        previewSnippet: cleanNewBody.slice(0, 140) + (cleanNewBody.length > 140 ? '...' : '')
      };
    }
  }

  // Handle boolean flags like noindex
  if ('noindex' in updatedFields && updatedFields.noindex !== undefined) {
    const oldNoindex = Boolean(oldData.noindex);
    const newNoindex = Boolean(updatedFields.noindex);
    if (oldNoindex !== newNoindex) {
      changedFields.push('noindex');
      fieldChanges['noindex'] = {
        old: oldNoindex,
        new: newNoindex
      };
    }
  }

  return {
    changedFields,
    fieldChanges,
    wordCountChange: fieldChanges.body ? {
      old: fieldChanges.body.oldWords,
      new: fieldChanges.body.newWords,
      diff: fieldChanges.body.wordDiff
    } : null
  };
}

/**
 * Sanitizes an audit record before saving to guarantee zero leakage
 * of passwords, hashes, PATs, session secrets, or internal keys.
 *
 * @param {Object} record
 * @returns {Object} Sanitized copy of record
 */
export function sanitizeAuditRecord(record) {
  if (!record || typeof record !== 'object') return {};

  function isForbiddenKey(k) {
    const norm = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      norm.includes('password') ||
      norm.includes('token') ||
      norm.includes('secret') ||
      norm.includes('cookie') ||
      norm.includes('hash') ||
      norm.includes('auth') ||
      norm === 'env'
    );
  }

  function cleanObject(obj, depth = 0) {
    if (depth > 6) return null;
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => cleanObject(item, depth + 1));

    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isForbiddenKey(k)) {
        continue; // Strictly omit
      }
      if (typeof v === 'string') {
        // Strip out any potential token/secret strings if present
        if (/ghp_[a-zA-Z0-9]{20,}/.test(v) || /pbkdf2:\d+:/.test(v)) {
          clean[k] = '[REDACTED_CREDENTIAL]';
        } else {
          clean[k] = v;
        }
      } else if (typeof v === 'object' && v !== null) {
        clean[k] = cleanObject(v, depth + 1);
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  return cleanObject(record);
}

/**
 * Records an audit event into Cloudflare KV (env.AUTH_KV)
 *
 * @param {Object} env - Cloudflare Worker environment bindings
 * @param {Object} eventData - Audit event details
 * @returns {Promise<Object>} Created and persisted audit record
 */
export async function recordAuditEvent(env, eventData) {
  const now = new Date();
  const timestamp = now.toISOString();
  const rand = Math.random().toString(36).substring(2, 8);
  const id = `rev_${now.getTime()}_${rand}`;

  const forwardPath = (eventData.relPath || '').replace(/\\/g, '/');
  const pathParts = forwardPath.split('/');
  const filename = pathParts[pathParts.length - 1] || '';
  const slug = eventData.slug || filename.replace(/\.md$/, '');

  const rawRecord = {
    id,
    timestamp,
    actor: eventData.actor || 'admin',
    action: eventData.action || 'save', // 'save' | 'archive' | 'restore' | 'delete' | 'validation_failed'
    status: eventData.status || 'success', // 'success' | 'failed' | 'conflict'
    relPath: forwardPath,
    slug,
    category: eventData.category || (pathParts[2] ? pathParts[2] : null),
    sha: eventData.sha || null,
    commitMessage: eventData.commitMessage || null,
    validation: eventData.validation || { valid: true },
    diff: eventData.diff || { changedFields: [], fieldChanges: {} },
    summary: eventData.summary || generateEventSummary(eventData)
  };

  const record = sanitizeAuditRecord(rawRecord);

  // 1. Persist to Article-specific history in KV
  const articleKey = `audit:art:${forwardPath}`;
  let articleHistory = [];

  if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const existingRaw = await env.AUTH_KV.get(articleKey);
      if (existingRaw) {
        articleHistory = JSON.parse(existingRaw);
      }
    } catch (_) {
      articleHistory = [];
    }

    // Prepend new record (most recent first), keep last 50 revisions per article
    articleHistory.unshift(record);
    if (articleHistory.length > 50) {
      articleHistory = articleHistory.slice(0, 50);
    }

    try {
      await env.AUTH_KV.put(articleKey, JSON.stringify(articleHistory));
    } catch (err) {
      console.error('[Audit KV Error] Failed to write article audit history:', err.message);
    }

    // 2. Persist to Global Recent Audit Log in KV (most recent 100 actions publication-wide)
    const globalKey = 'audit:global:recent';
    let globalHistory = [];
    try {
      const existingGlobal = await env.AUTH_KV.get(globalKey);
      if (existingGlobal) {
        globalHistory = JSON.parse(existingGlobal);
      }
    } catch (_) {
      globalHistory = [];
    }

    globalHistory.unshift(record);
    if (globalHistory.length > 100) {
      globalHistory = globalHistory.slice(0, 100);
    }

    try {
      await env.AUTH_KV.put(globalKey, JSON.stringify(globalHistory));
    } catch (err) {
      console.error('[Audit KV Error] Failed to write global audit history:', err.message);
    }
  } else {
    // Memory store fallback for test suites and environments without KV
    if (!memoryAuditStore.has(articleKey)) {
      memoryAuditStore.set(articleKey, []);
    }
    const memArtHistory = memoryAuditStore.get(articleKey);
    memArtHistory.unshift(record);
    if (memArtHistory.length > 50) memArtHistory.length = 50;

    if (!memoryAuditStore.has('audit:global:recent')) {
      memoryAuditStore.set('audit:global:recent', []);
    }
    const memGlobalHistory = memoryAuditStore.get('audit:global:recent');
    memGlobalHistory.unshift(record);
    if (memGlobalHistory.length > 100) memGlobalHistory.length = 100;
  }

  return record;
}

/**
 * Retrieves audit history for a specific article
 *
 * @param {Object} env - Cloudflare Worker environment bindings
 * @param {string} relPath - Path to article Markdown file
 * @returns {Promise<Array<Object>>} List of audit records
 */
export async function getArticleAuditHistory(env, relPath) {
  const forwardPath = (relPath || '').replace(/\\/g, '/');
  const articleKey = `audit:art:${forwardPath}`;

  if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const data = await env.AUTH_KV.get(articleKey);
      if (data) {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      console.error('[Audit KV Error] Failed to read article history:', err.message);
    }
    return [];
  }

  // Memory fallback
  return memoryAuditStore.get(articleKey) || [];
}

/**
 * Retrieves global recent audit logs across the publication
 *
 * @param {Object} env - Cloudflare Worker environment bindings
 * @param {number} limit - Maximum number of logs to return (default: 50)
 * @returns {Promise<Array<Object>>} List of recent audit records
 */
export async function getRecentAuditLogs(env, limit = 50) {
  const globalKey = 'audit:global:recent';

  if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    try {
      const data = await env.AUTH_KV.get(globalKey);
      if (data) {
        const parsed = JSON.parse(data);
        const list = Array.isArray(parsed) ? parsed : [];
        return list.slice(0, limit);
      }
    } catch (err) {
      console.error('[Audit KV Error] Failed to read global audit history:', err.message);
    }
    return [];
  }

  const memList = memoryAuditStore.get(globalKey) || [];
  return memList.slice(0, limit);
}

/**
 * Generates a human-readable event summary
 */
function generateEventSummary(event) {
  const action = event.action || 'save';
  const status = event.status || 'success';

  if (status === 'failed') {
    const errs = (event.validation && event.validation.errors) ? event.validation.errors.join(', ') : 'Validation failed';
    return `Validation rejected: ${errs}`;
  }

  if (status === 'conflict') {
    return 'Concurrency conflict: Article was modified in GitHub by another process';
  }

  if (action === 'archive') {
    return 'Article archived (marked noindex: true)';
  }

  if (action === 'restore') {
    return 'Article restored to active search indexation';
  }

  if (action === 'delete') {
    return 'Article permanently deleted from repository';
  }

  if (action === 'save') {
    const changed = (event.diff && event.diff.changedFields) ? event.diff.changedFields : [];
    if (changed.length === 0) return 'Saved with no field changes';
    return `Saved changes to ${changed.join(', ')}`;
  }

  return `Editorial action: ${action}`;
}
