/**
 * Samachar Daily — AI Editorial Safety Engine (Phase 9)
 *
 * Implements deterministic-first editorial safety, claim extraction,
 * source verification, PII detection, sensitivity review, and media rights verification.
 *
 * Tier 0: Pure deterministic heuristics (instant, 100% offline, zero API tokens).
 * Tier 1: Multi-provider free-first AI verification waterfall with graceful degradation.
 *
 * Safety Invariants:
 * 1. Revision-bound: All reports and sign-offs are strictly tied to the exact Git SHA / content hash.
 * 2. Never mutates articles: Advisory and evidence-based only.
 * 3. Never numerical score: Clear descriptive states (PASS | NEEDS_REVIEW | BLOCKED).
 * 4. Safe AI degradation: AI outage never passes an article; returns UNABLE_TO_VERIFY -> NEEDS_REVIEW.
 * 5. Isolated KV namespaces: Uses safety:art:... and safety:rev:... with zero lockout/audit collision.
 */

// ============================================================================
// 1. RECOGNIZED WIRE AGENCIES & REPUTABLE SOURCES
// ============================================================================
export const RECOGNIZED_WIRES = [
  { id: 'pti', name: 'Press Trust of India', aliases: ['pti', 'press trust of india'], domains: ['ptinews.com'] },
  { id: 'ani', name: 'Asian News International', aliases: ['ani', 'asian news international'], domains: ['aninews.in'] },
  { id: 'reuters', name: 'Reuters', aliases: ['reuters', 'thomson reuters'], domains: ['reuters.com'] },
  { id: 'ap', name: 'Associated Press', aliases: ['ap', 'associated press'], domains: ['apnews.com'] },
  { id: 'afp', name: 'Agence France-Presse', aliases: ['afp', 'agence france-presse'], domains: ['afp.com'] },
  { id: 'bloomberg', name: 'Bloomberg', aliases: ['bloomberg', 'bloomberg news'], domains: ['bloomberg.com'] },
  { id: 'pib', name: 'Press Information Bureau', aliases: ['pib', 'press information bureau'], domains: ['pib.gov.in', 'gov.in', 'nic.in'] },
  { id: 'the_hindu', name: 'The Hindu', aliases: ['the hindu', 'the hindu wire'], domains: ['thehindu.com'] },
  { id: 'toi', name: 'Times of India', aliases: ['times of india', 'toi', 'toi wire'], domains: ['timesofindia.indiatimes.com', 'indiatimes.com'] },
  { id: 'bbc', name: 'BBC News', aliases: ['bbc', 'bbc news'], domains: ['bbc.com', 'bbc.co.uk'] }
];

// Recognized image syndication credit providers
export const RECOGNIZED_PHOTO_CREDITS = [
  'pti photo', 'ani photo', 'reuters', 'ap photo', 'afp photo',
  'pib', 'wikimedia commons', 'unsplash', 'staff photo',
  'standard wire', 'getty images', 'express photo'
];

// Common emergency & public official contact numbers (Not private PII)
const PUBLIC_OFFICE_PHONE_PATTERNS = [
  /\b(?:112|100|101|102|108|1091|1098|1075|1930)\b/, // Emergency & national helplines
  /\b1800[-\s]?\d{3}[-\s]?\d{3,4}\b/,                 // Toll-free 1800 numbers
  /\b011[-\s]?\d{8}\b/                                // Delhi central secretariat landlines
];

// Whitelisted public government/institutional email domains
const PUBLIC_OFFICE_EMAIL_DOMAINS = [
  'gov.in', 'nic.in', 'pib.gov.in', 'isro.gov.in', 'drdo.gov.in',
  'mea.gov.in', 'mha.gov.in', 'rbi.org.in', 'sebi.gov.in', 'who.int', 'un.org',
  'reuters.com', 'ap.org', 'ptinews.com', 'aniin.com'
];

