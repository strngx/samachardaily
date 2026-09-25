# PHASE 4C — Deep Article Generation & Editorial Depth Implementation Report

- **Document Date:** September 26, 2026
- **Repository:** `strngx/samachardaily`
- **Phase:** 4C — Deep Article Generation & Editorial Depth Implementation
- **Execution Mode:** Controlled / Limited Write
- **Final Status:** **PASS**

---

## 1. Phase Status
- **Overall Status:** **PASS**
- **Grounding Architecture:** Phase 4B multi-source research, clustering, syndication detection, and intermediate Fact Sheet evidence grounding contracts preserved 100%.
- **Depth Architecture:** Deterministic evidence-density depth engine implemented. Replaced shallow 200–350 word caps with an evidence-driven depth contract (targets: ~700–1,000+ words for high evidence, ~500–800 words for moderate evidence, ~250–400 concise words for low evidence).
- **Quality & Safety Gates:** Depth quality gate, anti-padding detection, claim coverage signal, and single controlled retry limit operational.
- **Historical Safety:** 0 historical article Markdown files modified. Historical corpus (1,249 published articles) remains immutable.
- **Protected Files:** SHA-256 hashes for all 3 protected files verified byte-for-byte identical.
- **Build Status:** Eleventy build passed with exit code 0 (1,284 files written, 0 errors).
- **Unit Test Suite:** 20 / 20 synthetic unit tests passed (100%).

---

## 2. Exact Files Modified
In Phase 4C, modifications were strictly restricted to the generation and verification pipeline:

| File Path | Nature of Change | Scope |
| :--- | :--- | :--- |
| `Code.gs` | Production Google Apps Script pipeline | Added `evaluateEvidenceDensity_`, `validateArticleDepthAndQuality_`, upgraded `rewriteWithGroq_` system prompt and dynamic token reservation, integrated depth quality gate with single controlled retry into `runPipelineForCategory_`. |
| `tools/test-multi-source.js` | Test verification suite | Upgraded test suite with full 20-test coverage for evidence density, anti-padding, short-format exemption, single retry limit, and protected file integrity. |
| `tools/validate-build.js` | Build validation helper | Verification script for Eleventy build output, canonicals, NewsArticle schema, BreadcrumbList schema, sitemap, and RSS feed. |

*Note: Zero historical article Markdown files were modified, created, or deleted in this phase.*

---

## 3. Exact Functions Changed
The following functions were created or upgraded in `Code.gs`:

1. `evaluateEvidenceDensity_(factSheet, cluster, candidate)` **(NEW)**:
   - Deterministically analyzes available evidence across bounded sources, atomic claims, corroborated claims, numerical specifics, and dates.
   - Categorizes stories into `HIGH_DENSITY`, `MODERATE_DENSITY`, or `LOW_DENSITY` tiers with defined target word ranges and recommended section progressions.
2. `validateArticleDepthAndQuality_(article, factSheet, evidenceDensity, shortFormatType, isRetry)` **(NEW)**:
   - Post-synthesis quality gate evaluating body word count against evidence density, identifying under-generation on rich evidence (minimum 450-word floor for high density).
   - Detects paragraph repetition (Jaccard similarity $\ge 0.65$) and prohibited AI clichés/fillers.
   - Calculates Fact-Sheet claim coverage percentage (flags $<25\%$ on rich evidence).
   - Exempts legitimate short formats (`shortFormatType !== 'standard'`).
   - Restricts depth retries to a maximum of one controlled attempt (`action: 'retry_depth'`), falling back to draft review (`action: 'stage_draft'`) if under-generation persists.
3. `rewriteWithGroq_(headline, category, config, cluster, factSheet)` **(UPGRADED)**:
   - Replaced 200–350 word caps with the evidence-driven depth contract based on `evidenceDensity`.
   - Injected thematic section progression instructions (`content[]` with structured subheadings when supported).
   - Re-anchored anti-padding, zero-hallucination, and anti-cliché directives.
   - Made token reservations dynamic (`maxTokens`: 2800 for high density, 2400 for moderate, 1800 for low) while respecting the 200,000 daily TPD guardrail.
4. `runPipelineForCategory_(categoryKey)` **(UPGRADED)**:
   - Integrated `evaluateEvidenceDensity_` and `validateArticleDepthAndQuality_` into the post-synthesis pipeline.
   - Implemented single controlled regeneration attempt on rich evidence under-generation (`selectedCandidate.enforceDepth = true`).
   - Routes runs to draft staging (`selectedCandidate._forceDraft = true`) if under-generation persists, if padding/clichés are detected, or if claim coverage is insufficient.

