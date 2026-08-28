module.exports = {
  layout: "layouts/article.njk",
  eleventyComputed: {
    video_id: (data) => data.video_id || data.videoId || ""
  }
};