// ============================================================================
// 2. SENSITIVE STORY TAXONOMIES
// ============================================================================
export const SENSITIVITY_TAXONOMY = {
  minors_juveniles: {
    label: 'Minors & Juvenile Protection',
    description: 'Statutory protection of minors under Sec 74 Juvenile Justice Act & POCSO Act.',
    regex: /\b(?:minor(?:s)?|child(?:ren)?|juvenile(?:s)?|pocso|schoolgirl|schoolboy|underage|class \d{1,2} student|toddler|infant)\b/i,
    severity: 'HIGH',
    statutoryNote: 'Absolute anonymity required: Never reveal name, school, parents, or address of a minor involved in any criminal or traumatic case.'
  },
  sexual_assault: {
    label: 'Sexual Assault & Victim Anonymity',
    description: 'Mandatory statutory confidentiality under Sec 228A IPC / Sec 72 BNS.',
    regex: /\b(?:rape|gangrape|sexual assault|molestation|outraging modesty|posh act|indecent assault)\b/i,
    severity: 'HIGH',
    statutoryNote: 'Mandatory anonymity: Do not disclose name, identity, residence, or relatives of the victim.'
  },
  fatalities_suicide: {
    label: 'Fatalities, Disasters & Self-Harm',
    description: 'Adherence to WHO suicide reporting guidelines & disaster victim dignity.',
    regex: /\b(?:suicide|killed himself|killed herself|ended life|death toll|fatalities|fatal crash|perished in fire|crushed to death|succumbed to injuries)\b/i,
    severity: 'MEDIUM',
    statutoryNote: 'Never publish explicit methods of self-harm; avoid sensationalizing death tolls; respect grieving families.'
  },
  serious_allegations: {
    label: 'Serious Criminal Allegations & Trials',
    description: 'Presumption of innocence and fair reporting of ongoing investigations.',
    regex: /\b(?:cbi chargesheet|ed raid|arrested for fraud|money laundering|bribery scandal|homicide accused|convicted of|bail rejected)\b/i,
    severity: 'MEDIUM',
    statutoryNote: 'Attribute allegations strictly to official FIR, chargesheet, or court statements. Clearly distinguish accused from convicted.'
  },
  communal_public_order: {
    label: 'Communal & Sensitive Public Order',
    description: 'Preventing provocation or propagation of unverified communal tensions.',
    regex: /\b(?:communal clash|sectarian violence|religious dispute|blasphemy allegation|stone pelting|curfew imposed|internet suspended)\b/i,
    severity: 'HIGH',
    statutoryNote: 'Verify through district magistrate or police commissioner statements before publishing. Avoid inflammatory phrasing.'
  },
  health_medical: {
    label: 'Health & Medical Reporting',
    description: 'Public health accuracy and medical claim validation.',
    regex: /\b(?:clinical trial|medical negligence|unapproved drug|vaccine adverse|outbreak|quarantine)\b/i,
    severity: 'LOW',
    statutoryNote: 'Attribute medical breakthroughs to peer-reviewed journals or health ministry releases.'
  },
  defense_military: {
    label: 'Defense & National Security',
    description: 'Operational security and border reporting.',
    regex: /\b(?:border clash|line of actual control|loc firing|troop movement|missile deployment|military base|anti-terror|cordon and search)\b/i,
    severity: 'MEDIUM',
    statutoryNote: 'Rely strictly on official MoD, Army, or MEA briefings.'
  },
  elections_politics: {
    label: 'Elections & Political Sensitivity',
    description: 'Model Code of Conduct and election reporting integrity.',
    regex: /\b(?:election rally|provocative speech|hate speech allegation|model code of conduct|poll violation|evm tampering|booth capturing)\b/i,
    severity: 'MEDIUM',
    statutoryNote: 'Avoid uncorroborated allegations during active election periods. Comply with Election Commission guidelines.'
  },
  financial_markets: {
    label: 'Financial Markets & Securities',
    description: 'Market-moving rumors and price-sensitive information.',
    regex: /\b(?:insider trading|stock manipulation|unverified merger|circuit breaker|sebi probe|market fraud)\b/i,
    severity: 'MEDIUM',
    statutoryNote: 'Confirm corporate actions and market rumors through official stock exchange filings.'
  }
};

// ============================================================================
// 3. DETERMINISTIC PII CHECKER
// ============================================================================
/**
 * Detects potential PII (phones, emails, national IDs, addresses, financial data)
 * while preserving legitimate public-interest and official contact points.
 *
 * @param {string} text - Combined article text (headline, dek, body)
 * @returns {Array<Object>} List of PII findings
 */
