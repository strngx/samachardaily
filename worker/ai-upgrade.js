/**
 * Samachar Daily — Manual AI Article Upgrade Engine (Phase D)
 *
 * Implements production-grade, safe, human-in-the-loop manual article upgrades:
 * 1. Strict server-side authorization (ADMIN & EDITOR only)
 * 2. Original article protection (Read-only, zero automatic overwrites)
 * 3. Deterministic editorial fact/safety analysis with clear classifications:
 *    - SUPPORTED | UNCERTAIN | UNSUPPORTED | POTENTIALLY MISLEADING | SAFETY CONCERN
 * 4. Multi-provider free-first AI waterfall (Groq -> Gemini -> OpenRouter -> Cloudflare Workers AI)
 * 5. Prompt injection defense & untrusted input sanitization
 * 6. Bounded retry and graceful degradation (never fakes success, never loops infinitely)
 * 7. Comprehensive output quality guards (truncation, prompt leakage, placeholders, fake citations, topic drift)
 * 8. Zero external dependencies (100% Web Standards & Fetch API)
 */

import { SENSITIVITY_TAXONOMY, RECOGNIZED_WIRES } from './safety.js';
export {
  PROVIDER_TIMEOUT_MS,
  MAX_RETRY_ATTEMPTS
} from './manual-ai-providers.js';
import {
  scrubManualAiSecrets,
  researchManualStoryContext,
  extractManualStoryEntities,
  executeManualAiWaterfall
} from './manual-ai-providers.js';

// ============================================================================
// 1. CONSTANTS & CLASSIFICATIONS
// ============================================================================

export const CLAIM_CLASSIFICATION = {
  ATTRIBUTED: 'ATTRIBUTED',
  SUPPORTED_BY_PROVIDED_MATERIAL: 'SUPPORTED BY PROVIDED MATERIAL',
  SUPPORTED: 'SUPPORTED BY PROVIDED MATERIAL', // Backwards compatibility alias
  UNCERTAIN: 'UNCERTAIN',
  UNSUPPORTED: 'UNSUPPORTED',
  POTENTIALLY_MISLEADING: 'POTENTIALLY MISLEADING',
  SAFETY_CONCERN: 'SAFETY CONCERN'
};

// High-risk legal, defamatory, and inflammatory trigger patterns
const DEFAMATION_RISK_PATTERNS = [
  /\b(?:accused of fraud|scamster|kingpin|bribe taker|extortionist|swindler|corrupt official)\b/i,
  /\b(?:guilty of treason|colluded with enemy|criminal mastermind|forged documents)\b/i,
  /\b(?:allegedly molested|sexual misconduct accused|quack doctor|shady operator)\b/i
];

const INFLAMMATORY_PATTERNS = [
  /\b(?:sensational plot|nefarious conspiracy|anti-national elements|traitorous)\b/i,
  /\b(?:vicious assault|bloodthirsty mob|barbaric act)\b/i
];

const MEDICAL_FINANCIAL_PATTERNS = [
  /\b(?:miracle cure|guaranteed return|100% cure|secret remedy|guaranteed stock surge)\b/i,
  /\b(?:insider trading confirmed|ponzi scheme mastermind)\b/i
];

const PLACEHOLDER_PATTERNS = [
  /\[insert\s+[^\]]+\]/i,
  /\[source\s+here\]/i,
  /\[citation\s+needed\]/i,
  /\[quote\s+here\]/i,
  /\[placeholder\]/i,
  /\blorem\s+ipsum\b/i,
  /\[date\s+here\]/i,
  /\[link\s+here\]/i
];

