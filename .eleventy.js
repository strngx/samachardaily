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

  function getFeaturedAndArchive(articles) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return { featured: [], archive: [] };
    }

    const isTrending = (art) => {
      const tm = art.data && (art.data.trendingMatch || art.data.trending_match || "");
      return typeof tm === "string" && tm.toLowerCase().trim() === "yes";
    };

    const trendingArticles = articles.filter(isTrending);
    const nonTrendingArticles = articles.filter(art => !isTrending(art));

    const featured = [];
    trendingArticles.forEach(art => {
      if (featured.length < 3) {
        featured.push(art);
      }
    });

    nonTrendingArticles.forEach(art => {
      if (featured.length < 3) {
        featured.push(art);
      }
    });

    const featuredUrls = new Set(featured.map(a => a.url));
    const archive = articles.filter(art => !featuredUrls.has(art.url));

    return { featured, archive };
  }

  eleventyConfig.addFilter("featuredArticles", (articles) => {
    return getFeaturedAndArchive(articles).featured;
  });

  eleventyConfig.addFilter("archiveArticles", (articles) => {
    return getFeaturedAndArchive(articles).archive;
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