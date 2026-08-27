const { DateTime } = require("luxon");
const pluginRss = require("@11ty/eleventy-plugin-rss");

module.exports = function(eleventyConfig) {
  // Plugins
  eleventyConfig.addPlugin(pluginRss);

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

  eleventyConfig.addFilter("relatedArticles", (allArticles, currentArticle, limit = 3) => {
    if (!allArticles || !currentArticle) return [];
    const currentCat = (currentArticle.data && currentArticle.data.category) || "";
    const currentUrl = currentArticle.url || "";
    return allArticles
      .filter(item => item.url !== currentUrl && item.data.category === currentCat)
      .slice(0, limit);
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

  // Collections
  eleventyConfig.addCollection("articles", function(collectionApi) {
    return collectionApi.getFilteredByGlob("src/articles/**/*.md").sort((a, b) => {
      return b.date - a.date;
    });
  });

  const categories = ["India", "World", "Business", "Tech", "Sports"];
  categories.forEach(cat => {
    eleventyConfig.addCollection(cat.toLowerCase(), function(collectionApi) {
      return collectionApi.getFilteredByGlob("src/articles/**/*.md")
        .filter(item => (item.data.category || "").toLowerCase() === cat.toLowerCase())
        .sort((a, b) => b.date - a.date);
    });
  });

  return {
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