const PROMPT_LEAKAGE_PATTERNS = [
  /\bYou are an AI\b/i,
  /\bYou are a strict editorial\b/i,
  /\bAs an AI language model\b/i,
  /\bSYSTEM:\s*/i,
  /\bASSISTANT:\s*/i,
  /\bUSER:\s*/i,
  /<system>[\s\S]*?<\/system>/i,
  /```json\s*\{\s*"systemPrompt"/i,
  /\bAPI_KEY\b/,
  /\bBearer\s+gsk_/i,
  /\bGITHUB_CONTENTS_TOKEN\b/
];

// ============================================================================
// 2. PROMPT INJECTION & UNTRUSTED INPUT DEFENSE
// ============================================================================

/**
 * Sanitizes untrusted user/article text before embedding in prompt templates.
 * Neutralizes prompt escape delimiters and bounds length.
 */
export function sanitizeUntrustedText(text, maxLength = 8000) {
  if (!text || typeof text !== 'string') return '';
  let sanitized = text
    .replace(/<system[\s\S]*?<\/system>/gi, '')
    .replace(/<instruction[\s\S]*?<\/instruction>/gi, '')
    .replace(/\[\/?INST\]/g, '')
    .replace(/<<SYS>>[\s\S]*?<<\/SYS>>/g, '');

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '\n[Content truncated for length]';
  }
  return sanitized.trim();
}

/**
 * Scrubs known server secrets and all MANUAL_AI_* credentials from text or errors.
 */
export function scrubSecrets(text, env = {}) {
  return scrubManualAiSecrets(text, env);
}

// ============================================================================
// 3. FACT & SAFETY ANALYSIS ENGINE
// ============================================================================

/**
 * Analyzes article for factual attribution, safety risks, and potential legal concerns.
 * Classifies findings strictly using: SUPPORTED, UNCERTAIN, UNSUPPORTED, POTENTIALLY MISLEADING, SAFETY CONCERN.
 */
export function analyzeArticleSafety(article = {}) {
  const {
    title = '',
    dek = '',
    body = '',
    sourceName = '',
    sourceUrl = ''
  } = article;

  const fullText = `${title}\n${dek}\n${body}`;
  const findings = [];
  const hasDeclaredSource = Boolean(sourceName && sourceName.trim() && sourceName.toLowerCase() !== 'unknown');
  const wireMatches = RECOGNIZED_WIRES.filter(w =>
    w.aliases.some(a => (sourceName || '').toLowerCase().includes(a))
  );
  const isRecognizedWire = wireMatches.length > 0;

  // 1. Check for Defamation / Criminal Allegations without FIR / Court attribution
  for (const pat of DEFAMATION_RISK_PATTERNS) {
    const match = fullText.match(pat);
    if (match) {
      const surrounding = fullText.slice(Math.max(0, match.index - 80), Math.min(fullText.length, match.index + 120));
      const hasLegalAttribution = /\b(?:fir|chargesheet|police said|court noted|cbi said|ed stated|advocate|spokesperson)\b/i.test(surrounding);
      findings.push({
        type: 'LEGAL_ALLEGATION',
        classification: hasLegalAttribution ? CLAIM_CLASSIFICATION.ATTRIBUTED : CLAIM_CLASSIFICATION.SAFETY_CONCERN,
        snippet: match[0],
        context: surrounding.trim(),
        message: hasLegalAttribution
          ? `Allegation attributed in text to official proceedings/named agency: "${match[0]}" (Presumption of innocence applies; not independently verified).`
          : `Unattributed criminal/defamatory allegation detected: "${match[0]}". Requires official agency citation.`,
        guidance: 'Preserve presumption of innocence. Verify FIR or agency chargesheet before publishing.'
      });
    }
  }

  // 2. Check for Inflammatory / Sensational Phrasing
  for (const pat of INFLAMMATORY_PATTERNS) {
    const match = fullText.match(pat);
    if (match) {
      findings.push({
        type: 'INFLAMMATORY_LANGUAGE',
        classification: CLAIM_CLASSIFICATION.POTENTIALLY_MISLEADING,
        snippet: match[0],
        message: `Potentially sensational or loaded language: "${match[0]}".`,
        guidance: 'Use neutral, factual phrasing adhering to journalistic decorum.'
      });
    }
  }

  // 3. Check for Unverified Medical / Financial Claims
  for (const pat of MEDICAL_FINANCIAL_PATTERNS) {
    const match = fullText.match(pat);
    if (match) {
      findings.push({
        type: 'UNVERIFIED_CLAIM',
        classification: CLAIM_CLASSIFICATION.UNSUPPORTED,
        snippet: match[0],
        message: `High-risk medical or financial certainty claim: "${match[0]}".`,
        guidance: 'Attribute medical breakthroughs to peer-reviewed sources or regulators.'
      });
    }
  }

  // 4. Source Wire Attribution Assessment
  if (!hasDeclaredSource) {
    findings.push({
      type: 'SOURCE_ATTRIBUTION',
      classification: CLAIM_CLASSIFICATION.UNSUPPORTED,
      snippet: 'No wire source declared',
      message: 'Article lacks primary news agency attribution (e.g. PTI, ANI, Reuters).',
      guidance: 'Declare the wire service or reporting agency to substantiate news dispatches.'
    });
  } else if (!isRecognizedWire) {
    findings.push({
      type: 'SOURCE_ATTRIBUTION',
      classification: CLAIM_CLASSIFICATION.UNCERTAIN,
      snippet: sourceName,
      message: `Declared wire source "${sourceName}" is not in the recognized national wire registry.`,
      guidance: 'Confirm source authenticity and original reporting wire URL.'
    });
  } else {
    findings.push({
      type: 'SOURCE_ATTRIBUTION',
      classification: CLAIM_CLASSIFICATION.ATTRIBUTED,
      snippet: sourceName,
      message: `Declared wire attribution: ${wireMatches[0].name} (Attribution recorded; not externally live-verified).`,
      guidance: 'Wire attribution recorded from provided article metadata.'
    });
  }

  // 5. Sensitivity Guideline Triggers
  for (const [key, category] of Object.entries(SENSITIVITY_TAXONOMY)) {
    if (category.regex && category.regex.test(fullText)) {
      findings.push({
        type: 'SENSITIVE_TOPIC',
        classification: category.severity === 'HIGH' ? CLAIM_CLASSIFICATION.SAFETY_CONCERN : CLAIM_CLASSIFICATION.UNCERTAIN,
        snippet: category.label,
        message: `Classified under sensitive guideline: ${category.label}.`,
        guidance: category.statutoryNote || category.description
      });
    }
  }

  // Aggregate overall safety verdict
  const hasSafetyConcern = findings.some(f => f.classification === CLAIM_CLASSIFICATION.SAFETY_CONCERN);
  const hasMisleading = findings.some(f => f.classification === CLAIM_CLASSIFICATION.POTENTIALLY_MISLEADING);
  const hasUnsupported = findings.some(f => f.classification === CLAIM_CLASSIFICATION.UNSUPPORTED);

  const status = hasSafetyConcern
    ? 'SAFETY_WARNING'
    : (hasMisleading || hasUnsupported ? 'EDITORIAL_REVIEW' : 'PASS');

  return {
    status,
    totalFindings: findings.length,
    findings,
    counts: {
      attributed: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.ATTRIBUTED).length,
      supportedByMaterial: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.SUPPORTED_BY_PROVIDED_MATERIAL).length,
      supported: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.SUPPORTED || f.classification === CLAIM_CLASSIFICATION.ATTRIBUTED).length,
      uncertain: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.UNCERTAIN).length,
      unsupported: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.UNSUPPORTED).length,
      potentiallyMisleading: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.POTENTIALLY_MISLEADING).length,
      safetyConcern: findings.filter(f => f.classification === CLAIM_CLASSIFICATION.SAFETY_CONCERN).length
    }
  };
}

// ============================================================================
// 4. OUTPUT QUALITY GUARDS
// ============================================================================

/**
 * Computes word count for text
 */
export function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const matches = text.trim().match(/[\w'-]+/g);
  return matches ? matches.length : 0;
}

/**
 * Calculates Jaccard similarity between two sets of significant words
 * to detect topic drift and ensure identity preservation.
 */
export function calculateTopicOverlap(textA, textB) {
  function getSignificantWords(str) {
    if (!str) return new Set();
    const words = str.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'were', 'which', 'about', 'their', 'there', 'would', 'could', 'should']);
    return new Set(words.filter(w => !stopWords.has(w)));
  }

  const setA = getSignificantWords(textA);
  const setB = getSignificantWords(textB);
  if (setA.size === 0 || setB.size === 0) return 1.0;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Strict quality evaluation of AI output.
 * Flags truncation, prompt leakage, placeholders, fake citations, and topic drift.
 */
export function evaluateOutputQuality(candidate, original) {
  const flags = [];
  const warnings = [];

  const headline = (candidate.headline || '').trim();
  const body = (candidate.body || '').trim();
  const origHeadline = (original.title || '').trim();
  const origBody = (original.body || '').trim();

  const origWords = countWords(origBody);
  const candWords = countWords(body);

  // 1. Emptiness & Length checks
  if (!headline) {
    flags.push('EMPTY_HEADLINE: Upgraded article lacks a headline.');
  }
  if (!body) {
    flags.push('EMPTY_BODY: Upgraded article body is empty.');
  } else if (candWords < 60) {
    flags.push(`EXTREMELY_SHORT: Word count (${candWords}) is below minimum editorial viable length (60 words).`);
  } else if (origWords > 120 && candWords < origWords * 0.4) {
    warnings.push(`SIGNIFICANT_CONDENSATION: Upgraded word count dropped by more than 60% (${origWords} -> ${candWords} words).`);
  }

  // 2. Truncation detection
  if (body) {
    const lastChar = body.slice(-1);
    const last10 = body.slice(-10);
    const endsAbruptly = !['.', '!', '?', '"', "'", '`', '*', ')', '>'].includes(lastChar) &&
      !last10.includes('\n\n');
    if (endsAbruptly) {
      flags.push('OBVIOUS_TRUNCATION: Generated article appears to end mid-sentence.');
    }
  }

  // 3. Prompt leakage detection
  const fullCand = `${headline}\n${body}`;
  for (const pat of PROMPT_LEAKAGE_PATTERNS) {
    if (pat.test(fullCand)) {
      flags.push('PROMPT_LEAKAGE: Internal system instructions or prompt tokens detected in output.');
      break;
    }
  }

  // 4. Placeholder detection
  for (const pat of PLACEHOLDER_PATTERNS) {
    const match = fullCand.match(pat);
    if (match) {
      flags.push(`PLACEHOLDER_DETECTED: Incomplete editorial placeholder found ("${match[0]}").`);
      break;
    }
  }

  // 5. Fabricated URL / Markdown Link Detection
  const origLinks = new Set((origBody.match(/\(https?:\/\/[^\s)]+\)/g) || []).map(l => l.toLowerCase()));
  const candLinks = (body.match(/\(https?:\/\/[^\s)]+\)/g) || []).map(l => l.toLowerCase());
  const novelLinks = candLinks.filter(l => !origLinks.has(l));
  if (novelLinks.length > 0) {
    warnings.push(`NEW_EXTERNAL_LINKS: Generated output added ${novelLinks.length} new external link(s). Ensure links are valid.`);
  }

  // 6. Topic Drift & Identity Preservation
  const titleOverlap = calculateTopicOverlap(origHeadline, headline);
  const bodyOverlap = calculateTopicOverlap(origBody.slice(0, 500), body.slice(0, 500));
  if (titleOverlap < 0.15 && bodyOverlap < 0.15) {
    flags.push('TOPIC_DRIFT: Candidate has low topical similarity to original. Article identity may have mutated.');
  }

  return {
    valid: flags.length === 0,
    flags,
    warnings,
    metrics: {
      originalWords: origWords,
      upgradedWords: candWords,
      wordDelta: candWords - origWords,
      topicSimilarity: Math.round(((titleOverlap + bodyOverlap) / 2) * 100)
    }
  };
}

