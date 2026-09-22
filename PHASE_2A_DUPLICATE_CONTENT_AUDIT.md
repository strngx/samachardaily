# SAMACHAR DAILY — SEO REHABILITATION
## PHASE 2A: DUPLICATE CONTENT AUDIT REPORT
**Target Domain:** `https://thesamachardaily.in/`  
**Repository:** `strngx/samachardaily` (`main` branch)  
**Status:** READ-ONLY AUDIT — ZERO EDITORIAL MODIFICATIONS APPLIED  

---

## 1. EXECUTIVE SUMMARY

A cross-comparison of all 1,121 indexable articles using Jaccard n-gram and paragraph shingle analysis revealed:
- **Verbatim Duplication (100% Identical Body):** **0 pairs** (No verbatim duplicated markdown files exist).
- **Near-Duplicate Story Pairs (>45% Entity & Structural Similarity):** **4 pairs** (Stories covering identical wire releases ingested twice with slightly different headlines).
- **Template Boilerplate Consistency:** All 1,121 articles follow the same structured editorial layout (*Dek* → *Core Synthesis* → *Why It Matters* → *Video* → *What Happens Next* → *Source Attribution*). While this standardizes newsroom clarity, it produces predictable structural n-grams across the catalog.

---

## 2. NEAR-DUPLICATE STORY PAIRS

### Pair 1: Volkswagen Turnaround Overhaul
- **URL 1:** `https://thesamachardaily.in/articles/business/can-volkswagen-sidestep-board-opposition-to-push-through-its-overhaul/` (Aug 28, 2026 23:48 UTC)
- **URL 2:** `https://thesamachardaily.in/articles/business/explainer-can-volkswagen-sidestep-board-opposition-to-push-through-its-overhaul/` (Aug 28, 2026 23:45 UTC)
- **Shared Entities / Content:** Both articles cover the exact same Reuters wire dispatch published 3 minutes apart. URL 2 has an `explainer-` prefix in the slug.
- **Estimated Overlap:** **82% factual overlap** (Wording was synthesized independently by Groq, but facts and citations are identical).

### Pair 2: Jio Platforms SEBI IPO Approval
- **URL 1:** `https://thesamachardaily.in/articles/business/jio-platforms-gets-sebis-nod-to-launch-ipo/` (Aug 28, 2026 23:37 UTC)
- **URL 2:** `https://thesamachardaily.in/articles/business/mukesh-ambani-led-jio-platforms-ipo-receives-sebi-approval/` (Aug 29, 2026 14:50 UTC)
- **Shared Entities / Content:** SEBI approval of Reliance Jio Platforms' upcoming public offering.
- **Estimated Overlap:** **75% factual overlap**.

### Pair 3: Ecuadorian Ex-President Moreno Conviction
- **URL 1:** `https://thesamachardaily.in/articles/world/ecuador-finds-ex-president-moreno-guilty-in-hydro-plant-bribery-case/` (Aug 29, 2026 08:13 UTC)
- **URL 2:** `https://thesamachardaily.in/articles/world/tribunal-do-equador-declara-culpado-ex-presidente-lenin-moreno-em-caso-de-corrup/` (Aug 29, 2026 08:13 UTC)
- **Shared Entities / Content:** Ingested from two different wire language feeds at the exact same minute.
- **Estimated Overlap:** **88% factual overlap**.

### Pair 4: Praggnanandhaa Chess Victory
- **URL 1:** `https://thesamachardaily.in/articles/india/stunning-comeback-by-praggnanandhaa-is-first-indian-to-win-grand-chess-tour/` (Aug 29, 2026 11:39 UTC)
- **URL 2:** `https://thesamachardaily.in/articles/sports/praggnanandhaa-creates-history-becomes-first-indian-to-win-grand-chess-tour/` (Aug 29, 2026 08:15 UTC)
- **Shared Entities / Content:** R Praggnanandhaa becoming the first Indian to win the Grand Chess Tour.
- **Estimated Overlap:** **70% factual overlap**.

---

## 3. WHY THEY OCCURRED & PREVENTION STATUS

- **Root Cause:** Ingestion APIs (NewsData & Currents) returning syndicated dispatches of the same breaking news event across multiple hours or categories.
- **Prevention in Place:** In `Code.gs`, `computeNormalizedFingerprint_` and `isFingerprintDuplicate_` now track 7-day rolling story fingerprints in `src/_data/recent-fingerprints.json` with a 60% keyword overlap rejection threshold, preventing new near-duplicates from being created in future runs.
