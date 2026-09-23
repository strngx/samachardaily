# PHASE 11A — AUTHORSHIP, PUBLISHER IDENTITY & EDITORIAL TRUST FORENSIC AUDIT

**Project**: SamacharDaily SEO Rehabilitation  
**Live Site**: `https://thesamachardaily.in/`  
**Current Production Commit**: `6f04dfcb9a71a3e6f9a0cfaee1a31c5155f9a656` (`6f04dfc`)  
**Audit Mode**: STRICTLY READ-ONLY FORENSIC AUDIT  
**Timestamp**: 2026-09-23T16:22:00+05:30  

---

## 1. EXECUTIVE SUMMARY

This forensic audit evaluates SamacharDaily's authorship system, publisher entity representations, editorial policies, AI-assisted newsroom disclosures, source attribution, corrections procedures, and technical trust signals across the repository, static templates, automated pipeline (`Code.gs`), and live production deployment.

### Key Audit Findings:
1. **Author Architecture is Completely Missing**: There are no author profile pages, no author collections, no author data files, and no dedicated author routes (`/authors/` or `/author/`) in the Eleventy architecture.
2. **Homogeneous Generic Byline**: Out of 1,189 Markdown articles, 1,188 articles (99.92%) utilize the identical hardcoded generic byline `"SamacharDaily Editorial Team"`. Exactly 1 article contains a distinct string (`"Pooja Nair | SamacharDaily Policy Desk"`).
3. **Structured Data Author Typing Mismatch**: In `src/_includes/partials/jsonld-news.njk`, `NewsArticle.author` is emitted as `@type: Organization` pointing to the `/about/` page rather than a structured `@type: Person` or a clearly differentiated institutional desk entity.
4. **Transparent AI Disclosure Exists Publicly**: The public site explicitly discloses AI-assisted ingestion and synthesis in `/about/`, `/editorial/`, and `/terms/`, but article-level pages do not carry individual micro-disclosures or methodology badges.
5. **Robust Source Attribution Architecture**: 100% of articles contain a valid `sourceUrl` frontmatter property, and 1,176 articles contain an explicit `sourceName`. In addition, article templates render a visible, crawlable citation block (`"Reporting based on verified dispatches from [Outlet]"` with a direct outbound link).
6. **Editorial Accountability Gap**: While institutional contact emails (`samachardaily.editorial@gmail.com`) and operating hours are published, there is no identified Editor-in-Chief, named desk editor, or physical masthead structure.

---

## 2. CURRENT PUBLISHING MODEL

The site operates on a **hybrid automated and editorially enriched model**:
* **Automated Ingestion & Synthesis Engine (`Code.gs`)**: A Google Apps Script pipeline polls news APIs (`NewsData.io`, `Currents API`), applies language/quality filters, synthesizes dispatches via LLMs (Groq / Gemini / OpenRouter), retrieves licensed imagery via Pexels and related videos via YouTube, builds Markdown files with standardized frontmatter, and pushes commits directly to GitHub `main`.
* **Manual / Controlled SEO Enrichment Phases**: High-priority articles (P0 and P1 batches) undergo manual editorial validation, contextual deepening, and source cross-referencing to rectify thin content and eliminate speculative text.
* **Static Site Compilation**: Eleventy v3.1.6 builds the repository into static HTML on GitHub Pages.

---

## 3. ARTICLE BYLINE AUDIT

### Visible Byline Implementation
* **Article Template (`src/_includes/layouts/article.njk`, Lines 51–57)**:
  ```html
  <div class="article-byline-bar">
    <span>By <span class="byline-strong">{{ author or site.author.name }}</span></span>
    <span>•</span>
    <time datetime="{{ date | isoDate }}">{{ date | readableDate }}</time>
    <span>•</span>
    <span>{{ content | readTime }}</span>
  </div>
  ```
* **Hero Lead Story (`src/_includes/partials/hero.njk`, Line 64)**:
  ```html
  <span>By {{ leadStory.data.author or site.author.name }}</span>
  ```
* **Card Partial (`src/_includes/partials/card.njk`)**:
  Bylines are omitted from category grid cards and homepage feeds to prioritize title readability and publication velocity.