// ============================================================================
// 5. STORY RESEARCH & ENTITY EXTRACTION ENGINE
// ============================================================================

/**
 * Extracts story entities and topics from article headline, lead, and body.
 */
export function extractStoryEntities(article = {}) {
  return extractManualStoryEntities(article);
}

/**
 * Conducts real web / encyclopedic research strictly using isolated MANUAL_AI_* credentials.
 * Never accesses automated pipeline keys.
 */
export async function researchStoryContext(article = {}, env = {}) {
  return researchManualStoryContext(article, env);
}

// ============================================================================
// 6. AI GENERATION WATERFALL & BOUNDED RETRY
// ============================================================================

/**
 * Builds the strict, injection-safe editorial upgrade prompt.
 */
export function buildUpgradePrompts(article = {}, options = {}) {
  const sanitizedTitle = sanitizeUntrustedText(article.title || '');
  const sanitizedDek = sanitizeUntrustedText(article.dek || '');
  const sanitizedBody = sanitizeUntrustedText(article.body || '');
  const sourceName = sanitizeUntrustedText(article.sourceName || 'Wire Dispatch');
  const sourceUrl = sanitizeUntrustedText(article.sourceUrl || '');
  const editorialFocus = sanitizeUntrustedText(options.focus || 'comprehensive_rewrite');
  const research = options.research || {};

  let researchSection = '';
  if (research.researched && Array.isArray(research.evidence) && research.evidence.length > 0) {
    const evidenceText = research.evidence
      .map((e, idx) => `[Source ${idx + 1}: ${e.source} - ${sanitizeUntrustedText(e.title)}]\n${sanitizeUntrustedText(e.snippet)}`)
      .join('\n\n');
    researchSection = `\n=== VERIFIED RESEARCH CONTEXT & EXTERNAL EVIDENCE ===\n${evidenceText}\n`;
  } else if (research.message) {
    researchSection = `\n=== RESEARCH STATUS ===\n${sanitizeUntrustedText(research.message)}\n`;
  }

  const systemPrompt = `You are a senior investigative newsroom editor at SamacharDaily.
Your objective is to perform a comprehensive, publication-grade MANUAL AI REWRITE of the provided news article.
You must NOT merely paraphrase or summarize paragraphs. You must produce a full-length, authoritative, search-optimized news dispatch that rewrites ALL article text.

STRICT EDITORIAL RULES:
1. REWRITE THE ENTIRE ARTICLE TEXT:
   - Headline: Compelling, accurate, search-optimized headline with strong news value.
   - Dek: Informative, engaging 1-2 sentence lead deck summarizing key impact.
   - Introduction: High-impact lead answering who, what, when, where, and why clearly.
   - Section Headings: Logical Markdown H2 (##) and H3 (###) subheadings organizing key themes.
   - Narrative & Background: Synthesize verified background context, timeline, and stakeholder impacts.
   - Conclusion: Forward-looking analysis or key takeaways ("What Happens Next" / "Key Takeaways").
2. EVIDENCE & FACT INTEGRITY:
   - ZERO FABRICATION: Never invent quotes, statistics, dates, URLs, citations, or legal claims.
   - ATTRIBUTION DISCIPLINE: Distinguish between original dispatch claims, provided research facts, and unverified allegations.
   - PRESERVE UNCERTAINTY: If something is disputed or under investigation, state it neutrally.
3. PRESERVE ARTICLE IDENTITY: The story must retain the core event, people, and subject of the original.
4. NATURAL EXPANSION: Depending on legitimate factual evidence, write a comprehensive article (typically 600 to 1,500+ words). Never pad with fluff or repetition.
5. NO MEDIA MODIFICATION: Do NOT alter or output images, video embeds, URLs, or slugs. This is strictly text.
6. NO PLACEHOLDERS: Never output placeholders like [insert source] or [citation needed].
7. NO SYSTEM LEAKAGE: Never mention instructions, prompts, or your AI identity.

Respond ONLY with a valid JSON object matching this schema:
{
  "headline": "Search-optimized, factual headline",
  "dek": "Informative lead deck summary",
  "body": "Full rewritten article in Markdown with H2 section headings",
  "editorialChanges": ["Detailed list of structural and factual expansions applied"],
  "preservedFacts": ["Key dates, names, figures, and attributions preserved"],
  "researchApplied": ["External research facts or background context integrated"]
}`;

  const userPrompt = `ORIGINAL DISPATCH:
Headline: ${sanitizedTitle}
Lead: ${sanitizedDek}
Wire Attribution: ${sourceName} (${sourceUrl || 'No URL'})
Editorial Improvement Focus: ${editorialFocus}

Original Body:
${sanitizedBody}
${researchSection}
Perform a comprehensive AI rewrite of this story following the editorial rules. Output strictly valid JSON.`;

  return { systemPrompt, userPrompt };
}