---

## 4. Old Generation-Depth Behavior
- In Phase 4B and earlier pipelines, `rewriteWithGroq_` contained an explicit instruction capping generated output:
  > *"Produce substantive, structured coverage across 2–4 clean paragraphs (typically 200–350 words when supported by source material)."*
- Even when multi-source clustering and a comprehensive Fact Sheet provided 4+ corroborated claims, multiple independent dispatches, official statements, and technical details, the LLM compressed the story into a brief wire summary of 250–350 words.
- No evidence density evaluation existed; the same length instruction was applied to rich investigative multi-source stories as to brief single-source bulletins.
- No automated post-synthesis check monitored whether rich evidence had been discarded or compressed away.

---

## 5. New Generation-Depth Behavior
- Generation depth is now deterministically scaled to available verified evidence.
- When rich multi-source or substantive single-source evidence is present, the LLM is instructed to generate detailed, structured articles across distinct thematic sections.
- Target word ranges are editorial benchmarks, governed by the primary rule:
  $$\text{USEFUL VERIFIED INFORMATION} > \text{WORD COUNT}$$
- The system never pads low-evidence dispatches. If evidence is thin, it produces a concise, high-density factual brief (250–400 words) with zero filler.
- If rich evidence exists but the LLM returns an unusually short summary ($<450$ words), the pipeline initiates a single controlled retry with depth enforcement, and stages the article for human review if depth is not achieved.

---

## 6. Evidence-Density Logic
The `evaluateEvidenceDensity_` function calculates metrics from the Phase 4B Fact Sheet and bounded source cluster:
- **Independent Sources:** Number of distinct, non-syndicated news outlets in the cluster.
- **Atomic Claims:** Total claims extracted in `factSheet.claims`, count of corroborated claims (`CORROBORATED`), and count of disputed claims (`DISPUTED`).
- **Total Source Words:** Real word count across bounded sources (`countCandidateSourceWords_`).
- **Numerical Details:** Count of concrete numbers, percentages, and financial figures (Rs., ₹, crore, lakh, %, $, billion).
- **Temporal Details:** Count of verified dates, months, days, and timeline markers.

### Tier Classification Matrix:
1. **`HIGH_DENSITY`**:
   - Condition A: Independent multi-source corroboration ($\ge 2$ sources or `corroborationStatus === 'corroborated'`) AND $\ge 3$ atomic claims AND $\ge 120$ total source words; OR
   - Condition B: Rich single source with $\ge 150$ total source words AND ($\ge 3$ atomic claims OR $\ge 3$ numerical details); OR
   - Condition C: Extensive total source text $\ge 280$ words.
   - **Target:** 700–1,000+ useful body words.
   - **Max Completion Tokens:** 2,800 (Groq) / 3,000 (Retry).
2. **`MODERATE_DENSITY`**:
   - Condition: Total source words $\ge 100$ OR claims $\ge 3$ OR independent sources $\ge 2$.
   - **Target:** 500–800 useful body words.
   - **Max Completion Tokens:** 2,400.
3. **`LOW_DENSITY`**:
   - Condition: Thin single source with $<100$ words and $<3$ atomic claims.
   - **Target:** 250–400 concise words. Zero artificial padding.
   - **Max Completion Tokens:** 1,800.

---

## 7. New Article Structure Rules
For moderate and high evidence density stories, the synthesis contract requires structuring information into distinct thematic sections within `content[]`:
1. **What Happened & Immediate Developments:** Lead news narrative establishing core verified event without repeating the dek.
2. **Key Evidentiary & Operational Details:** Specific data points, figures, prices, technical specifications, and legal status.
3. **Background & Underlying Context:** Documented previous inquiries, regulatory framework, or chronological precedent explicitly in the source.
4. **Stakeholder Actions & Official Responses:** Attributed statements from authorities, affected parties, or company representatives.
5. **Documented Timelines & What Happens Next:** Concrete upcoming dates, hearings, launches, or deadlines explicitly supported by evidence.

**Section Discipline:**
- Factual subheadings (e.g., `## Operational Details`, `## Regulatory Timeline`) are used only when supported by documented facts.
- Headings are never forced when factual backing is absent.
- Generic placeholders and empty headers are strictly prohibited.

---

## 8. Article-Length Policy
The governing rule for Samachar Daily editorial depth is:
$$\text{USEFUL VERIFIED INFORMATION} > \text{WORD COUNT}$$