export function detectPii(text = '') {
  if (!text || typeof text !== 'string') return [];
  const findings = [];

  // Helper to test if a phone number matches whitelisted public emergency/landlines
  function isPublicPhone(numStr) {
    const clean = numStr.replace(/[\s\-()]/g, '');
    for (const pat of PUBLIC_OFFICE_PHONE_PATTERNS) {
      if (pat.test(numStr) || pat.test(clean)) return true;
    }
    return false;
  }

  // Helper to test if an email matches whitelisted government/official domains
  function isPublicEmail(emailStr) {
    const lower = emailStr.toLowerCase().trim();
    return PUBLIC_OFFICE_EMAIL_DOMAINS.some(domain => lower.endsWith('@' + domain) || lower.endsWith('.' + domain));
  }

  // 1. Indian 10-digit mobile numbers: e.g. +91 9876543210, 09876543210, 9876543210
  const mobileRegex = /(?:(?:\+91[\-\s]?)|(?:0))?([6-9]\d{9})\b/g;
  let match;
  while ((match = mobileRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const digits = match[1];
    if (!isPublicPhone(rawMatch)) {
      findings.push({
        type: 'PHONE_NUMBER',
        category: 'Personal Phone',
        snippet: rawMatch,
        severity: 'HIGH',
        confidence: 'High',
        reason: 'Potential private mobile number detected. Unless this is a public office contact, publishing personal numbers violates privacy guidelines.',
        suggestedRedaction: '[REDACTED_PHONE]'
      });
    }
  }

  // 2. Email addresses
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  while ((match = emailRegex.exec(text)) !== null) {
    const email = match[0];
    if (!isPublicEmail(email)) {
      findings.push({
        type: 'EMAIL_ADDRESS',
        category: 'Personal Email',
        snippet: email,
        severity: 'MEDIUM',
        confidence: 'High',
        reason: 'Personal or non-institutional email address detected.',
        suggestedRedaction: '[REDACTED_EMAIL]'
      });
    }
  }

  // 3. Indian Aadhaar Number pattern: 12 digits (often 4 4 4)
  const aadhaarRegex = /\b([2-9]\d{3}\s\d{4}\s\d{4})\b/g;
  while ((match = aadhaarRegex.exec(text)) !== null) {
    findings.push({
      type: 'NATIONAL_ID',
      category: 'Aadhaar Number',
      snippet: match[0],
      severity: 'CRITICAL',
      confidence: 'High',
      reason: 'Aadhaar number detected. Statutory protection under Aadhaar Act forbids public disclosure.',
      suggestedRedaction: '[REDACTED_AADHAAR]'
    });
  }

  // 4. Indian PAN Card pattern: 5 uppercase letters, 4 digits, 1 uppercase letter
  const panRegex = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/g;
  while ((match = panRegex.exec(text)) !== null) {
    // Avoid common false positives like uppercase acronyms if adjacent to words
    const pan = match[0];
    findings.push({
      type: 'FINANCIAL_ID',
      category: 'PAN Card',
      snippet: pan,
      severity: 'CRITICAL',
      confidence: 'High',
      reason: 'Permanent Account Number (PAN) detected.',
      suggestedRedaction: '[REDACTED_PAN]'
    });
  }

  // 5. US Social Security Number pattern: 3-2-4 digits
  const ssnRegex = /\b(\d{3}-\d{2}-\d{4})\b/g;
  while ((match = ssnRegex.exec(text)) !== null) {
    findings.push({
      type: 'NATIONAL_ID',
      category: 'Social Security Number',
      snippet: match[0],
      severity: 'CRITICAL',
      confidence: 'High',
      reason: 'US Social Security Number pattern detected.',
      suggestedRedaction: '[REDACTED_SSN]'
    });
  }

  // 6. Bank Account & Credit Card numbers (13-19 digits formatted)
  const cardRegex = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
  while ((match = cardRegex.exec(text)) !== null) {
    findings.push({
      type: 'FINANCIAL_ID',
      category: 'Payment Card',
      snippet: match[0],
      severity: 'CRITICAL',
      confidence: 'High',
      reason: 'Potential 16-digit credit/debit card number detected.',
      suggestedRedaction: '[REDACTED_CARD]'
    });
  }

  // 6B. UPI ID pattern (e.g. user@oksbi, payment@upi)
  const upiRegex = /\b[a-zA-Z0-9.\-_]{2,49}@(okaxis|okhdfcbank|okicici|oksbi|paytm|upi|ybl|axl|ibl|barodampay)\b/gi;
  while ((match = upiRegex.exec(text)) !== null) {
    findings.push({
      type: 'FINANCIAL_ID',
      category: 'UPI ID',
      snippet: match[0],
      severity: 'HIGH',
      confidence: 'High',
      reason: 'Personal UPI identifier detected. Should not be published without consent.',
      suggestedRedaction: '[REDACTED_UPI]'
    });
  }

  // 7. Residential Street Address patterns (e.g. "Flat 402, Shanti Apartments")
  const addressRegex = /\b(?:flat(?:\s+no\.?)?|house(?:\s+no\.?)?|plot(?:\s+no\.?)?|apt\.?)\s*\d+[\w\s,]{2,35}(?:apartment|apartments|society|colony|enclave|nagar|vihar|residency|sector\s*\d+)\b/gi;
  while ((match = addressRegex.exec(text)) !== null) {
    findings.push({
      type: 'RESIDENTIAL_ADDRESS',
      category: 'Private Residence',
      snippet: match[0],
      severity: 'HIGH',
      confidence: 'Moderate',
      reason: 'Specific private residential address detected. Publishing exact private addresses poses physical safety and harassment risks.',
      suggestedRedaction: '[REDACTED_RESIDENCE]'
    });
  }

  return findings;
}

// ============================================================================
// 4. DETERMINISTIC SOURCE & ATTRIBUTION CHECKER
// ============================================================================
/**
 * Evaluates the declared wire source, source URL, and in-text attribution.
 *
 * @param {Object} payload - Article payload (sourceName, sourceUrl, title, dek, body)
 * @returns {Object} Source attribution evaluation
 */
export function checkSourceAttribution(payload = {}) {
  const { sourceName, sourceUrl, title = '', body = '' } = payload;
  const findings = [];
  let status = 'VERIFIED';
  let isDeclaredWire = false;
  let wireDetails = null;

  // 1. Verify sourceName presence
  const cleanSourceName = (sourceName || '').trim();
  if (!cleanSourceName) {
    findings.push({
      code: 'MISSING_SOURCE_NAME',
      severity: 'HIGH',
      message: 'No wire service or source organization is declared in article metadata.'
    });
    status = 'ATTRIBUTION_MISSING';
  } else {
    // Check against recognized news agencies
    const lowerName = cleanSourceName.toLowerCase();
    const matchedWire = RECOGNIZED_WIRES.find(w =>
      w.aliases.some(alias => lowerName.includes(alias))
    );

    if (matchedWire) {
      isDeclaredWire = true;
      wireDetails = matchedWire;
    }
  }

  // 2. Validate sourceUrl
  const cleanSourceUrl = (sourceUrl || '').trim();
  let urlHostname = null;
  if (!cleanSourceUrl) {
    findings.push({
      code: 'MISSING_SOURCE_URL',
      severity: 'MEDIUM',
      message: 'No direct wire citation URL provided.'
    });
    if (status !== 'ATTRIBUTION_MISSING') {
      status = 'SOURCE_NEEDS_CHECKING';
    }
  } else {
    try {
      const parsedUrl = new URL(cleanSourceUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        findings.push({
          code: 'INVALID_URL_PROTOCOL',
          severity: 'HIGH',
          message: 'Wire URL must use http or https protocol.'
        });
        status = 'SOURCE_NEEDS_CHECKING';
      }
      urlHostname = parsedUrl.hostname.toLowerCase();

      // Check domain consistency if a recognized wire was declared
      if (wireDetails && wireDetails.domains.length > 0) {
        const domainMatches = wireDetails.domains.some(d => urlHostname.endsWith(d));
        if (!domainMatches) {
          findings.push({
            code: 'DOMAIN_MISMATCH',
            severity: 'HIGH',
            message: `Declared source is "${cleanSourceName}", but URL domain (${urlHostname}) does not match recognized domains for this agency.`
          });
          status = 'SOURCE_NEEDS_CHECKING';
        }
      }
    } catch (_) {
      findings.push({
        code: 'MALFORMED_SOURCE_URL',
        severity: 'HIGH',
        message: 'Provided source URL is malformed or unparseable.'
      });
      status = 'SOURCE_NEEDS_CHECKING';
    }
  }

  // 3. Scan for in-text attribution phrasing
  const fullText = (title + ' ' + body).toLowerCase();
  const attributionPhrases = [
    'according to', 'reported by', 'news agency', 'spokesperson said',
    'in a statement', 'official release', 'press release', 'told reporters',
    'confirmed by', 'briefed the press', 'quoted as saying'
  ];
  const hasInTextAttribution = attributionPhrases.some(phrase => fullText.includes(phrase));

  if (!hasInTextAttribution && !isDeclaredWire) {
    findings.push({
      code: 'WEAK_IN_TEXT_ATTRIBUTION',
      severity: 'MEDIUM',
      message: 'Article body lacks explicit attribution phrasing (e.g. "according to...", "reported by...").'
    });
    if (status === 'VERIFIED') {
      status = 'SOURCE_NEEDS_CHECKING';
    }
  }

  // 4. Check quotation attribution
  const quoteMatches = body.match(/"([^"]{15,200})"/g) || [];
  let unattributedQuotes = 0;
  for (const quote of quoteMatches) {
    // Check if within 50 chars before or after there is an attribution verb
    const quoteIndex = body.indexOf(quote);
    const surrounding = body.slice(Math.max(0, quoteIndex - 60), Math.min(body.length, quoteIndex + quote.length + 60)).toLowerCase();
    const hasVerb = /\b(?:said|stated|noted|remarked|added|warned|explained|told|recalled|observed|affirmed)\b/.test(surrounding);
    if (!hasVerb) {
      unattributedQuotes++;
    }
  }

  if (unattributedQuotes > 0) {
    findings.push({
      code: 'UNATTRIBUTED_QUOTES',
      severity: 'LOW',
      message: `${unattributedQuotes} quotation(s) lack an immediately identifiable speaker or attribution verb.`
    });
  }

  return {
    status,
    isDeclaredWire,
    declaredSource: cleanSourceName || null,
    sourceUrl: cleanSourceUrl || null,
    domain: urlHostname,
    hasInTextAttribution,
    unattributedQuotesCount: unattributedQuotes,
    findings
  };
}