### Analysis of Byline Behavior
* **A. Visible text**: Almost universally displays `By SamacharDaily Editorial Team`.
* **B. Uniformity**: 1,188 of 1,189 articles render `"SamacharDaily Editorial Team"`.
* **C. Genuine named contributors**: None currently active across the automated pipeline. (One single legacy article in `src/articles/india/indian-airports-to-drop-boardingpass-stamps-for-international-departures-from-septemb.md` has `author: "Pooja Nair | SamacharDaily Policy Desk"`).
* **D. Differentiated authors**: None across the pipeline.
* **E. Author hyperlinks**: None. Visible bylines are unlinked plain text spans.
* **F. Resolution**: N/A (no links exist).
* **G. Indexability**: N/A (no author pages exist).
* **H. JSON-LD author presence**: Yes, present in all article schemas.
* **I. JSON-LD author type**: Emitted as `@type: Organization`.
* **J. Real/verifiable person**: No, represents an institutional pseudonym/team.
* **K. Contradictory values**: In the Pooja Nair article, the frontmatter name contains a person name, but JSON-LD types it as an `Organization` pointing to `/about/`.

---

## 4. AUTHOR ARCHITECTURE

```
AUTHOR ARCHITECTURE: MISSING
```

* **Author Directories**: None (`src/authors/`, `src/author/` do not exist).
* **Author Templates**: None.
* **Author Data Files**: None (`src/_data/authors.json` or `authors.js` does not exist).
* **Author Collections**: None in `.eleventy.js`.
* **Generated Author Routes**: 0 author pages generated.
* **Author Schema**: No `Person` entities or standalone `ProfilePage` schemas exist in the codebase.

---

## 5. ARTICLE FRONTMATTER

Across all 1,189 Markdown articles in `src/articles/`, the standardized frontmatter schema includes:

```yaml
---
title: "Article Title"
seoTitle: "SEO Title"
category: "India" # (India, World, Business, Tech, Sports)
date: 2026-08-31T13:32:39Z
image: "https://images.pexels.com/..."
imageAlt: "Descriptive alt text"
imageCredit: "Photographer / Platform"
trending: false
featured: false
video_id: "..."
video_caption: "..."
videos:
  - video_id: "..."
    title: "..."
    channel: "..."
slug: "article-slug"
sourceUrl: "https://..."
sourceName: "Source Outlet Name"
dek: "Concise article summary"
author: "SamacharDaily Editorial Team"
why_it_matters: |
  Contextual explanation...
what_happens_next: "Forward looking proceedings..."
---
```

### Observations:
* `author` is explicitly defined in frontmatter on 100% of articles, but hardcoded by `Code.gs` (Line 1875) as `"SamacharDaily Editorial Team"`.
* There are no frontmatter fields for `author_id`, `author_bio`, `editor`, `reviewer`, or `updated`.

---

## 6. NEWSARTICLE SCHEMA

In `src/_includes/partials/jsonld-news.njk` (Lines 20–33):

```json
"author": {
  "@type": "Organization",
  "name": "{{ author or site.author.name or 'SamacharDaily Editorial Team' }}",
  "url": "{{ site.author.url or (site.url + '/about/') }}"
},
"publisher": {
  "@type": "NewsMediaOrganization",
  "name": "{{ site.publisher.name or site.name or 'SamacharDaily' }}",
  "url": "{{ site.url }}/",
  "logo": {
    "@type": "ImageObject",
    "url": "{{ site.publisher.logo or (site.url + '/assets/images/logo.svg') }}"
  }
}
```

### Schema Analysis:
* `author` is typed as `@type: Organization` with URL pointing to `/about/`.
* `publisher` is typed as `@type: NewsMediaOrganization` with URL pointing to `https://thesamachardaily.in/` and SVG logo.
* `datePublished` is correctly formatted in ISO 8601 UTC.
* `dateModified` falls back to `datePublished` if no separate modified date is specified.

---

## 7. PUBLISHER IDENTITY

