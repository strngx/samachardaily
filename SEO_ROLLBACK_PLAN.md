# SAMACHAR DAILY — SEO REHABILITATION
## ROLLBACK & RECOVERY PLAN
**Target Environment:** `https://thesamachardaily.in/`  
**Repository:** `strngx/samachardaily` (`main` branch)  
**Status:** REFERENCE ARCHITECTURE — READY FOR EXECUTION IF ROLLBACK IS REQUIRED

---

## 1. INVENTORY OF CONTROLLING FILES

The following files govern the entire frontend rendering, indexing directives, structured data, and automated publishing:

| Controlling File | System Controlled | Rollback Mechanism |
| :--- | :--- | :--- |
| `src/_includes/layouts/base.njk` | Global `<head>`, canonicals, robots, meta tags, organization schema | Git commit revert |
| `src/_includes/layouts/article.njk` | Article body, bylines, breadcrumbs, internal links, ad slots | Git commit revert |
| `src/_includes/partials/jsonld-news.njk` | `NewsArticle` JSON-LD schema | Git commit revert |
| `src/feeds/sitemap.njk` | XML Sitemap generation and `<news:news>` inclusion | Git commit revert |
| `src/feeds/rss.njk` | RSS 2.0 Feed generation | Git commit revert |
| `src/_data/site.js` | Global site constants, navigation, author configuration | Git commit revert |
| `src/robots.txt` | Crawler crawl rules and sitemap location | Git commit revert |
| `src/articles/**/*.md` | 1,054 published Markdown news dispatches | Git commit revert |
| `src/_data/recent-fingerprints.json` | Deduplication memory & story fingerprints | Git commit revert |
| `Code.gs` | Google Apps Script auto-blogger and publishing pipeline | Google Apps Script Version History |

---

## 2. RECOVERY PROCEDURES BY COMPONENT

### A. Restoring Template, Code, & Markdown State (Git Layer)
Because SamacharDaily is a static site built via GitHub Actions and Eleventy, all site files and articles are fully versioned in Git.
1. **Identify Stable Commit Hash:**
   ```bash
   git log --oneline -n 10
   ```
2. **Revert a Bad Commit (Preserving Git History):**
   ```bash
   git revert <bad-commit-hash> --no-edit
   git push origin main
   ```
3. **Emergency Hard Reset to Known Good Tag/Commit (If Needed):**
   ```bash
   git checkout main
   git reset --hard <stable-commit-hash>
   git push origin main --force
   ```
4. **Trigger Deployment Verification:**
   - Verify that the GitHub Actions `deploy.yml` workflow completes with code 0.
   - Live static assets update on GitHub Pages within 30–60 seconds.

### B. Restoring Google Apps Script State (`Code.gs` Layer)
1. Open the Google Apps Script project dashboard.
2. Navigate to **Project History / Executions**.
3. If an updated `Code.gs` introduced publishing errors, restore the previous deployment version:
   - Go to **Deploy** -> **Manage Deployments** -> Select previous active deployment.
   - Alternatively, copy the baseline `Code.gs` from the repository root back into the Google Apps Script script editor and click **Save**.

### C. Restoring XML Sitemap Behavior
If a sitemap modification causes dropped URLs or syntax errors:
1. Revert `src/feeds/sitemap.njk` to baseline:
   ```bash
   git checkout HEAD~1 -- src/feeds/sitemap.njk
   git commit -m "rollback: restore baseline sitemap generator"
   git push origin main
   ```
2. Validate the output XML locally:
   ```bash
   npx @11ty/eleventy
   # Verify _site/sitemap.xml is valid XML
   ```
3. Verify live URL: `curl -I https://thesamachardaily.in/sitemap.xml`.

### D. Restoring Canonical & Metadata Directives
If a change to `base.njk`, `site.js`, or frontmatter accidentally sets an incorrect canonical domain, adds an unwanted trailing slash, or triggers `noindex`:
1. Immediately inspect `_site/index.html` and `_site/articles/**/index.html` for `<link rel="canonical">` and `<meta name="robots">`.
2. Confirm canonical matches exactly:
   ```html
   <link rel="canonical" href="https://thesamachardaily.in/category/slug/">
   ```
3. Confirm absence of `<meta name="robots" content="noindex, follow">` on standard articles.
4. Push the restored `base.njk` to `main`.

### E. Restoring Redirect Rules
If redirect rules are introduced (e.g., via 404 handler or client-side routing) and cause redirect loops or broken rankings:
1. Revert redirect maps in client JavaScript or hosting config.
2. Verify all standard 200 OK responses across representative URLs from each of the 5 categories.

---

## 3. ROLLBACK VERIFICATION CHECKLIST

After executing any rollback, verify the following live health checks:

- [ ] **HTTP Status:** `curl -I https://thesamachardaily.in/` returns `HTTP/2 200`.
- [ ] **Robots.txt:** `curl -s https://thesamachardaily.in/robots.txt` returns `Allow: /` and declared sitemap URL.
- [ ] **Sitemap Validity:** `curl -s https://thesamachardaily.in/sitemap.xml` contains all 1,054 articles with valid XML closing tags.
- [ ] **Canonical Accuracy:** Spot-check canonical tag on at least 1 article from each of the 5 categories.
- [ ] **No Unwanted Noindex:** Inspect HTML source of homepage and category hubs for absence of `noindex`.
- [ ] **Structured Data:** Test homepage and 2 article URLs in Google Rich Results Test to verify zero syntax errors.