// ============================================================================
// 5. DETERMINISTIC SENSITIVE STORY REVIEW
// ============================================================================
/**
 * Scans article for sensitive topics requiring ethical/statutory human review.
 *
 * @param {Object} payload - Article payload
 * @returns {Object} Sensitivity classification report
 */
export function checkSensitiveTopics(payload = {}) {
  const { title = '', dek = '', body = '', why_it_matters = '' } = payload;
  const text = `${title}\n${dek}\n${body}\n${why_it_matters}`;
  const flaggedTopics = [];

  for (const [key, config] of Object.entries(SENSITIVITY_TAXONOMY)) {
    if (config.regex.test(text)) {
      // Find sample matching snippets for transparent evidence
      const matches = [];
      const matchRegex = new RegExp(config.regex.source, 'gi');
      let m;
      while ((m = matchRegex.exec(text)) !== null && matches.length < 3) {
        const start = Math.max(0, m.index - 30);
        const end = Math.min(text.length, m.index + m[0].length + 30);
        matches.push(text.slice(start, end).trim().replace(/\s+/g, ' '));
      }

      flaggedTopics.push({
        topicId: key,
        key: key,
        label: config.label,
        severity: config.severity,
        evidence: matches,
        statutoryNote: config.statutoryNote,
        recommendation: `Requires editorial/legal review under ${config.label} guidelines.`
      });
    }
  }

  return {
    isSensitive: flaggedTopics.length > 0,
    count: flaggedTopics.length,
    flaggedTopics
  };
}

// ============================================================================
// 6. DETERMINISTIC IMAGE & MEDIA RIGHTS CHECKER
// ============================================================================
/**
 * Verifies hero image attribution and licensing indicators.
 *
 * @param {Object} payload - Article payload (image, imageCredit, imageAlt)
 * @returns {Object} Media rights status
 */