| Element | Public Representation | Evidence | Status |
| :--- | :--- | :--- | :--- |
| **Publisher Name** | SamacharDaily | `site.js`, templates, schemas | **VERIFIED** |
| **Brand Ownership** | Independent digital publication | `/about/`, `/contact/` | **VERIFIED** |
| **Legal Entity** | None stated (unincorporated digital portal) | `/terms/`, `/contact/` | **MISSING** |
| **Geographic Base** | India (UTC+5:30 operational desk) | `/contact/`, `site.js` | **VERIFIED** |
| **Editorial Desk** | SamacharDaily Editorial Desk | `/about/`, `/contact/` | **VERIFIED** |
| **Editor-in-Chief / Named Editor** | No individual named | `/about/`, `/editorial/` | **MISSING** |
| **Editorial Contact** | `samachardaily.editorial@gmail.com` | `/contact/`, `/editorial/` | **VERIFIED** |
| **Corrections Desk** | `samachardaily.editorial@gmail.com` | `/contact/`, `/editorial/` | **VERIFIED** |

---

## 8. ABOUT PAGE AUDIT (`src/pages/about.md`)

* **Self-Description**: "An independent digital news publication dedicated to delivering fast, verified, and deeply contextualized reporting across India and the world."
* **Coverage Scope**: 5 core categories: India, World, Business, Tech, Sports.
* **Editorial Framework**: Explanatory triad model: *1. What happened? 2. Why does it matter? 3. What happens next?*
* **AI Disclosure**: Explicitly details monitoring verified news wires, utilizing AI models for structured summarization, and enforcing strict constraints against hallucination.
* **Media Sourcing**: Transparent disclosure of licensed photography (Pexels) and authorized video embeds (YouTube).
* **Corrections**: Explains prompt updates upon discovery of errors.
* **Repository Alignment**: The claims in `about.md` match the actual mechanics of `Code.gs` and Eleventy templates.

---

## 9. EDITORIAL POLICY AUDIT (`src/pages/editorial-policy.md`)

| Policy Area | Stated Coverage in Policy | Status |
| :--- | :--- | :--- |
| **Primary Sourcing** | Wire services, institutional releases, government notices | **PRESENT** |
| **Verification & Restraint** | Reporting strictly documented facts, avoiding unsourced claims | **PRESENT** |
| **Source Attribution** | Explicit citation and outbound links on every article | **PRESENT** |
| **AI-Assisted Operations** | Model-assisted ingestion, summarization guardrails | **PRESENT** |
| **Developing News / Uncertainty** | Explicitly stating confirmed vs unconfirmed status | **PRESENT** |
| **Corrections Policy** | Dedicated email, prompt rectification, 08:00–22:00 IST review | **PRESENT** |
| **Sponsored Content / Ads** | Addressed in Privacy Policy / Terms, but omitted from Editorial | **PARTIAL** |
| **Conflicts of Interest** | General neutrality stated, but no formal disclosure policy | **PARTIAL** |
| **Anonymous Sources** | No explicit policy (site relies on published wire dispatches) | **PARTIAL** |

---

## 10. AI DISCLOSURE AUDIT

### Where AI is Disclosed:
1. `/about/` under `## AI-Assisted Journalism & Workflow Disclosure`
2. `/editorial/` under `## 3. AI-Assisted Journalism & Workflow Disclosure`
3. `/terms/` under `## 1. Editorial Integrity & Nature of Service`

### What the Site Claims AI Does:
* Ingests high-velocity real-time wire feeds and press releases.
* Synthesizes complex source material into concise structured briefings.
* Drafts "Why It Matters" strategic analysis and forward-looking timelines under strict factual guardrails.

### What the Site Claims Regarding Human Oversight / Quality Control:
* Algorithmic and editorial language validation to ensure natural journalistic English.
* Strict discard rules for low-substance or unverified source leads.
* Periodic manual enrichment cycles for thin content (proven by Phases 2C, 6A-6E, 8A-8I, 9A-9C).

### Consistency with `Code.gs`:
The code in `Code.gs` demonstrates multi-tiered quality gates: `isArticleOutputEnglish_`, `isPressReleaseSpam_`, `isLowSubstance_`, `isCommercialRetailContent_`, `isDuplicate_`, and three-tiered LLM prompts (Groq, Gemini, OpenRouter) that enforce the triad structure (`title`, `dek`, `content`, `why_it_matters`, `what_happens_next`).

