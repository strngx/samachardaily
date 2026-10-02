const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const pluginRss = require("@11ty/eleventy-plugin-rss");

module.exports = function (eleventyConfig) {
  // Plugins
  eleventyConfig.addPlugin(pluginRss);

  // Exclude drafts staging directory from build
  eleventyConfig.ignores.add("src/drafts/**");

  // Exclude internal editorial dashboard from production build (available locally via: npm run admin)
  const isLocalAdmin = process.env.INCLUDE_ADMIN === "true" || process.env.npm_lifecycle_event === "admin";
  if (!isLocalAdmin) {
    eleventyConfig.ignores.add("src/admin/**");
  } else {
    // Register secure server-side admin authentication middleware
    const { adminAuthMiddleware } = require("./tools/admin-auth");
    eleventyConfig.setServerOptions({
      middleware: [adminAuthMiddleware]
    });
  }

  // Prevent html-transformer from double-prefixing URLs that explicitly use the url filter
  if (eleventyConfig.transforms) {
    delete eleventyConfig.transforms["@11ty/eleventy/html-transformer"];
  }

  // Passthrough static assets
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ "src/favicon-96x96.png": "favicon-96x96.png" });
  eleventyConfig.addPassthroughCopy({ "src/apple-touch-icon.png": "apple-touch-icon.png" });
  eleventyConfig.addPassthroughCopy({ "src/web-app-manifest-192x192.png": "web-app-manifest-192x192.png" });
  eleventyConfig.addPassthroughCopy({ "src/web-app-manifest-512x512.png": "web-app-manifest-512x512.png" });
  eleventyConfig.addPassthroughCopy({ "src/site.webmanifest": "site.webmanifest" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/ads.txt": "ads.txt" });
  eleventyConfig.addPassthroughCopy({ "src/.nojekyll": ".nojekyll" });

  // Custom Filters
  eleventyConfig.addFilter("readableDate", (dateObj, format = "dd LLL yyyy, hh:mm a") => {
    if (!dateObj || dateObj === "now") {
      return DateTime.now().setZone("Asia/Kolkata").toFormat(format) + " IST";
    }
    const dt = typeof dateObj === "string" ? DateTime.fromISO(dateObj, { zone: "Asia/Kolkata" }) : DateTime.fromJSDate(dateObj, { zone: "Asia/Kolkata" });
    return (dt.isValid ? dt : DateTime.now().setZone("Asia/Kolkata")).toFormat(format) + " IST";
  });

  eleventyConfig.addFilter("rfc822Date", (dateObj) => {
    if (!dateObj || dateObj === "now") {
      return DateTime.now().setZone("Asia/Kolkata").toRFC2822();
    }
    const dt = typeof dateObj === "string" ? DateTime.fromISO(dateObj, { zone: "Asia/Kolkata" }) : DateTime.fromJSDate(dateObj, { zone: "Asia/Kolkata" });
    return (dt.isValid ? dt : DateTime.now().setZone("Asia/Kolkata")).toRFC2822();
  });

  eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj || dateObj === "now") return DateTime.now().toISO();
    const dt = typeof dateObj === "string" ? DateTime.fromISO(dateObj) : DateTime.fromJSDate(dateObj);
    return dt.isValid ? dt.toISO() : DateTime.now().toISO();
  });

  eleventyConfig.addFilter("dateOnly", (dateObj) => {
    if (!dateObj || dateObj === "now") {
      return DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy");
    }
    const dt = typeof dateObj === "string" ? DateTime.fromISO(dateObj, { zone: "Asia/Kolkata" }) : DateTime.fromJSDate(dateObj, { zone: "Asia/Kolkata" });
    return (dt.isValid ? dt : DateTime.now().setZone("Asia/Kolkata")).toFormat("dd LLL yyyy");
  });

  eleventyConfig.addFilter("timeAgo", (dateObj) => {
    if (!dateObj) return "Recently";
    const dt = typeof dateObj === "string" ? DateTime.fromISO(dateObj) : DateTime.fromJSDate(dateObj);
    const diff = DateTime.now().diff(dt, ["hours", "minutes", "days"]).toObject();

    if (diff.days >= 1) {
      return `${Math.floor(diff.days)}d ago`;
    } else if (diff.hours >= 1) {
      return `${Math.floor(diff.hours)}h ago`;
    } else if (diff.minutes >= 1) {
      return `${Math.floor(diff.minutes)}m ago`;
    }
    return "Just now";
  });

  eleventyConfig.addFilter("readTime", (content) => {
    if (!content) return "2 min read";
    const wordsPerMinute = 200;
    const words = content.replace(/<[^>]*>?/gm, "").split(/\s+/).length;
    const minutes = Math.ceil(words / wordsPerMinute);
    return `${minutes || 2} min read`;
  });

  eleventyConfig.addFilter("wordCount", (content) => {
    if (!content) return 0;
    return content.replace(/<[^>]*>?/gm, "").trim().split(/\s+/).filter(Boolean).length;
  });

  eleventyConfig.addFilter("categoryColor", (category) => {
    const map = {
      "India": "#C81E2C",
      "World": "#1E4FC8",
      "Business": "#1E8A4C",
      "Tech": "#6B3FA0",
      "Sports": "#D9791E"
    };
    return map[category] || "#C81E2C";
  });

  eleventyConfig.addFilter("categorySlug", (category) => {
    if (!category) return "india";
    return category.toLowerCase().trim();
  });

  eleventyConfig.addFilter("limit", (array, n) => {
    if (!Array.isArray(array)) return [];
    return array.slice(0, n);
  });

  eleventyConfig.addFilter("skip", (array, n) => {
    if (!Array.isArray(array)) return [];
    return array.slice(n);
  });

  eleventyConfig.addFilter("relatedArticles", function (allArticles, currentArticleOrCategory, urlOrLimit = 3, limit = 3) {
    if (!Array.isArray(allArticles) || allArticles.length === 0) return [];
    if (!currentArticleOrCategory) return [];

    let currentCat = "";
    let currentUrl = "";
    let actualLimit = 3;

    if (typeof currentArticleOrCategory === "object" && currentArticleOrCategory !== null) {
      currentUrl = currentArticleOrCategory.url || "";
      currentCat = (currentArticleOrCategory.data && currentArticleOrCategory.data.category) || currentArticleOrCategory.category || "";
      
      if (!currentCat && currentUrl) {
        const found = allArticles.find(item => item.url === currentUrl || (item.page && item.page.url === currentUrl));
        if (found && found.data) {
          currentCat = found.data.category || "";
        }
      }
      if (!currentCat && this && this.ctx && this.ctx.category) {
        currentCat = this.ctx.category;
      }

      actualLimit = typeof urlOrLimit === "number" ? urlOrLimit : limit;
    } else if (typeof currentArticleOrCategory === "string") {
      currentCat = currentArticleOrCategory;
      if (typeof urlOrLimit === "string") {
        currentUrl = urlOrLimit;
        actualLimit = limit;
      } else if (typeof urlOrLimit === "number") {
        actualLimit = urlOrLimit;
      }
    }

    return allArticles
      .filter(item => {
        const itemCat = (item.data && item.data.category) || "";
        const itemUrl = item.url || "";
        const isSameCategory = !currentCat || itemCat.toLowerCase().trim() === currentCat.toLowerCase().trim();
        const isDifferentUrl = !currentUrl || (itemUrl !== currentUrl && !itemUrl.endsWith(currentUrl) && !currentUrl.endsWith(itemUrl));
        return isSameCategory && isDifferentUrl;
      })
      .slice(0, actualLimit);
  });

  eleventyConfig.addFilter("injectAlsoRead", function (contentHtml, relatedArticle) {
    if (!contentHtml) return "";
    if (!relatedArticle || !relatedArticle.url) return contentHtml;

    const urlFilter = eleventyConfig.getFilter("url");
    const articleUrl = urlFilter ? urlFilter(relatedArticle.url) : relatedArticle.url;
    const articleTitle = (relatedArticle.data && relatedArticle.data.title) || "Related Story";

    const alsoReadHtml = `<p class="also-read-inline"><strong>ALSO READ</strong> | <a href="${articleUrl}">${articleTitle}</a></p>`;

    let pCount = 0;
    const modified = contentHtml.replace(/<\/p>/gi, (match) => {
      pCount++;
      if (pCount === 2) {
        return match + "\n" + alsoReadHtml;
      }
      return match;
    });

    if (pCount < 2) {
      return contentHtml + "\n" + alsoReadHtml;
    }
    return modified;
  });

  eleventyConfig.addFilter("categoryArticles", (allArticles, categoryName, limit = 6) => {
    if (!allArticles || !categoryName) return [];
    return allArticles
      .filter(item => (item.data.category || "").toLowerCase() === categoryName.toLowerCase())
      .slice(0, limit);
  });

  eleventyConfig.addFilter("truncateWords", (str, count = 25) => {
    if (!str) return "";
    const words = str.split(" ");
    if (words.length <= count) return str;
    return words.slice(0, count).join(" ") + "...";
  });

  eleventyConfig.addFilter("shortTitle", (str) => {
    if (!str || typeof str !== "string") return "";
    const cleanStr = str.trim();
    if (cleanStr.length <= 65) return cleanStr;
    const sub = cleanStr.slice(0, 65);
    const lastSpace = sub.lastIndexOf(" ");
    if (lastSpace > 0) {
      return sub.slice(0, lastSpace).trim();
    }
    return sub.trim();
  });

  eleventyConfig.addFilter("json", (obj) => {
    return JSON.stringify(obj);
  });

  const defaultPathPrefix = process.env.PATH_PREFIX || "/";
  const cleanPrefix = defaultPathPrefix === "/" ? "" : defaultPathPrefix.replace(/\/$/, "");

  eleventyConfig.addFilter("url", function (url) {
    if (!url) return cleanPrefix ? `${cleanPrefix}/` : "/";
    if (typeof url !== "string") return url;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) return url;
    if (!cleanPrefix) {
      return url.startsWith("/") ? url : `/${url}`;
    }
    if (url.startsWith(`${cleanPrefix}/`)) return url;
    if (url.startsWith("/")) return `${cleanPrefix}${url}`;
    return `${cleanPrefix}/${url}`;
  });



  let latestStoryTime = 0;
  try {
    function scanLatestArtTime(dirPath) {
      let maxT = 0;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullP = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subT = scanLatestArtTime(fullP);
          if (subT > maxT) maxT = subT;
        } else if (entry.name.endsWith(".md")) {
          const content = fs.readFileSync(fullP, "utf8");
          const m = content.match(/date:\s*([^\r\n]+)/);
          if (m) {
            const t = new Date(m[1].trim()).getTime();
            if (t > maxT) maxT = t;
          }
        }
      }
      return maxT;
    }
    latestStoryTime = scanLatestArtTime(path.join(__dirname, "src/articles"));
  } catch (err) {}

  // Check if article is within last 3 hours
  eleventyConfig.addFilter("isJustIn", function (date) {
    if (!date) return false;
    const artTime = new Date(date).getTime();
    if (isNaN(artTime)) return false;
    const now = new Date().getTime();
    const diffNow = now - artTime;
    if (diffNow >= 0 && diffNow <= (3 * 60 * 60 * 1000)) {
      return true;
    }
    // Preview / static reference: if within 3 hours of the latest story on the wire
    if (latestStoryTime > 0) {
      const diffLatest = latestStoryTime - artTime;
      return diffLatest >= 0 && diffLatest <= (3 * 60 * 60 * 1000);
    }
    return false;
  });

  // Check if article is published within last 48 hours for Google News sitemap compliance
  eleventyConfig.addFilter("isRecentNews", function (date) {
    if (!date) return false;
    const artTime = new Date(date).getTime();
    if (isNaN(artTime)) return false;
    const now = new Date().getTime();
    const diff = now - artTime;
    return diff >= 0 && diff <= (48 * 60 * 60 * 1000);
  });

  // Homepage Quality Curation & Priority Scoring
  function getArticleScore(art) {
    if (!art || !art.data) return 0;
    let score = 0;
    const content = art.templateContent || "";
    const words = content.replace(/<[^>]*>?/gm, "").trim().split(/\s+/).filter(Boolean).length;
    
    // Substantive reporting bonus (deprioritize thin stories from homepage)
    if (words >= 250) score += 3;
    else if (words < 180) score -= 3;

    // Editorial verification bonus
    if (art.data.humanReviewed || art.data.human_reviewed) score += 4;
    if (art.data.corroboration_status === "corroborated" || art.data.corroborationStatus === "corroborated") score += 2;

    // Sourced attribution & media bonus
    if (art.data.sourceName || art.data.sourceUrl) score += 1;
    if (art.data.image && art.data.imageAlt) score += 1;

    // Trending & featured flags
    if (art.data.trending === true || art.data.trending === "true") score += 2;
    if (art.data.featured === true || art.data.featured === "true") score += 1;

    return score;
  }

  function sortArticlesByPriority(articles) {
    return [...articles].sort((a, b) => {
      const scoreA = getArticleScore(a);
      const scoreB = getArticleScore(b);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      const timeA = a.date ? new Date(a.date).getTime() : 0;
      const timeB = b.date ? new Date(b.date).getTime() : 0;
      return timeB - timeA;
    });
  }

  eleventyConfig.addFilter("homepageFeed", function (allArticles) {
    if (!Array.isArray(allArticles) || allArticles.length === 0) return [];

    const now = new Date();
    const MS_24H = 24 * 60 * 60 * 1000;
    const MS_48H = 48 * 60 * 60 * 1000;

    let maxArtTime = 0;
    allArticles.forEach(a => {
      const t = a.date ? new Date(a.date).getTime() : 0;
      if (t > maxArtTime) maxArtTime = t;
    });

    const refTime = Math.max(now.getTime(), maxArtTime);

    // 1. Pull articles in the last 24 hours
    let filtered = allArticles.filter(art => {
      const artTime = art.date ? new Date(art.date).getTime() : 0;
      const diff = refTime - artTime;
      return diff >= 0 && diff <= MS_24H;
    });

    // 2. Extend to 48 hours if fewer than 10 exist
    if (filtered.length < 10) {
      filtered = allArticles.filter(art => {
        const artTime = art.date ? new Date(art.date).getTime() : 0;
        const diff = refTime - artTime;
        return diff >= 0 && diff <= MS_48H;
      });
    }

    // 3. Fallback if still under 10
    if (filtered.length < 10) {
      filtered = allArticles.slice(0, 30);
    }

    return sortArticlesByPriority(filtered);
  });

  // Dynamic Featured-News Hero Carousel Filter (Phase 2)
  // Ensures 5-desk diversity (India, World, Business, Tech, Sports) with image availability and priority scoring
  eleventyConfig.addFilter("heroCarouselFeed", function (allArticles, limit = 5) {
    if (!Array.isArray(allArticles) || allArticles.length === 0) return [];

    const valid = allArticles.filter(art => {
      if (!art || !art.data) return false;
      if (art.data.draft || art.data.noindex || art.data.redirect || art.data.redirect_to) return false;
      if (!art.data.image) return false;
      return true;
    });

    if (valid.length === 0) return allArticles.slice(0, limit);

    const sorted = sortArticlesByPriority(valid);

    // Slide 1: Primary Lead Story (top priority overall)
    const lead = sorted[0];
    const selected = [lead];
    const usedUrls = new Set([lead.url || (lead.data && lead.data.slug) || lead.fileSlug]);
    const usedCategories = new Set([lead.data.category ? lead.data.category.toLowerCase() : ""]);

    // Ensure 5-desk representation: India, World, Business, Tech, Sports
    const allDesks = ["india", "world", "business", "tech", "sports"];
    const remainingDesks = allDesks.filter(cat => !usedCategories.has(cat));

    for (const desk of remainingDesks) {
      if (selected.length >= limit) break;
      const deskStory = sorted.find(art => {
        const cat = (art.data.category || "").toLowerCase();
        const key = art.url || (art.data && art.data.slug) || art.fileSlug;
        return cat === desk && !usedUrls.has(key);
      });
      if (deskStory) {
        selected.push(deskStory);
        usedUrls.add(deskStory.url || (deskStory.data && deskStory.data.slug) || deskStory.fileSlug);
        usedCategories.add(desk);
      }
    }

    // Backfill remaining slots if needed
    for (const art of sorted) {
      if (selected.length >= limit) break;
      const key = art.url || (art.data && art.data.slug) || art.fileSlug;
      if (!usedUrls.has(key)) {
        selected.push(art);
        usedUrls.add(key);
      }
    }

    return selected;
  });

  eleventyConfig.addFilter("filterExcludedArticles", function (articles, excludedItems) {
    if (!Array.isArray(articles)) return [];
    if (!Array.isArray(excludedItems)) {
      excludedItems = excludedItems ? [excludedItems] : [];
    }
    const excludedUrls = new Set();
    const excludedSlugs = new Set();

    excludedItems.forEach(item => {
      if (!item) return;
      if (typeof item === "string") {
        excludedUrls.add(item);
        excludedSlugs.add(item);
      } else {
        if (item.url) excludedUrls.add(item.url);
        if (item.page && item.page.url) excludedUrls.add(item.page.url);
        if (item.data && item.data.slug) excludedSlugs.add(item.data.slug);
        if (item.fileSlug) excludedSlugs.add(item.fileSlug);
      }
    });

    return articles.filter(art => {
      const url = art.url || (art.page && art.page.url) || "";
      const slug = (art.data && art.data.slug) || art.fileSlug || "";
      if (url && excludedUrls.has(url)) return false;
      if (slug && excludedSlugs.has(slug)) return false;
      return true;
    });
  });

  // Collections
  eleventyConfig.addCollection("articles", function (collectionApi) {
    const list = collectionApi.getFilteredByGlob("src/articles/**/*.md").sort((a, b) => {
      return b.date - a.date;
    });
    if (list.length > 0 && list[0].date) {
      latestStoryTime = Math.max(latestStoryTime, new Date(list[0].date).getTime());
    }
    return list;
  });

  const categories = ["India", "World", "Business", "Tech", "Sports"];
  categories.forEach(cat => {
    eleventyConfig.addCollection(cat.toLowerCase(), function (collectionApi) {
      return collectionApi.getFilteredByGlob("src/articles/**/*.md")
        .filter(item => (item.data.category || "").toLowerCase() === cat.toLowerCase())
        .sort((a, b) => b.date - a.date);
    });
  });

  eleventyConfig.addCollection("pagedCategoryArticles", function (collectionApi) {
    const site = require("./src/_data/site.js");
    const PAGE_SIZE = 60;
    const pagedList = [];

    site.categories.forEach(cat => {
      const categoryArticles = collectionApi.getFilteredByGlob("src/articles/**/*.md")
        .filter(item => (item.data.category || "").toLowerCase() === cat.slug.toLowerCase())
        .sort((a, b) => b.date - a.date);

      const totalArticles = categoryArticles.length;
      const totalPages = Math.max(Math.ceil(totalArticles / PAGE_SIZE), 1);

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const startIndex = (pageNum - 1) * PAGE_SIZE;
        const pageArticles = categoryArticles.slice(startIndex, startIndex + PAGE_SIZE);

        const permalink = pageNum === 1
          ? `/${cat.slug}/index.html`
          : `/${cat.slug}/${pageNum}/index.html`;

        const url = pageNum === 1
          ? `/${cat.slug}/`
          : `/${cat.slug}/${pageNum}/`;

        pagedList.push({
          category: cat,
          pageNumber: pageNum,
          totalPages: totalPages,
          articles: pageArticles,
          totalArticles: totalArticles,
          permalink: permalink,
          url: url,
          prevPageUrl: pageNum > 1 ? (pageNum === 2 ? `/${cat.slug}/` : `/${cat.slug}/${pageNum - 1}/`) : null,
          nextPageUrl: pageNum < totalPages ? `/${cat.slug}/${pageNum + 1}/` : null
        });
      }
    });

    return pagedList;
  });

  eleventyConfig.addCollection("relatedArticlesByCategory", function (collectionApi) {
    const allArticles = collectionApi.getFilteredByGlob("src/articles/**/*.md").sort((a, b) => b.date - a.date);
    const byCategory = {};
    allArticles.forEach(item => {
      const cat = (item.data.category || "India").toLowerCase().trim();
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    });
    return byCategory;
  });

  const crypto = require("crypto");

  function getFileHash(relPath) {
    try {
      const fullPath = path.join(__dirname, "src", relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        return crypto.createHash("md5").update(content).digest("hex").substring(0, 8);
      }
    } catch (e) {}
    return "1";
  }

  const cssHash = getFileHash("assets/css/style.css");
  const jsHash = getFileHash("assets/js/main.js");

  eleventyConfig.addFilter("cacheBust", function (url) {
    if (typeof url !== "string") return url;
    if (url.includes("style.css")) {
      return url.replace("style.css", `style.${cssHash}.css`);
    }
    if (url.includes("main.js")) {
      return url.replace("main.js", `main.${jsHash}.js`);
    }
    return url;
  });

  eleventyConfig.on("eleventy.after", async ({ dir }) => {
    const outDir = (dir && dir.output) || "_site";
    
    // 1. Minify and emit hashed style.css
    const cssPath = path.join(__dirname, outDir, "assets", "css", "style.css");
    if (fs.existsSync(cssPath)) {
      let css = fs.readFileSync(cssPath, "utf8");
      css = css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*([{}:;,>+~])\s*/g, "$1")
        .replace(/;}/g, "}")
        .trim();
      fs.writeFileSync(cssPath, css, "utf8");
      const hashedCssPath = path.join(__dirname, outDir, "assets", "css", `style.${cssHash}.css`);
      fs.writeFileSync(hashedCssPath, css, "utf8");
    }

    // 2. Emit hashed main.js cleanly
    const jsPath = path.join(__dirname, outDir, "assets", "js", "main.js");
    if (fs.existsSync(jsPath)) {
      const js = fs.readFileSync(jsPath, "utf8");
      fs.writeFileSync(jsPath, js, "utf8");
      const hashedJsPath = path.join(__dirname, outDir, "assets", "js", `main.${jsHash}.js`);
      fs.writeFileSync(hashedJsPath, js, "utf8");
    }

    // 3. Emit dynamic 1200x630 Open Graph social cards
    const { generateOgImages } = require("./tools/generate-og-images");
    await generateOgImages({ outputDir: path.join(__dirname, outDir, "assets", "og") });
  });

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk"
  };
};