export function checkMediaRights(payload = {}) {
  const { image, imageCredit, imageAlt } = payload;
  const findings = [];
  let status = 'VERIFIED';

  const cleanImage = (image || '').trim();
  const cleanCredit = (imageCredit || '').trim();

  if (!cleanImage) {
    return {
      status: 'VERIFIED',
      hasImage: false,
      message: 'Article has no hero image; media rights not applicable.',
      findings: []
    };
  }

  // Check if credit is provided
  if (!cleanCredit) {
    findings.push({
      code: 'MISSING_IMAGE_CREDIT',
      severity: 'HIGH',
      message: 'Hero image is present but has zero attribution or photographer/wire credit.'
    });
    status = 'NEEDS CREDIT';
  } else {
    const lowerCredit = cleanCredit.toLowerCase();

    // Check for recognized wire/syndication credit
    const isRecognizedWire = RECOGNIZED_PHOTO_CREDITS.some(c => lowerCredit.includes(c));

    // Check for generic non-credits
    const genericNonCredits = ['file photo', 'internet', 'web', 'representative image', 'source', 'photo'];
    const isGeneric = genericNonCredits.some(g => lowerCredit === g);

    if (isGeneric) {
      findings.push({
        code: 'GENERIC_IMAGE_CREDIT',
        severity: 'MEDIUM',
        message: `Credit "${cleanCredit}" is generic and does not identify the licensing agency or copyright owner.`
      });
      status = 'RIGHTS UNKNOWN';
    } else if (!isRecognizedWire) {
      // Third-party or social screenshot
      if (lowerCredit.includes('x /') || lowerCredit.includes('twitter') || lowerCredit.includes('instagram') || lowerCredit.includes('facebook') || lowerCredit.includes('screenshot')) {
        findings.push({
          code: 'SOCIAL_MEDIA_SCREENSHOT',
          severity: 'MEDIUM',
          message: 'Media appears to be a social media screenshot. Confirm fair dealing justification or copyright holder permission.'
        });
        status = 'RIGHTS UNKNOWN';
      }
    }

    // Check for AI-generated image disclosure
    if (lowerCredit.includes('ai') || lowerCredit.includes('generated') || lowerCredit.includes('dall-e') || lowerCredit.includes('midjourney')) {
      findings.push({
        code: 'AI_GENERATED_MEDIA',
        severity: 'LOW',
        message: 'Image is identified as AI-generated. Labeling meets disclosure standards.'
      });
    }
  }

  return {
    status,
    hasImage: true,
    imagePath: cleanImage,
    credit: cleanCredit || null,
    alt: (imageAlt || '').trim() || null,
    findings
  };
}

// ============================================================================
// 7. DETERMINISTIC FACT & CLAIM EXTRACTOR
// ============================================================================
/**
 * Extracts factual, numerical, temporal, quotation, and causal claims.
 *
 * @param {Object} payload - Article payload
 * @returns {Array<Object>} Extracted claims with initial deterministic grounding
 */
export function extractFactualClaims(payload = {}) {
  const { title = '', dek = '', body = '', sourceName = '' } = payload;
  const claims = [];
  let claimCounter = 1;

  // 1. Numerical & Statistical claims
  const numRegex = /\b(?:\d{1,4}(?:,\d{3})*(?:\.\d+)?%?|\$\d+(?:\.\d+)?(?:\s*(?:million|billion|trillion))?|₹\d+(?:\.\d+)?(?:\s*(?:crore|lakh|million|billion))?|rs\.?\s*\d+)\b/gi;
  const sentences = body.split(/(?<=[.?!])\s+/);

  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length < 20) continue;

    if (numRegex.test(trimmed)) {
      claims.push({
        id: `claim_${claimCounter++}`,
        claimText: trimmed.slice(0, 180),
        claimType: 'statistic',
        location: 'body',
        sourceEvidence: sourceName ? `Declared Wire (${sourceName})` : null,
        verificationStatus: sourceName ? 'SUPPORTED_BY_SOURCE' : 'UNATTRIBUTED_ASSERTION',
        confidence: sourceName ? 'High' : 'Needs Corroboration',
        reason: sourceName
          ? `Numerical reporting backed by declared wire attribution (${sourceName}).`
          : 'Numerical statistic presented without an explicit wire citation.',
        checkedAt: new Date().toISOString()
      });
      if (claims.length >= 8) break; // Keep bounded
    }
  }

  // 2. Direct quotations
  const quoteMatches = body.match(/"([^"]{20,200})"/g) || [];
  for (const q of quoteMatches) {
    claims.push({
      id: `claim_${claimCounter++}`,
      claimText: q,
      claimType: 'quotation',
      location: 'body',
      sourceEvidence: sourceName ? `Attributed in dispatch (${sourceName})` : null,
      verificationStatus: 'SUPPORTED_BY_SOURCE',
      confidence: 'High',
      reason: 'Direct quotation captured in dispatch text.',
      checkedAt: new Date().toISOString()
    });
    if (claims.length >= 12) break;
  }

  // 3. Superlative & high-impact assertions in headline
  const superlativeRegex = /\b(?:first ever|record-breaking|all-time high|worst in history|largest ever|unprecedented|historic victory)\b/i;
  if (superlativeRegex.test(title)) {
    claims.push({
      id: `claim_${claimCounter++}`,
      claimText: title,
      claimType: 'superlative',
      location: 'headline',
      sourceEvidence: null,
      verificationStatus: 'UNATTRIBUTED_ASSERTION',
      confidence: 'Needs Corroboration',
      reason: 'Headline contains high-impact superlative claim. Verify historical precedent in wire report.',
      checkedAt: new Date().toISOString()
    });
  }

  // 4. Temporal / Date claims (e.g. October 15, 2025)
  const dateRegex = /\b(?:on\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*\d{4})?\b|\b(?:in|by)\s+20\d{2}\b/i;
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length < 20) continue;
    if (dateRegex.test(trimmed)) {
      claims.push({
        id: `claim_${claimCounter++}`,
        claimText: trimmed.slice(0, 180),
        claimType: 'temporal_date',
        location: 'body',
        sourceEvidence: sourceName ? `Declared Wire (${sourceName})` : null,
        verificationStatus: sourceName ? 'SUPPORTED_BY_SOURCE' : 'UNATTRIBUTED_ASSERTION',
        confidence: sourceName ? 'High' : 'Needs Corroboration',
        reason: 'Specific chronological or date assertion.',
        checkedAt: new Date().toISOString()
      });
      if (claims.length >= 16) break;
    }
  }

  return claims;
}