/**
 * Generates an upgraded article candidate using the isolated multi-provider waterfall with bounded retry.
 */
export async function generateArticleUpgrade(article = {}, env = {}, options = {}) {
  // 1. Conduct or accept real story research
  let research = options.research;
  if (!research) {
    research = await researchStoryContext(article, env);
  }

  const { systemPrompt, userPrompt } = buildUpgradePrompts(article, { ...options, research });

  const result = await executeManualAiWaterfall({
    systemPrompt,
    userPrompt,
    article,
    qualityEvaluator: evaluateOutputQuality,
    safetyAnalyzer: analyzeArticleSafety
  }, env);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      totalAttempts: result.totalAttempts || 0,
      providerUsed: null,
      research
    };
  }

  return {
    success: true,
    providerUsed: result.providerUsed,
    modelUsed: result.modelUsed,
    totalAttempts: result.totalAttempts,
    research: {
      researched: Boolean(research && research.researched),
      provider: research ? research.provider : null,
      evidenceCount: (research && research.evidence) ? research.evidence.length : 0,
      evidence: (research && research.evidence) ? research.evidence : []
    },
    candidate: {
      headline: result.data.headline,
      dek: result.data.dek || article.dek || '',
      body: result.data.body,
      editorialChanges: result.data.editorialChanges || [],
      preservedFacts: result.data.preservedFacts || [],
      researchApplied: result.data.researchApplied || []
    },
    quality: result.quality,
    safetyAnalysis: result.safetyAnalysis
  };
}
