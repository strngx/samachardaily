# SAMACHAR DAILY — SEO REHABILITATION
## PHASE 1.5: PRODUCTION URL & SITEMAP INTEGRITY AUDIT REPORT
**Target Production Site:** `https://thesamachardaily.in/`  
**Repository:** `strngx/samachardaily` (`main` branch)  
**Deployment Commit:** `97de4c1`  
**Audit Mode:** STRICT READ-ONLY / ZERO MODIFICATIONS  
**Audit Date:** September 22, 2026  

---

## 1. EXECUTIVE SUMMARY

- **Sitemap Discrepancy Resolved:** The discrepancy between Phase 0 (reported 1,065) and Phase 1 (reported 1,018) is fully resolved:
  - Phase 0's 1,065 figure was a theoretical sum (11 static/category routes + 1,054 total articles) that did not account for the `{% if not article.data.noindex %}` sitemap exclusion filter.
  - 47 existing articles in the repository have `noindex: true` in their frontmatter (applied in commit `490cc63` prior to Phase 0). Therefore, the actual physical sitemap generated at Phase 0 was **1,018 URLs** (11 static/category routes + 1,007 indexable articles).
- **Current Live Production Sitemap Count:** **1,132 URLs** (100% valid XML, 0 duplicates).
- **Why Live Sitemap Increased from 1,018 to 1,132:** Between Phase 0 and the Phase 1 deployment, the automated Google Apps Script background publisher added **114 new news articles** to the GitHub repository.
- **URL Loss / Deletion Status:** **ZERO (0) URLs disappeared.**
- **URL Permalinks / Slugs Changed:** **ZERO (0) permalinks changed.**
- **Sitemap Accuracy:** Exactly 1,121 indexable articles exist in the repository, and exactly 1,121 article URLs appear in `sitemap.xml` (100.0% 1:1 match).
- **Phase 2 Gate Decision:** **SAFE TO PROCEED TO PHASE 2**.

---

## 2. PRODUCTION SITEMAP BREAKDOWN (LIVE INSPECTION)

Inspection of `https://thesamachardaily.in/sitemap.xml`:
- **HTTP Status:** `HTTP/2 200 OK`
- **XML Validity:** Valid, fully closed XML (`<urlset>...</urlset>`)
- **Total `<loc>` Entries:** **1,132**
- **Unique URLs:** **1,132**
- **Duplicate URLs:** **0**

### URL Classification:
| Class | Live Count | URL Pattern / Examples | Included in Sitemap? |
| :--- | :--- | :--- | :--- |
| **Homepage** | 1 | `https://thesamachardaily.in/` | Yes |
| **Category Hubs** | 5 | `https://thesamachardaily.in/india/`, `/world/`, `/business/`, `/tech/`, `/sports/` | Yes |
| **Policy / Static Pages** | 5 | `https://thesamachardaily.in/about/`, `/editorial/`, `/contact/`, `/privacy/`, `/terms/` | Yes |
| **Article URLs** | 1,121 | `https://thesamachardaily.in/articles/<category>/<slug>/` | Yes (1,121 indexable) |
| **Category Pagination** | 0 | `/category/<page>/` | No (Intentionally omitted) |
| **Feeds** | 0 | `/rss.xml`, `/sitemap.xml` | Excluded from `<loc>` |
| **Search Page** | 0 | `/search/` | Excluded (Has `noindex, follow`) |
| **TOTAL IN SITEMAP** | **1,132** | | |

---

## 3. SOURCE REPOSITORY BUILD METRICS (COMMIT `97de4c1`)

| Component | Repository Count | Status / Notes |
| :--- | :--- | :--- |
| **Total Markdown Articles** | **1,168** | Published across 5 category folders in `src/articles/` |
| **Articles with `noindex: true`** | **47** | Excluded from `sitemap.xml` via `{% if not article.data.noindex %}` |
| **Indexable Articles (`not noindex`)** | **1,121** | 100% matched in `sitemap.xml` |
| **Quarantined Articles** | **6** | In `src/articles/_quarantine-commercial/` with `permalink: false` |
| **Category Hub Routes** | **5** | `/india/`, `/world/`, `/business/`, `/tech/`, `/sports/` |
| **Category Pagination Routes** | **5** | `/india/2/`, `/india/3/`, `/business/2/`, `/tech/2/`, `/sports/2/` |
| **Static / Policy Routes** | **6** | `/about/`, `/editorial/`, `/contact/`, `/privacy/`, `/terms/`, `/search/` |
| **Total Public HTML Routes** | **1,185** | Built into `_site/` (1,168 articles + 1 home + 5 cats + 5 pag + 6 static) |

---

## 4. PHASE 0 BASELINE VS. CURRENT PRODUCTION COMPARISON

| Metric | Phase 0 Stated | Phase 0 Actual | Current Production | Net Live Change | Reason for Difference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Total Sitemap URLs** | 1,065 (est.) | 1,018 | **1,132** | **+114** | +114 new news articles published autonomously by Apps Script |
| **Article URLs in Sitemap** | 1,054 (est.) | 1,007 | **1,121** | **+114** | +114 new indexable articles added |
| **Articles with `noindex`** | 0 (uncounted) | 47 | **47** | **0** | Pre-existing AdSense quality control filter (`490cc63`) |
| **Category Hubs in Sitemap** | 5 | 5 | **5** | **0** | 100% preserved |
| **Policy Pages in Sitemap** | 5 | 5 | **5** | **0** | 100% preserved |
| **Pagination in Sitemap** | 0 | 0 | **0** | **0** | Intentionally excluded |
| **Quarantined Articles** | 6 | 6 | **6** | **0** | Intentionally excluded with `permalink: false` |