// ============================================================================
// 8. TIER 1: MULTI-PROVIDER AI VERIFICATION WATERFALL
// ============================================================================
/**
 * Evaluates claims using available free-first AI providers with strict timeouts
 * and graceful degradation.
 *
 * @param {Array<Object>} claims - Extracted claims
 * @param {Object} payload - Article payload
 * @param {Object} env - Worker environment bindings
 * @returns {Promise<{ aiAttempted: boolean, aiStatus: string, claims: Array<Object>, providerUsed?: string }>}
 */
export async function verifyClaimsWithAi(claims = [], payload = {}, env = {}) {
  if (!claims || claims.length === 0) {
    return { aiAttempted: false, aiStatus: 'SKIPPED', claims };
  }

  // Build compact verification prompt
  const compactClaims = claims.slice(0, 6).map(c => ({ id: c.id, text: c.claimText, type: c.claimType }));
  const systemPrompt = `You are a strict editorial fact-checking assistant for SamacharDaily.
Evaluate whether the extracted claims are supported by the provided article context and wire source.
Respond ONLY with a valid JSON object matching this schema:
{
  "evaluatedClaims": [
    {
      "id": "claim_id",
      "status": "SUPPORTED_BY_SOURCE" | "UNATTRIBUTED_ASSERTION" | "CONFLICTING_EVIDENCE" | "UNABLE_TO_VERIFY",
      "confidence": "High" | "Moderate" | "Needs Corroboration",
      "reason": "Brief editorial rationale (under 15 words)"
    }
  ]
}`;

  const userPrompt = `Headline: ${payload.title || ''}
Wire Source: ${payload.sourceName || 'None declared'} (${payload.sourceUrl || 'None'})
Article Summary: ${(payload.dek || '').slice(0, 200)}
Body Excerpt: ${(payload.body || '').slice(0, 1500)}

Claims to evaluate:
${JSON.stringify(compactClaims)}`;

  // Multi-provider configuration pool (Free-first)
  const providers = [];

  // Provider 1: Groq
  if (env.GROQ_API_KEY) {
    providers.push({
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600
      })
    });
  }

  // Provider 2: Gemini
  if (env.GEMINI_API_KEY) {
    providers.push({
      name: 'Gemini',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
      })
    });
  }

  // Provider 3: OpenRouter Free Pool
  if (env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://samachardaily.com',
        'X-Title': 'SamacharDaily Editorial Safety'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600
      })
    });
  }

  // Provider 4: Cloudflare Workers AI
  if (env.AI && typeof env.AI.run === 'function') {
    providers.push({
      name: 'CloudflareWorkersAI',
      isWorkersAi: true
    });
  }

  // If zero AI providers configured in env, return safe fallback
  if (providers.length === 0) {
    return {
      aiAttempted: false,
      aiStatus: 'UNABLE_TO_VERIFY',
      reason: 'No external AI provider configured. Deterministic claim verification active.',
      claims: claims.map(c => ({
        ...c,
        verificationStatus: c.verificationStatus || 'UNABLE_TO_VERIFY'
      }))
    };
  }

  // Execute waterfall with strict 5-second per-provider timeout
  for (const prov of providers) {
    try {
      let rawText = '';

      if (prov.isWorkersAi) {
        const aiRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]
        });
        rawText = aiRes.response || '';
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(prov.url, {
          method: 'POST',
          headers: prov.headers,
          body: prov.body,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) continue; // Cascade to next provider
        const respJson = await resp.json();

        if (prov.name === 'Gemini') {
          rawText = respJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          rawText = respJson.choices?.[0]?.message?.content || '';
        }
      }

      // Parse and validate AI JSON response safely
      const parsed = JSON.parse(rawText.trim());
      if (parsed && Array.isArray(parsed.evaluatedClaims)) {
        const resultMap = new Map();
        for (const ec of parsed.evaluatedClaims) {
          if (ec.id && ec.status) resultMap.set(ec.id, ec);
        }

        const mergedClaims = claims.map(c => {
          if (resultMap.has(c.id)) {
            const aiEval = resultMap.get(c.id);
            return {
              ...c,
              verificationStatus: aiEval.status,
              confidence: aiEval.confidence || c.confidence,
              reason: aiEval.reason || c.reason
            };
          }
          return c;
        });

        return {
          aiAttempted: true,
          aiStatus: 'VERIFIED',
          providerUsed: prov.name,
          claims: mergedClaims
        };
      }
    } catch (_) {
      // Continue to next tier in waterfall on timeout or parse error
    }
  }

  // All AI tiers failed or timed out: Safe degradation (NEVER PASS, NEVER CRASH)
  return {
    aiAttempted: true,
    aiStatus: 'UNABLE_TO_VERIFY',
    reason: 'All configured AI verification tiers were unavailable or timed out.',
    claims: claims.map(c => ({
      ...c,
      verificationStatus: c.verificationStatus === 'SUPPORTED_BY_SOURCE' ? c.verificationStatus : 'UNABLE_TO_VERIFY'
    }))
  };
}

