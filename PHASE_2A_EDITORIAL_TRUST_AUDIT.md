# SAMACHAR DAILY — SEO REHABILITATION
## PHASE 2A: EDITORIAL TRUST & E-E-A-T AUDIT REPORT
**Target Domain:** `https://thesamachardaily.in/`  
**Repository:** `strngx/samachardaily` (`main` branch)  
**Status:** READ-ONLY AUDIT — ZERO EDITORIAL MODIFICATIONS APPLIED  

---

## 1. CURRENT AUTHORSHIP & BYLINE ANALYSIS

| Metric | Current State | E-E-A-T Assessment |
| :--- | :--- | :--- |
| **Byline String** | `"SamacharDaily Editorial Team"` (100% of articles) | **Weak:** Lacks named individual journalists or desk editors |
| **Author Schema Type** | `Organization` in `jsonld-news.njk` | **Suboptimal:** Google News prefers `Person` schema for news articles |
| **Author Taxonomy / Pages** | No `/author/[slug]/` routes exist | **Missing:** Readers cannot view an author's bio, credentials, or past articles |
| **Source Attribution** | Rendered citation box with `sourceName` & `sourceUrl` | **Strong:** Full transparency on primary wire dispatches |
| **Editorial Policy** | Dedicated `/editorial/` page with corrections standards | **Strong:** High transparency on newsroom guidelines |
| **Publisher Metadata** | `SamacharDaily Media` with SVG logo | **Valid:** Clean Organization branding |

---

## 2. E-E-A-T GAPS IN GOOGLE NEWS & SEARCH

1. **Generic Collective Byline:** While major news agencies (e.g. Reuters, AP) use desk bylines, independent digital publications achieve higher trust ratings in Google News when reporting is attributed to named desk specialists (e.g. "Technology Desk Lead", "National Security Bureau", "Financial Markets Editor").
2. **Author Profile Absences:** Google's Search Quality Rater Guidelines prioritize authoritativeness signals (who wrote the content, what is their background in the topic, and where is their profile page).

---

## 3. RECOMMENDED E-E-A-T REHABILITATION ARCHITECTURE (PHASE 2B / PHASE 3)

> [!IMPORTANT]
> Do NOT invent fictional journalists or fake social profiles. Build a credible, desk-driven newsroom taxonomy.

1. **Establish Desk-Specific Editorial Personas:**
   - **National Bureau Desk** (`/author/national-desk/`) — Covers India politics, governance, civic issues.
   - **Technology & Innovation Desk** (`/author/tech-desk/`) — Covers AI, consumer electronics, cybersecurity.
   - **Markets & Economy Desk** (`/author/business-desk/`) — Covers banking, corporate earnings, startups, wealth.
   - **Global Affairs Desk** (`/author/world-desk/`) — Covers geopolitics, international diplomacy, defense.
   - **Sports Newsroom** (`/author/sports-desk/`) — Covers cricket, tournaments, athlete profiles.
2. **Create Dedicated Author Pages:** Generate clean `/author/[slug]/` landing pages detailing the editorial charter, focus areas, and a listing of published reports.
3. **Upgrade Schema:** Update `jsonld-news.njk` to link author schema to the dedicated author profile URL.