| Story Category | Evidence Density | Target Body Words | Structural Expectation |
| :--- | :--- | :--- | :--- |
| **Standard News** | Moderate | ~500–800 words | 3–4 thematic sections, contextual grounding |
| **Important / Developing** | High | ~700–1,000 words | 4–5 thematic sections, comprehensive evidence |
| **Explainers / Context-Heavy** | High | ~800–1,200+ words | Deep breakdown, operational & background specifics |
| **Major Multi-Source** | High (Corroborated) | May exceed 1,000 words | Multi-angle synthesis across independent sources |
| **Low Evidence / Brief** | Low | ~250–400 words | Concise factual brief, zero padding |
| **Legitimate Short Formats** | Any (Exempt) | Concise as warranted | Bulletins, alerts, scorecards (~80–200 words) |

---

## 9. Anti-Padding Logic
The `validateArticleDepthAndQuality_` gate actively inspects generated body text to prevent artificial expansion:
1. **Paragraph Duplication & Repetition:**
   - Evaluates Jaccard similarity across word sets between all pairs of paragraphs.
   - Any pair of paragraphs ($\ge 15$ words) exhibiting $\ge 65\%$ keyword overlap is flagged as repetitive padding (`action: 'stage_draft'`).
2. **Generic AI Cliché & Filler Ban:**
   - Detects formulaic transition and importance clichés:
     `"In a major development"`, `"This comes amid"`, `"The development marks a significant"`, `"It remains to be seen"`, `"highlights the importance"`, `"Going forward"`, `"game changer"`, `"transform the industry"`, `"consumers will benefit significantly"`.
   - Matching multiple cliché patterns flags the run for human draft review.
3. **Prohibited Hallucination:**
   - Strict ban on invented statistics, quotes, reactions, expert opinions, background facts, timelines, causes, motivations, prices, casualty numbers, election figures, or financial advice.

---

## 10. Depth Quality Gate
- Located in `Code.gs` (`validateArticleDepthAndQuality_`) and executed in `runPipelineForCategory_` after English language and output structure validation.
- Logic:
  - If story is `HIGH_DENSITY` evidence AND not a legitimate short format:
    - Minimum word count floor: **450 words**.
    - If `wordCount < 450` on initial run (`isRetry === false`): triggers `action: 'retry_depth'`.
    - If `wordCount < 450` persists on retry (`isRetry === true`): triggers `action: 'stage_draft'`.
- The depth gate does NOT discard under-generated stories; it stages them in `src/drafts/` with `review_required: true` so editors can manually review or expand them.

---

## 11. Revision-Attempt Limit
- **Hard Limit:** Exactly **ONE** controlled depth-revision attempt.
- On first under-generation detection, `selectedCandidate.enforceDepth = true` is set, injecting a strict depth enforcement instruction into `rewriteWithGroq_`.
- If the second attempt fails or still falls below the 450-word floor, the pipeline retains the article, flags `selectedCandidate._forceDraft = true`, sets `article.status = 'draft'`, and publishes to the draft staging area.
- Infinite regeneration loops are mathematically impossible.

---

## 12. Source-to-Article Coverage Logic
- Evaluates whether atomic claims from `factSheet.claims` appear in `article.content`.
- Extracts keyword stems from each claim statement and checks against article body text.
- Claims with $\ge 40\%$ keyword representation are counted as covered.
- For `HIGH_DENSITY` stories with $\ge 3$ claims, if claim coverage falls below **25%**, the article is flagged as `LOW_COVERAGE` and routed to draft staging (`action: 'stage_draft'`).

---

## 13. Single-Source Behavior
- Single-source reporting is treated with full editorial credibility without fabricating multi-source corroboration.
- `corroboration_status` remains `single_source`.
- Rich single source with substantive dispatches ($\ge 150$ words, $\ge 3$ claims/numerical details) achieves `HIGH_DENSITY` tier and targets 700–1,000 words based strictly on that source.
- Concise single source remains `LOW_DENSITY` and targets 250–400 concise words.
- Never displays "Multi-Source Corroborated" frontmatter unless Phase 4B independence analysis confirms independent corroboration.

---

## 14. Multi-Source Behavior
- When Phase 4B clustering identifies 2+ independent sources and establishes corroboration (`corroborationStatus === 'corroborated'`):
  - Synthesizes information into a cohesive narrative across thematic sections.
  - Avoids formulaic "Source A reported X, while Source B reported Y" phrasing.
  - Independently confirmed facts are stated once as established fact.
  - Compatible details from different outlets are combined into operational/background sections.
  - Additive YAML frontmatter (`sources:`, `role:`, `tier:`, `corroboration_status: "corroborated"`) is generated alongside scalar fallbacks (`sourceUrl:`, `sourceName:`).

