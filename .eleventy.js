const { DateTime } = require("luxon");
const pluginRss = require("@11ty/eleventy-plugin-rss");

module.exports = function (eleventyConfig) {
  // Plugins
  eleventyConfig.addPlugin(pluginRss);

  // Prevent html-transformer from double-prefixing URLs that explicitly use the url filter
  if (eleventyConfig.transforms) {
    delete eleventyConfig.transforms["@11ty/eleventy/html-transformer"];
  }

  // Passthrough static assets
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/.nojekyll": ".nojekyll" });

  // Custom Filters
  eleventyConfig.addFilter("readableDate", (dateObj, format = "dd LLL yyyy, hh:mm a") => {
    if (!dateObj || dateObj === "now") {
      return DateTime.now().setZone("Asia/Kolkata").toFormat(format) + " IST";
    }
    const dt = typeof dateObj === "string" ? DateTime.fromISO(dateObj, { zone: "Asia/Kolkata" }) : DateTime.fromJSDate(dateObj, { zone: "Asia/Kolkata" });
    return (dt.isValid ? dt : DateTime.now().setZone("Asia/Kolkata")).toFormat(format) + " IST";
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
    if (cleanStr.length <= 60) return cleanStr;
    const sub = cleanStr.slice(0, 60);
    const lastSpace = sub.lastIndexOf(" ");
    if (lastSpace > 0) {
      return sub.slice(0, lastSpace).trim();
    }
    return sub.trim();
  });

  eleventyConfig.addFilter("json", (obj) => {
    return JSON.stringify(obj);
  });

  eleventyConfig.addFilter("url", function (url) {
    if (!url) return "/samachardaily/";
    if (typeof url !== "string") return url;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) return url;
    if (url.startsWith("/samachardaily/")) return url;
    if (url.startsWith("/")) return "/samachardaily" + url;
    return "/samachardaily/" + url;
  });

  function splitCategoryArticlesByAge(articles) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return { mainList: [], archiveList: [] };
    }

    const now = new Date();
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

    const mainList = [];
    const archiveList = [];

    articles.forEach(art => {
      const artDate = art.date ? new Date(art.date) : now;
      const ageMs = now.getTime() - artDate.getTime();
      if (ageMs >= TWO_WEEKS_MS) {
        archiveList.push(art);
      } else {
        mainList.push(art);
      }
    });

    return { mainList, archiveList };
  }

  eleventyConfig.addFilter("mainCategoryArticles", (articles) => {
    return splitCategoryArticlesByAge(articles).mainList;
  });

  eleventyConfig.addFilter("archiveCategoryArticles", (articles) => {
    return splitCategoryArticlesByAge(articles).archiveList;
  });

  // Check if article is within last 3 hours
  eleventyConfig.addFilter("isJustIn", function (date, featured) {
    if (featured === true || featured === "true") return true;
    if (!date) return false;
    const artTime = new Date(date).getTime();
    if (isNaN(artTime)) return false;
    const now = new Date().getTime();
    const diff = Math.abs(now - artTime);
    return diff <= (3 * 60 * 60 * 1000);
  });

  // Homepage Priority Scoring & Unified Feed Filter
  function getArticleScore(art) {
    const isTrending = art.data && (art.data.trending === true || art.data.trending === "true");
    const isFeatured = art.data && (art.data.featured === true || art.data.featured === "true");
    if (isTrending) return 2;
    if (isFeatured) return 1;
    return 0;
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
    return collectionApi.getFilteredByGlob("src/articles/**/*.md").sort((a, b) => {
      return b.date - a.date;
    });
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
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const pagedList = [];

    site.categories.forEach(cat => {
      const categoryArticles = collectionApi.getFilteredByGlob("src/articles/**/*.md")
        .filter(item => (item.data.category || "").toLowerCase() === cat.slug.toLowerCase())
        .sort((a, b) => b.date - a.date);

      const mainList = [];
      const archiveList = [];

      categoryArticles.forEach(art => {
        const artDate = art.date ? new Date(art.date) : now;
        const ageMs = now.getTime() - artDate.getTime();
        if (ageMs >= TWO_WEEKS_MS) {
          archiveList.push(art);
        } else {
          mainList.push(art);
        }
      });

      const totalMain = mainList.length;
      const totalPages = Math.max(Math.ceil(totalMain / PAGE_SIZE), 1);

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const startIndex = (pageNum - 1) * PAGE_SIZE;
        const pageMainArticles = mainList.slice(startIndex, startIndex + PAGE_SIZE);

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
          articles: pageMainArticles,
          mainArticles: pageMainArticles,
          archiveArticles: pageNum === 1 ? archiveList : [],
          totalArticles: totalMain,
          permalink: permalink,
          url: url,
          prevPageUrl: pageNum > 1 ? (pageNum === 2 ? `/${cat.slug}/` : `/${cat.slug}/${pageNum - 1}/`) : null,
          nextPageUrl: pageNum < totalPages ? `/${cat.slug}/${pageNum + 1}/` : null
        });
      }
    });

    return pagedList;
  });

  return {
    pathPrefix: "/samachardaily/",
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