---

## 11. SOURCE ATTRIBUTION AUDIT

* **Frontmatter Properties**: `sourceName` (1,176 articles) and `sourceUrl` (1,189 articles).
* **Visible Article Citation**:
  ```html
  <div class="source-citation">
    <span>Reporting based on verified dispatches from <strong>{{ currentSourceName or "Official Wire Services" }}</strong>.</span>
    {% if currentSourceUrl %}
      <span style="margin-left: 8px;">
        <a href="{{ currentSourceUrl }}" rel="nofollow noopener noreferrer" target="_blank">View primary release ↗</a>
      </span>
    {% endif %}
  </div>
  ```
* **Top Wire Sources Identified**: Google News RSS, Yahoo! News, The Times Of India, Latestly, The Economic Times, Bhaskarlive, The Hans India, Hindustan Times, Deccan Herald, NDTV, Moneycontrol, The Hindu, PR Newswire APAC, WION, etc.
* **Link Attributes**: Clean, safe outbound links using `rel="nofollow noopener noreferrer" target="_blank"`.

---

## 12. CORRECTIONS POLICY

* **Public Notice**: Documented in `/about/`, `/editorial/`, and `/contact/`.
* **Grievance Inbox**: `samachardaily.editorial@gmail.com`
* **Stated Review Hours**: 08:00 AM to 10:00 PM IST daily.
* **Article-Level Correction Marker**: Currently, articles do not have a visible "Correction Note" or "Updated on [Date]" UI badge when modifications occur.

---

## 13. ARTICLE DATE & UPDATE TRANSPARENCY

* **Visible Date**: Formatted as human-readable date + time in IST (e.g., `12 Sep 2026, 10:25 PM IST`).
* **Structured Data**: `datePublished` and `dateModified` in ISO 8601 UTC.
* **Update Visibility**: When articles are enriched, `dateModified` is populated in schema if provided, but the visible frontend byline bar only displays the original publication date without an explicit "Updated" timestamp.

---

## 14. EDITORIAL RESPONSIBILITY & MASTHEAD

* **Institutional Accountability**: Held by "SamacharDaily Editorial Desk".
* **Individual Masthead**: Absent. No individual Editor-in-Chief, Managing Editor, or Bureau Chiefs are identified by name.
* **Policy Compliance**: Meets baseline digital transparency standards for automated news curation portals, but lacks the individual human byline depth expected for original investigative publications.

---

## 15. CONTACT TRUST SIGNALS

* **Editorial Inquiries**: `samachardaily.editorial@gmail.com` (**PRESENT**)
* **Corrections & Grievances**: `samachardaily.editorial@gmail.com` (**PRESENT**)
* **Operational Hours**: 08:00 AM to 10:00 PM IST (**PRESENT**)
* **Physical Postal Address**: None (**MISSING**)
* **Telephone Support**: None (**MISSING**)
* **Social Identity**: Active X (`@SamacharDaily`) and Instagram (`@samachardaily.in`) (**PRESENT**)

---

## 16. POLICY CONSISTENCY ANALYSIS

| Policy Statement | Technical / Pipeline Reality | Alignment |
| :--- | :--- | :--- |
| "Covers India, World, Business, Tech, Sports" | 5 category folders and feeds implemented | **MATCH** |
| "Ingests verified news wires & press releases" | `fetchFromNewsData_`, `fetchFromCurrents_` in `Code.gs` | **MATCH** |
| "Transparently cites primary sources with links" | `<div class="source-citation">` with outbound link | **MATCH** |
| "Uses licensed photography" | Pexels API integration in `Code.gs` with photo credits | **MATCH** |
| "Embeds authorized broadcast reports" | YouTube search & embed in `video-embed.njk` | **MATCH** |
| "All articles authored by SamacharDaily Editorial Team" | 1,188 of 1,189 articles have exact matching frontmatter | **MATCH** |
| "Prompt corrections upon reader notice" | Contact channels active, but no visible changelog on pages | **PARTIAL** |