---

## 15. Conflict Behavior
- Preserves Phase 4B material conflict governance 100%.
- If `material_conflicts_found === true`:
  - `_forceDraft = true` is enforced.
  - `review_required = true` is added to frontmatter.
  - Story is routed to `src/drafts/<category>/`.
  - Discrepancies (conflicting casualty numbers, contradictory official figures, differing dates) are stated neutrally without taking sides.
  - Deeper generation never overrides draft staging or silently resolves conflicts.

---

## 16. Political Neutrality Safeguards
- For politics, elections, and public policy disputes:
  - All claims are strictly attributed to the specific party, candidate, or official making them.
  - Explicit prompt prohibition against endorsements, candidate rankings, and election predictions.
  - Prohibition against voter-preference speculation or persuasive language.
  - Triggers `politics_elections` sensitive category and mandatory draft review (`review_required: true`).
  - Longer articles remain strictly neutral and balanced.

---

## 17. Sensitive-Topic Safeguards
- Sensitive topics continue to trigger mandatory human draft staging under `classifySensitiveTopic_`:
  1. `crime_legal`
  2. `fatalities_accidents`
  3. `politics_elections`
  4. `health_medicine` (includes `health_disclaimer: true`)
  5. `diet_nutrition_wellness` (includes `health_disclaimer: true`)
  6. `financial_markets`
- High evidence density NEVER bypasses human draft review for sensitive topics.

---

## 18. Short-Format Safeguards
- Preserves Phase B2 `classifyShortFormatType_` categories:
  - `sports_score_update`
  - `weather_emergency_alert`
  - `breaking_bulletin`
  - `official_notice_bulletin`
- Legitimate short formats are explicitly exempt from the high-evidence depth floor in `validateArticleDepthAndQuality_`.
- Conciseness is respected as journalistically complete; zero artificial padding is forced.

---

## 19. Phase 4B Compatibility
- Full compatibility with the Phase 4B architecture:
  $$\text{Discovery} \to \text{Normalization} \to \text{Clustering} \to \text{Independence Analysis} \to \text{Fact Sheet} \to \text{Grounding Contract} \to \text{Synthesis}$$
- Uses `<source_data>` delimiters to defend against prompt injection.
- Preserves additive `sources:` and `corroboration_status:` frontmatter schema.
- Retains backward-compatible scalar `sourceUrl:` and `sourceName:` fields.

---

## 20. Test Names and Results
Test Suite: `tools/test-multi-source.js` (Executed with Node.js v24.19.0)

| Test # | Test Name | Result |
| :---: | :--- | :---: |
| 1 | Low-evidence story remains concise without artificial padding | **PASS** |
| 2 | Moderate-evidence story generates substantive structure (target 500-800 words) | **PASS** |
| 3 | High-evidence story receives deep-generation instructions (target 700-1000+ words) | **PASS** |
| 4 | Rich single-source story can be long without fake corroboration | **PASS** |
| 5 | Multi-source corroborated story synthesizes multiple evidence categories | **PASS** |
| 6 | Conflict story with material discrepancy forces draft staging | **PASS** |
| 7 | Political story triggers sensitive governance and preserves neutrality | **PASS** |
| 8 | Sensitive story (legal/crime) mandates human draft review | **PASS** |
| 9 | Unsupported facts remain excluded via strict grounding contract | **PASS** |
| 10 | One controlled depth-revision attempt maximum (never loops infinitely) | **PASS** |
| 11 | Anti-padding check catches duplicate paragraphs and generic clichés | **PASS** |
| 12 | Legitimate short format remains concise without under-generation penalty | **PASS** |
| 13 | Existing Phase B2 source substance gate remains fully intact | **PASS** |
| 14 | AI synthesis waterfall falls back sequentially on errors | **PASS** |
| 15 | Groq daily TPD limit guardrail tracks budget and blocks overflow | **PASS** |
| 16 | Phase 4B Fact Sheet grounding contract preserves isolated passive data boundaries | **PASS** |
| 17 | Bounded sources array contains only real ingested candidates | **PASS** |
| 18 | Claims are strictly derived from source titles and text | **PASS** |
| 19 | Existing single-source fallback renders valid markdown frontmatter | **PASS** |
| 20 | Historical article corpus remains completely untouched (Protected file hashes) | **PASS** |

