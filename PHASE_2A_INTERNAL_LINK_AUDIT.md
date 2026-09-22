# SAMACHAR DAILY — SEO REHABILITATION
## PHASE 2A: INTERNAL LINKING & ARCHITECTURE AUDIT REPORT
**Target Domain:** `https://thesamachardaily.in/`  
**Repository:** `strngx/samachardaily` (`main` branch)  
**Status:** READ-ONLY AUDIT — ZERO EDITORIAL MODIFICATIONS APPLIED  

---

## 1. EXECUTIVE SUMMARY & CURRENT ARCHITECTURE

SamacharDaily relies on a **hybrid programmatic internal linking system** powered by Eleventy layout filters:

1. **Header Navigation (Site-Wide):** Direct permanent links to the 5 main category desks (`/india/`, `/world/`, `/business/`, `/tech/`, `/sports/`) and `/`.
2. **Breadcrumb Navigation:** HTML breadcrumbs and `BreadcrumbList` schema linking `Home` → `Category` → `Article`.
3. **In-Body "Also Read" Injection:** `injectAlsoRead` filter in `.eleventy.js` programmatically injects a contextual bold link after the 2nd paragraph of every article pointing to 1 related article in the same category.
4. **Bottom Related Articles Block:** `also-read-bottom` list links the 4 most recent articles in the same category.
5. **"More in [Category]" 3-Card Grid:** Bottom card grid linking 3 category stories.
6. **In-Body Editorial Hyperlinks:** **0 articles** contain bespoke editorial markdown hyperlinks (`[Entity](url)`) within the prose itself.

---

## 2. LINK DEPTH & ORPHAN RISK ANALYSIS

### A. The 14-Day Recency Split (Category Architecture)
In `.eleventy.js`, `splitCategoryArticlesByAge` splits category articles based on a 14-day cutoff:
- Articles < 14 days old: Appear in the active category main list.
- Articles ≥ 14 days old: Drop into the collapsible "Archive" accordion on page 1 or category pagination pages (`/category/2/`, etc.).

### B. Impact on Crawl Budget & Indexing
- **Recent Articles (<14 days):** Receive high internal PageRank flow from category hubs and recent-article grids.
- **Older Articles (≥14 days):** Link equity diminishes once they age past 14 days and move into archive pagination, contributing to Google Search Console's "Crawled – currently not indexed" status on older wire briefs.

---

## 3. INTERNAL LINK ENHANCEMENT OPPORTUNITIES (PHASE 2B GUIDANCE)

> [!NOTE]
> Do NOT manually edit 1,121 articles with hand-coded markdown links. Implement scalable, systematic linking rules.

1. **Topical Topic Cross-Linking (Cross-Desk):** Enhance the related-article algorithm in `.eleventy.js` to link based on shared entity tokens rather than pure category recency (e.g. link an `/india/` EV subsidy article to a `/tech/` EV launch article).
2. **Cluster Hub Injections:** For high-volume clusters (e.g. iPhone Duo, Baleno facelift, BRICS Summit), inject bi-directional contextual links connecting the sub-stories to the designated primary anchor article.
3. **Category Pagination Sitemap Inclusion:** In Phase 3, evaluate adding category pagination routes (`/india/2/`, `/business/2/`, etc.) to the XML sitemap to ensure older articles in the archive maintain crawl accessibility.