// ============================================================================
// 9. UNIFIED SAFETY GATE EVALUATOR
// ============================================================================
/**
 * Synthesizes all checks into a definitive descriptive gate:
 * PASS | NEEDS_REVIEW | BLOCKED
 *
 * @param {Object} checkResults - Consolidated findings
 * @returns {{ gate: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED', reasons: string[] }}
 */
export function evaluateSafetyGate(checkResults = {}) {
  const { pii, source, sensitivity, media, claims, aiStatus } = checkResults;
  const reasons = [];
  let gate = 'PASS';

  // 1. Check for HARD BLOCK conditions (High-confidence deterministic failures only)
  // Condition 1A: Critical / High severity private PII detected
  const criticalPii = (pii || []).filter(p => p.severity === 'CRITICAL' || p.severity === 'HIGH');
  if (criticalPii.length > 0) {
    gate = 'BLOCKED';
    reasons.push(`BLOCKED: ${criticalPii.length} sensitive private PII item(s) detected (${criticalPii.map(p => p.category).join(', ')}). Must redact before saving.`);
  }

  // Condition 1B: Complete absence of source attribution on an active dispatch
  if (source && source.status === 'ATTRIBUTION_MISSING') {
    gate = 'BLOCKED';
    reasons.push('BLOCKED: Article completely lacks a declared wire source or organization attribution.');
  }

  // If already BLOCKED, return immediately
  if (gate === 'BLOCKED') {
    return { gate, reasons };
  }

  // 2. Check for NEEDS_REVIEW conditions (Advisory editorial checkpoints)
  // Condition 2A: Medium/Low severity PII
  const moderatePii = (pii || []).filter(p => p.severity === 'MEDIUM');
  if (moderatePii.length > 0) {
    gate = 'NEEDS_REVIEW';
    reasons.push(`Editorial Review: ${moderatePii.length} contact/email item(s) require verification of public interest.`);
  }

  // Condition 2B: Sensitive story category triggered
  if (sensitivity && sensitivity.isSensitive) {
    gate = 'NEEDS_REVIEW';
    reasons.push(`Sensitive Story: Classified under ${sensitivity.count} sensitive guideline(s) (${sensitivity.flaggedTopics.map(t => t.label).join(', ')}). Requires editorial sign-off.`);
  }

  // Condition 2C: Source needs checking (domain mismatch, broken URL)
  if (source && (source.status === 'SOURCE_NEEDS_CHECKING' || source.status === 'CONFLICTING_EVIDENCE')) {
    gate = 'NEEDS_REVIEW';
    reasons.push('Source Verification: Declared source domain or URL requires editorial confirmation.');
  }

  // Condition 2D: Media rights need credit
  if (media && (media.status === 'NEEDS CREDIT' || media.status === 'RIGHTS UNKNOWN')) {
    gate = 'NEEDS_REVIEW';
    reasons.push(`Media Rights: Hero image is ${media.status.toLowerCase()}. Photo credit must be documented.`);
  }

  // Condition 2E: Claims with conflicting evidence or unattributed assertions
  const problematicClaims = (claims || []).filter(c => c.verificationStatus === 'CONFLICTING_EVIDENCE' || c.verificationStatus === 'UNATTRIBUTED_ASSERTION');
  if (problematicClaims.length > 0) {
    gate = 'NEEDS_REVIEW';
    reasons.push(`Unverified Claims: ${problematicClaims.length} assertion(s) lack direct wire support or have conflicting numbers.`);
  }

  // Condition 2F: AI verification unavailable
  if (aiStatus === 'UNABLE_TO_VERIFY') {
    gate = 'NEEDS_REVIEW';
    reasons.push('AI Verification: Automated claim corroboration unavailable; manual claim review required.');
  }

  if (reasons.length === 0) {
    reasons.push('All deterministic and corroboration checks passed cleanly. Article is clear for editorial publishing.');
  }

  return { gate, reasons };
}

// ============================================================================
// 10. REVISION-BOUND CACHE & KV HELPERS
// ============================================================================
/**
 * Computes deterministic revision key ensuring SHA-binding.
 *
 * @param {string} slug - Article slug
 * @param {string} [sha] - Git commit SHA
 * @param {string} [contentFallback] - Fallback content if SHA is not yet committed
 * @returns {string} Safe KV key
 */