**Summary:** **20 / 20 PASSED (100%)**

---

## 21. Build Result
- Command: `npm run build`
- Exit Code: **0**
- Output: `Copied 24 Wrote 1284 files in 18.31 seconds (14.3ms each, v3.1.6)`
- Errors: **0**
- Warnings: **0**

---

## 22. Protected-File Hash Results
All 3 protected files verified via SHA-256 algorithm:

1. `src/articles/india/maruti-suzuki-launches-baleno-facelift-in-india-at-rs-610-lakh-ex-showroom.md`:
   - Expected: `f655f8025349672d6ff1ef84e82c9b52436cd84c8a97d50d6487f2b3e3f7834f`
   - Actual:   `f655f8025349672d6ff1ef84e82c9b52436cd84c8a97d50d6487f2b3e3f7834f`
   - Status:   **MATCH (Byte-for-byte identical)**

2. `src/articles/world/south-park-slams-trumps-geographic-renaming-in-season29-premiere.md`:
   - Expected: `40a540b0aa63b367b51375ccffe44d92a6d7c71b8393f1dbdd0ed51c5bd27c8c`
   - Actual:   `40a540b0aa63b367b51375ccffe44d92a6d7c71b8393f1dbdd0ed51c5bd27c8c`
   - Status:   **MATCH (Byte-for-byte identical)**

3. `src/articles/business/maruti-upgrades-baleno-with-new-engine-level2-adas-i20-altroz-remain-strong-rivals.md`:
   - Expected: `7f5b7f30eb08190b6f1be25b7bc49aa288c564791819d7056a030c09c246bf66`
   - Actual:   `7f5b7f30eb08190b6f1be25b7bc49aa288c564791819d7056a030c09c246bf66`
   - Status:   **MATCH (Byte-for-byte identical)**

---

## 23. Historical Corpus Verification
- Active published article count: **1,249 files** in `src/articles/`.
- Total historical article files modified in Phase 4C: **0**.
- Total historical article files deleted: **0**.
- Total historical article files added: **0**.
- Bulk regeneration performed: **None**. Historical corpus remains 100% untouched.

---

## 24. Git Diff Scope
- Changes made in Phase 4C are strictly limited to:
  - `Code.gs` (depth evaluation, updated synthesis prompt, depth quality gate)
  - `tools/test-multi-source.js` (Phase 4C 20-test test suite)
  - `tools/validate-build.js` (build verification script)
- Pre-existing uncommitted modifications from previous phases (2A–4B) were preserved without reset.
- Zero modifications to templates (`src/_includes/`), page layouts, or CSS in Phase 4C.

---

## 25. URL / Slug / Permalink Verification
- Representative article URL: `/articles/india/maruti-suzuki-launches-baleno-facelift-in-india-at-rs-610-lakh-ex-showroom/`
- Slug generation function (`generateSlug_`): Unchanged.
- URL structure: `articles/:category/:slug/` unchanged.
- Total URL changes: **0**.
- Total permalink changes: **0**.

---

## 26. Canonical Verification
- Verified via `tools/validate-build.js` on rendered HTML output.
- Every rendered article contains `<link rel="canonical" href="https://thesamachardaily.in/articles/:category/:slug/">`.
- Schema markup contains identical `@id` and `mainEntityOfPage` pointing to the canonical URL.

---

## 27. Sitemap / RSS Verification
- Sitemap (`_site/sitemap.xml`): Present, valid XML, contains all published articles and core site pages.
- RSS Feed (`_site/rss.xml`): Present, valid RSS 2.0 XML with Atom self link, contains latest 25 articles with full descriptions and metadata.
- Google News sitemap compliance (`isRecentArticle` 48-hour filter): Preserved.

---

## 28. Known Limitations
- When external source dispatches from upstream wire APIs (NewsData / Currents) provide very sparse text ($<100$ words), the article depth engine deliberately limits output to a 250–400 word brief to uphold the primary standard: **Useful Verified Information > Word Count**.
- In automated execution within Google Apps Script, token limits per invocation are constrained by the 200,000 Groq daily token budget (TPD guardrail); if Groq budget is exhausted, the pipeline seamlessly falls back to Gemini 3.6 Flash and OpenRouter.

---

## 29. Final PASS / FAIL Evaluation
All 20 synthetic tests pass, the Eleventy build passes with 0 errors, protected file hashes match byte-for-byte, the historical article corpus is 100% untouched, and all depth, anti-padding, and governance safeguards are fully operational.

**FINAL PHASE STATUS:** **PASS**