---

## 5. COMPLETE URL INTEGRITY AUDIT RESULTS

### A. Missing URLs Check
- **Indexable articles in repository missing from live sitemap:** **0**
- **Sitemap URLs missing from live production site:** **0**

### B. Unexpected / Unmapped URLs Check
- **Article URLs in live sitemap not found in repository:** **0**
- **Unexpected routes generated:** **0**

### C. Quarantined Articles Audit (`src/articles/_quarantine-commercial/`)
The 6 quarantined articles remain in `src/articles/_quarantine-commercial/` with `permalink: false` and `eleventyExcludeFromCollections: true`:
1. `28k-mile-2007-toyota-prius-at-no-reserve.md` -> `https://thesamachardaily.in/articles/tech/28k-mile-2007-toyota-prius-at-no-reserve/` -> **HTTP 404** (Not in sitemap)
2. `4900-mile-2008-mercedes-benz-clk350-cabriolet.md` -> `https://thesamachardaily.in/articles/tech/4900-mile-2008-mercedes-benz-clk350-cabriolet/` -> **HTTP 404** (Not in sitemap)
3. `carson-city-legal-case-64621-remains-behind-paywall.md` -> `https://thesamachardaily.in/articles/business/carson-city-legal-case-64621-remains-behind-paywall/` -> **HTTP 404** (Not in sitemap)
4. `iris-instant-white-rice-10-pack-just-1259-shipped-on-amazon.md` -> `https://thesamachardaily.in/articles/business/iris-instant-white-rice-10-pack-just-1259-shipped-on-amazon/` -> **HTTP 404** (Not in sitemap)
5. `tennis-predictions-for-the-us-open-on-polymarket.md` -> `https://thesamachardaily.in/articles/sports/tennis-predictions-for-the-us-open-on-polymarket/` -> **HTTP 404** (Not in sitemap)
6. `which-growth-etf-is-the-better-buy-vanguards-large-cap-vug-or-ishares-small-cap-iscg.md` -> `https://thesamachardaily.in/articles/business/which-growth-etf-is-the-better-buy-vanguards-large-cap-vug-or-ishares-small-cap-iscg/` -> **HTTP 404** (Not in sitemap)

*Finding:* These 6 commercial/thin articles were intentionally decommissioned prior to Phase 0. They are correctly excluded from the build and sitemap.

---

## 6. PRODUCTION SAMPLE PROBING RESULTS

| URL Probed | Status | Canonical Tag Verified | Robots Directive Verified | Result |
| :--- | :--- | :--- | :--- | :--- |
| `https://thesamachardaily.in/` | `200 OK` | `href="https://thesamachardaily.in/"` | Indexable (No noindex) | **PASS** |
| `https://thesamachardaily.in/india/` | `200 OK` | `href="https://thesamachardaily.in/india/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/world/` | `200 OK` | `href="https://thesamachardaily.in/world/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/business/` | `200 OK` | `href="https://thesamachardaily.in/business/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/tech/` | `200 OK` | `href="https://thesamachardaily.in/tech/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/sports/` | `200 OK` | `href="https://thesamachardaily.in/sports/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/about/` | `200 OK` | `href="https://thesamachardaily.in/about/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/editorial/` | `200 OK` | `href="https://thesamachardaily.in/editorial/"` | Indexable | **PASS** |
| `https://thesamachardaily.in/search/` | `200 OK` | `href="https://thesamachardaily.in/search/"` | `<meta name="robots" content="noindex, follow">` | **PASS** |
| `https://thesamachardaily.in/assets/images/default-hero.jpg` | `200 OK` | N/A (Static Asset) | `content-type: image/jpeg` | **PASS** |
| Sample India Article | `200 OK` | Self-referencing canonical | `NewsArticle` + `BreadcrumbList` valid | **PASS** |
| Sample Tech Article | `200 OK` | Self-referencing canonical | `NewsArticle` + `BreadcrumbList` valid | **PASS** |
| Sample Noindex Article | `200 OK` | Self-referencing canonical | `<meta name="robots" content="noindex, follow">` | **PASS** |

---

## 7. RISK CLASSIFICATION & ROOT CAUSE EXPLANATION

- **Classification:** **EXPECTED / INTENTIONAL**
- **Evidence:**
  1. The difference between 1,065 and 1,018 was purely a reporting artifact in Phase 0 documentation, where the theoretical article count (1,054) was added to 11 static routes without subtracting the 47 `noindex: true` articles excluded by template logic.
  2. The growth from 1,018 to 1,132 is the normal, intended behavior of the autonomous hourly news publishing pipeline (`Code.gs`) committing 114 verified new stories.
  3. All 1,121 indexable articles in the repository match the live sitemap 1:1.
  4. Zero URLs were deleted, corrupted, or altered.

---

## 8. PHASE 2 GATE DECISION

### **SAFE TO PROCEED TO PHASE 2**
*(Production URL architecture, sitemaps, canonicals, and article integrity are 100% intact).*
