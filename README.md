# SamacharDaily (समाचार डेली)

> **News, Fast. Trends, Explained.**  
> A zero-cost, high-velocity Indian digital news publication engineered for editorial credibility, rapid scanning, Google ranking, and Google AdSense compliance.

---

## 🏛️ Project Overview

**SamacharDaily** is a static-first news portal built on **Eleventy (11ty)**, featuring a cloud-native, zero-cost **Auto-Blogger** engine powered by **Google Apps Script**, **Groq (Llama 3.3/3.1)**, **CurrentsAPI/ApiTube**, **Pexels/Unsplash**, **YouTube Data API v3**, and the **GitHub REST API**.

### 🌟 Core Desks (5 Focus Categories)
1. 🇮🇳 **India** (`/india/`) — National politics, policy decisions, governance, infrastructure.
2. 🌐 **World** (`/world/`) — Geopolitics, international diplomacy, global treaties, breaking wire news.
3. 📈 **Business** (`/business/`) — Macroeconomics, RBI policy, stock markets, startups, energy.
4. 💻 **Tech** (`/tech/`) — Artificial intelligence, open-source models, telecom, cybersecurity, deep-tech.
5. 🏏 **Sports** (`/sports/`) — Cricket, Olympic sports, athletics, football, tournaments.

---

## 📐 Design & UI Architecture (Source of Truth: PDF 1 & Stitch)

- **Editorial Typography:** Headlines rendered in *Source Serif 4* / *Merriweather* for high journalistic credibility; UI and body in *Inter* loaded with `font-display: swap`.
- **Design Tokens:**
  - Background: `#FFFFFF` | Surface: `#F4F5F7` | Ink: `#111318` | Body: `#3C3F46` | Muted: `#767B87`
  - Accent Red: `#C81E2C` (hover: `#8F1520`) | Border: `#E4E6EB`
  - Category Chips: India (`#C81E2C`), World (`#1E4FC8`), Business (`#1E8A4C`), Tech (`#6B3FA0`), Sports (`#D9791E`)
- **Grid & Layout:** 8px base spacing grid, 12-column desktop layout (max width 1200px), article body capped at 720px for optimal readability.
- **Fixed-Height Ad Slots:** Zero Cumulative Layout Shift (CLS) with pre-reserved containers labeled `"Advertisement"`.
- **7-Part Article Structure:**
  1. Category chip + H1 headline
  2. Dek (1-2 sentence executive summary)
  3. Byline row (`SamacharDaily Desk` · date · read time)
  4. 16:9 Hero photo with ethical photographer credit
  5. 2-3 detailed paragraphs of core reporting
  6. **"Why It Matters"** highlighted callout box with accent left border
  7. Embedded 16:9 responsive YouTube video (gracefully omitted if no relevant match)
  8. Transparent source attribution (`Reporting based on coverage from [Outlet].`)
  9. In-article and post-article ad slots
  10. Related stories grid (2-3 same-category cards)

---

## 🛠️ Project Directory Structure

```
SamacharDaily/
├── .eleventy.js                     # 11ty config (filters, collections, plugins)
├── package.json                     # Project scripts and dependencies
├── README.md                        # Primary documentation
│
└── src/
    ├── _data/
    │   ├── site.js                  # Global metadata, category array, navigation
    │   └── categories.js            # Desk definitions and descriptions
    ├── _includes/
    │   ├── layouts/
    │   │   ├── base.njk             # HTML5 shell, OpenGraph, Twitter, JSON-LD
    │   │   ├── home.njk             # Homepage layout (lead, trending, categories)
    │   │   ├── article.njk          # Article template
    │   │   ├── category.njk         # 5-category archive template with pagination
    │   │   └── page.njk             # Policy page layout
    │   └── partials/
    │       ├── header.njk           # Sticky header, search drawer, mobile menu
    │       ├── footer.njk           # Dark newsroom footer with policy links
    │       ├── card.njk             # Reusable article card (16:9, label, snippet)
    │       ├── hero.njk             # Lead story + latest news stream
    │       ├── ad-slot.njk          # Zero-CLS fixed-height ad placeholder
    │       ├── video-embed.njk      # 16:9 YouTube embed (graceful fallback)
    │       ├── why-it-matters.njk   # Editorial context callout
    │       ├── key-takeaways.njk    # Quick summary context box
    │       ├── newsletter.njk       # The Daily Briefing newsletter signup
    │       ├── jsonld-news.njk      # NewsArticle schema
    │       └── jsonld-video.njk     # VideoObject schema
    │
    ├── articles/                    # Markdown articles with frontmatter
    │   ├── india/
    │   ├── world/
    │   ├── business/
    │   ├── tech/
    │   └── sports/
    │
    ├── categories/
    │   └── category.njk             # Dynamic category generator
    │
    ├── pages/
    │   ├── about.md                 # Editorial process disclosure
    │   ├── contact.md               # Desk contacts & grievance officer
    │   ├── privacy.md               # GDPR & DPDP compliant privacy policy
    │   ├── terms.md                 # Terms of service & copyright terms
    │   └── search.njk               # Instant client search interface
    │
    ├── feeds/
    │   ├── sitemap.njk              # Dynamic Google News & Web sitemap
    │   └── rss.njk                  # RSS 2.0 / Atom feed
    │
    ├── assets/
    │   ├── css/style.css            # Production CSS design tokens & layout
    │   ├── js/main.js               # Sticky header, drawers, interactive UI
    │   └── images/                  # SVGs (logo.svg, favicon.svg)
    │
    └── index.njk                    # Homepage entry
```
```

---

## 🚀 Local Development & Build

### Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)

### Installation
```bash
npm install
```

### Run Local Development Server
```bash
npm run dev
# Server starts at http://localhost:8080
```

### Build for Production
```bash
npm run build
# Outputs 100% static HTML, CSS, JS, feeds to ./_site/
```

### Run Pipeline Automated Tests
```bash
npm test
# Executes quality gate checks, slug determinism, and validator suite
```

---

## 🤖 Auto-Blogger Setup

The automation engine operates in Google Apps Script without consuming local compute or GitHub Actions minutes.  
Refer to [AUTOMATION.md](file:///c:/Users/Xeno/Desktop/SamacharDaily/AUTOMATION.md) for step-by-step setup and credentials configuration.

---

## 🌐 Zero-Cost Hosting & Deployment

SamacharDaily is deployed on GitHub Pages with zero hosting costs.  
Refer to [DEPLOYMENT.md](file:///c:/Users/Xeno/Desktop/SamacharDaily/DEPLOYMENT.md) for branch deployment instructions.