---

## 17. CODE.GS PUBLISHING PIPELINE AUDIT

```
[NewsData.io / Currents API]
           │
           ▼
[Language & Spam Filters] (isNonEnglishTitle_, isPressReleaseSpam_, isLowSubstance_)
           │
           ▼
[Duplicate Detection] (>60% keyword overlap against category history)
           │
           ▼
[LLM Synthesis: Groq / Gemini / OpenRouter] (Enforces Triad: What happened, Why it matters, Next steps)
           │
           ▼
[Image & Video Enrichment] (Pexels licensed photo + YouTube embed)
           │
           ▼
[Markdown Generation] (Sets author: "SamacharDaily Editorial Team", sourceUrl, sourceName)
           │
           ▼
[GitHub API Direct Push to main]
```

---

## 18. LIVE PRODUCTION FINDINGS (5 SAMPLES)

| Category | Article Title | Live Status | Visible Byline | Visible Source | Schema Author |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **India** | 47 Lakh Names Deleted From Delhi Voter Roll After Revision | `HTTP 200` | By SamacharDaily Editorial Team | NDTV (Link present) | `@type: Organization` |
| **Business** | Bank strike hits Assam, demands five‑day week, pension overhaul | `HTTP 200` | By SamacharDaily Editorial Team | The Sentinel (Link present) | `@type: Organization` |
| **Tech** | Cyble and UAE Cyber Security Council Ink MOU | `HTTP 200` | By SamacharDaily Editorial Team | PR Newswire APAC (Link present) | `@type: Organization` |
| **World** | Witkoff and Kushner Arrive in Moscow | `HTTP 200` | By SamacharDaily Editorial Team | NPR (Link present) | `@type: Organization` |
| **Sports** | 1979 Beetles Tribute Team Wins 21st Annual Youth Golf | `HTTP 200` | By SamacharDaily Editorial Team | Yakima Herald-Republic (Link present) | `@type: Organization` |

---

## 19. TRUST & TRANSPARENCY MATRIX

| Area | Current Implementation | Evidence | Status | Risk Level |
| :--- | :--- | :--- | :--- | :--- |
| **Publisher Identity** | SamacharDaily | `site.js`, WebSite schema | **PASS** | LOW |
| **Named Authors** | Institutional team name ("Editorial Team") | Frontmatter across 1,188 articles | **PARTIAL** | MEDIUM |
| **Author Pages** | Non-existent | No `/author/` routes in build | **MISSING** | MEDIUM |
| **Author Bios** | Non-existent | No author bio UI on articles | **MISSING** | MEDIUM |
| **Editorial Responsibility** | Institutional desk email | `/about/`, `/editorial/`, `/contact/` | **PASS** | LOW |
| **Source Attribution** | Explicit source name & outbound link | `<div class="source-citation">` | **PASS** | LOW |
| **Source Verification** | Triad structure + primary wire citations | Verified dispatches cited | **PASS** | LOW |
| **AI Disclosure** | Clear disclosure on About, Policy, Terms | Dedicated sections on 3 policy pages | **PASS** | LOW |
| **Corrections Policy** | Dedicated email & review hours | `/editorial/`, `/contact/` | **PASS** | LOW |
| **Article Timestamps** | IST readable date + ISO published date | `<time datetime="...">` | **PASS** | LOW |
| **Updated Timestamps** | Schema-only if modified; not visible in UI | `article.njk` byline bar | **PARTIAL** | LOW |
| **Contact Channels** | Functional email, hours, social links | `/contact/` | **PASS** | LOW |
| **Ownership Disclosure** | Digital news publication based in India | `/about/`, `/contact/` | **PARTIAL** | LOW |
| **Privacy Policy** | Comprehensive DPDP / GDPR / Ad notices | `/privacy/` | **PASS** | LOW |
| **Terms of Service** | Complete terms with service disclaimer | `/terms/` | **PASS** | LOW |

---

## 20. EXACT PROBLEMS IDENTIFIED

