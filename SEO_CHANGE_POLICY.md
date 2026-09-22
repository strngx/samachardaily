# SAMACHAR DAILY — SEO CHANGE POLICY
## PERMANENT GOVERNANCE & PRODUCTION SAFETY DIRECTIVES

**Applies To:** All developers, AI agents, automation pipelines, and editorial operators touching `https://thesamachardaily.in/`  
**Effective Date:** September 22, 2026  
**Status:** ACTIVE PRODUCTION POLICY

---

## 1. CORE SAFETY PRINCIPLES

1. **Never Mass-Delete URLs Without Explicit Mapping:** Under no circumstances may articles, categories, or pages be batch-deleted or unlinked without an audited 1:1 redirect map or explicit editorial decommission plan.
2. **Never Change an Existing URL Slug Without a Verified 301 Strategy:** URL slugs represent indexed equity and search authority. Changing a slug without handling the old URL creates 404 crawl errors and destroys accumulated rankings.
3. **Never Change Canonical Behavior Blindly:** Canonical URLs must remain self-referencing unless consolidating duplicate content to a designated primary master. Never point canonicals across categories without verifying topical intent.
4. **Never Add `noindex` Merely to Make GSC Metrics Look Clean:** The "Crawled – currently not indexed" status is a signal for quality and topical depth, not an emergency that should be masked by applying `noindex` to legitimate news archives.
5. **Never Remove Indexed Content Without Assessing Traffic & Backlinks:** Historical articles (even older than 14 days) often rank for long-tail search queries. Audit historical Google Search Console clicks and impressions before altering older content.
6. **Never Consolidate Articles Without Mapping the Destination URL:** When resolving cannibalization clusters, determine the highest-ranking primary article first and consolidate signals intentionally.
7. **Never Make Hundreds of Unrelated SEO Changes Simultaneously:** Implement fixes in discrete, testable phases so cause-and-effect can be measured in Search Console.

---

## 2. PRODUCTION INTEGRITY RULES

8. **Every Production Change Must Have a Clear Reason:** No hypothetical or speculative modifications. Every change must address a verified defect identified in the audit.
9. **Every Significant Change Must Have a Rollback Path:** Prior to committing structural modifications, document the exact revert procedure and verify that previous versions remain accessible.
10. **Verify Google-Facing Output After Every Major Change:** Inspect rendered HTML, XML sitemaps, JSON-LD structured data, and robots.txt locally and on live deployment after every push.
11. **Preserve Existing Functionality:** Automated ingestion, RSS feeds, category archives, search functionality, and newsletter capture must continue operating without interruption.
12. **Preserve Valuable Rankings and Backlinks:** Protect top-performing articles (such as top click-driving assets) from any layout or metadata regression.
13. **Do Not Optimize for GSC Vanity Metrics at the Expense of Users:** Prioritize real user experience, page speed, mobile readability, and editorial clarity over artificial metric manipulation.

---

## 3. EDITORIAL & AI INTEGRITY STANDARDS

14. **Do Not Create Additional Thin or Duplicate Content:** Strengthen deduplication guardrails in `Code.gs` to reject repetitive wire dispatches.
15. **Do Not Introduce AI-Generated Filler:** Never artificially pad articles with boilerplate fluff or speculative paragraphs. Brevity with factual fidelity is strictly required.
16. **Do Not Fabricate Authors, Sources, Quotes, Statistics, or Reporting:** All editorial bylines, sources, and reporting details must represent real, verifiable newsroom workflows.
17. **Existing Content Must Be Improved Based on Evidence, Not Blindly Rewritten:** Articles with established search impressions should receive targeted structural and metadata refinements rather than destructive automated rewrites.
18. **Prefer Minimal, High-Impact Changes Over Unnecessary Architectural Rewrites:** Preserve the high-performance static Eleventy architecture and serverless Google Apps Script pipeline; refine their implementation rather than replacing them with complex new stacks.