export function getRevisionKey(slug, sha, contentFallback = '') {
  const cleanSlug = (slug || 'unnamed').replace(/[^a-zA-Z0-9_-]/g, '_');
  let rev = (sha || '').trim();

  if (!rev && contentFallback) {
    // Generate simple hash from content fallback
    let hash = 0;
    for (let i = 0; i < contentFallback.length; i++) {
      hash = ((hash << 5) - hash) + contentFallback.charCodeAt(i);
      hash |= 0;
    }
    rev = 'h_' + Math.abs(hash).toString(16);
  }

  return `safety:art:${cleanSlug}:${rev || 'current'}`;
}

export function getSignoffKey(slug, sha) {
  const cleanSlug = (slug || 'unnamed').replace(/[^a-zA-Z0-9_-]/g, '_');
  const rev = (sha || '').trim();
  return `safety:rev:${cleanSlug}:${rev || 'current'}`;
}

// ============================================================================
// 11. MAIN ORCHESTRATOR
// ============================================================================
/**
 * Executes complete Phase 9 safety analysis pipeline.
 *
 * @param {Object} payload - Article content payload
 * @param {Object} env - Worker environment
 * @param {Object} [options] - Optional flags (skipAi, cachedOnly)
 * @returns {Promise<Object>} Full safety report
 */
export async function checkArticleSafety(payload = {}, env = {}, options = {}) {
  const { title = '', dek = '', body = '', slug = '', sha = '', sourceName = '', sourceUrl = '', image = '', imageCredit = '', imageAlt = '' } = payload;
  const fullText = `${title}\n${dek}\n${body}`;

  // 1. Tier 0 Deterministic Checks
  const pii = detectPii(fullText);
  const source = checkSourceAttribution({ sourceName, sourceUrl, title, body });
  const sensitivity = checkSensitiveTopics(payload);
  const media = checkMediaRights({ image, imageCredit, imageAlt });
  // 2. Factual Claims: Deterministic Extraction Only
  // NOTE: Automatic AI claim verification is intentionally disabled in Phase 9 to protect publishing pipeline quotas.
  const rawClaims = extractFactualClaims(fullText, { sourceName, sourceUrl });
  let claims = rawClaims.map(c => {
    if (c.verificationStatus === 'SUPPORTED_BY_SOURCE') {
      return c;
    }
    return {
      ...c,
      verificationStatus: c.verificationStatus || 'REQUIRES_MANUAL_VERIFICATION',
      reason: c.reason || 'Claim extracted; automatic external verification is not enabled. Verify manually against cited wire report.'
    };
  });
  let aiStatus = 'DISABLED';
  let providerUsed = null;

  // Optional isolated manual AI invocation only if explicitly requested:
  if (options && options.manualAiRequested === true && rawClaims.length > 0) {
    const aiResult = await verifyClaimsWithAi(rawClaims, payload, env);
    claims = aiResult.claims || rawClaims;
    aiStatus = aiResult.aiStatus;
    providerUsed = aiResult.providerUsed || null;
  }

  // 3. Compute Unified Gate
  const gateResult = evaluateSafetyGate({ pii, source, sensitivity, media, claims, aiStatus });

  // 4. Assemble Full Report
  const timestamp = new Date().toISOString();
  const report = {
    slug,
    sha: sha || null,
    gate: gateResult.gate, // "PASS" | "NEEDS_REVIEW" | "BLOCKED"
    reasons: gateResult.reasons,
    aiStatus,
    providerUsed,
    aiCallsMade: providerUsed ? 1 : 0,
    timestamp,
    checks: {
      privacy: {
        status: pii.length === 0 ? 'PASS' : (pii.some(p => p.severity === 'CRITICAL' || p.severity === 'HIGH') ? 'BLOCKED' : 'NEEDS_REVIEW'),
        count: pii.length,
        findings: pii
      },
      sourceAttribution: source,
      sensitivity: sensitivity,
      mediaRights: media,
      claims: {
        total: claims.length,
        supported: claims.filter(c => c.verificationStatus === 'SUPPORTED_BY_SOURCE').length,
        unattributed: claims.filter(c => c.verificationStatus === 'UNATTRIBUTED_ASSERTION').length,
        conflicting: claims.filter(c => c.verificationStatus === 'CONFLICTING_EVIDENCE').length,
        unableToVerify: claims.filter(c => c.verificationStatus === 'UNABLE_TO_VERIFY' || c.verificationStatus === 'REQUIRES_MANUAL_VERIFICATION').length,
        items: claims,
        claims: claims,
        aiEnabled: Boolean(providerUsed),
        notice: 'Automatic AI verification is not enabled. For difficult claims, manually verify against the cited source.'
      }
    }
  };

  // 5. Persist to Revision-Bound KV cache if AUTH_KV is available
  let persisted = false;
  if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function' && slug && sha) {
    const cacheKey = getRevisionKey(slug, sha);
    try {
      // 30 days expiration TTL (2,592,000 seconds)
      await env.AUTH_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: 2592000 });
      persisted = true;
    } catch (kvErr) {
      console.error('[Safety KV Error] Failed to persist safety cache:', kvErr.message);
    }
  }

  report.persisted = persisted;
  return report;
}