1. **Missing Author Routing**: Eleventy does not generate author archive pages or author profile endpoints (`/author/editorial-team/` or `/authors/`).
2. **Schema Organization Typing for Authors**: In `jsonld-news.njk`, `NewsArticle.author` points to `/about/` as an `Organization` rather than linking to a dedicated author profile or specialized desk entity.
3. **Single Outlier Author Inconsistency**: One article in `src/articles/india/` contains `"Pooja Nair | SamacharDaily Policy Desk"` without an associated author page, while the other 1,188 articles contain `"SamacharDaily Editorial Team"`.
4. **No Visible "Updated On" Timestamp**: When articles are enriched or corrected, the frontend does not show a visible `Updated: [Date]` tag alongside the original published date.
5. **Absence of Article-Level Methodology Note**: While `/about/` and `/editorial/` contain AI-assisted newsroom disclosures, individual article pages lack a compact micro-disclosure linking to the editorial policy.

---

## 21. SEVERITY CLASSIFICATION

* **HIGH**: Missing Author Architecture & lack of author profile pages (hinders multi-author E-E-A-T expansion).
* **MEDIUM**: `NewsArticle.author` schema structure pointing to `/about/` without a dedicated `ProfilePage` or structured author entity.
* **LOW**: Lack of visible "Updated on" date display on articles with modifications.
* **LOW**: Single legacy author string inconsistency (`Pooja Nair`).

---

## 22. RECOMMENDED NEXT CHANGES (FOR PHASE 11B)

1. **Design a Lightweight Author System**:
   - Create a centralized author data structure (e.g., `src/_data/authors.js`).
   - Define primary institutional desk authors (e.g., `SamacharDaily Editorial Team`, `SamacharDaily Tech Desk`, `SamacharDaily Business Desk`, `SamacharDaily India Desk`, `SamacharDaily World Desk`, `SamacharDaily Sports Desk`).
2. **Generate Author Archive Pages**:
   - Create an author layout (`src/_includes/layouts/author.njk`) that renders author biography, editorial role, and recent articles.
   - Paginate author routes at `/author/[slug]/`.
3. **Upgrade Author Schema**:
   - Link `NewsArticle.author` to `/author/[slug]/` and provide clean `Person` or `NewsMediaOrganization` desk schemas.
4. **Add Article-Level Trust Micro-Badge**:
   - Add a subtle link near the byline or source citation: *"AI-assisted reporting adhering to our [Editorial Standards]({{ '/editorial/' | url }})."*

---

## 23. FILES LIKELY REQUIRING MODIFICATION IN PHASE 11B

* `src/_data/authors.js` (New file)
* `src/_data/site.js`
* `src/_includes/layouts/article.njk`
* `src/_includes/layouts/author.njk` (New file)
* `src/_includes/partials/jsonld-news.njk`
* `src/_includes/partials/jsonld-author.njk` (New file)
* `src/categories/author.njk` or `src/pages/author.njk` (New route template)
* `.eleventy.js` (Add author collections / filters)

---

## 24. RISKS & CONSTRAINTS

* **DO NOT Invent Fake People**: Do not create fictional biographies, fake headshots, or fabricated LinkedIn/social profiles. Use legitimate institutional desk identities and genuine editorial contributors.
* **Preserve Article URLs**: Slugs, canonical URLs, and permalinks must not be modified when upgrading author systems.
* **Zero Disruption to Existing Categories**: Author routes must coexist cleanly with `/india/`, `/business/`, `/tech/`, `/world/`, `/sports/`.

---

## 25. WHAT MUST NOT BE CHANGED

* Do NOT modify article dates, slugs, permalinks, or canonical tags.
* Do NOT mass-edit article body content.
* Do NOT remove primary source citations or licensed photo credits.
* Do NOT introduce broken links or fabricated legal entities.

---

## 26. LOCAL BUILD VERIFICATION

* **Command**: `npx @11ty/eleventy`
* **Output**: 1,210 files compiled in 13.41s
* **Warnings**: 0
* **Errors**: 0

---

## FINAL STATUS

**PHASE 11A COMPLETE — READ-ONLY AUTHORSHIP & EDITORIAL TRUST AUDIT**
