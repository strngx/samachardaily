/**
 * Samachar Daily — Articles Computed Data & Media Relevance Guardrails
 * 
 * Enforces strict temporal and entity relevance for video embeds:
 * 1. Rejects stale videos (e.g. 2015-2024 YouTube results on current 2026 news articles).
 * 2. Rejects unrelated videos with zero semantic/entity overlap.
 * 3. Rejects YouTube shorts, reels, and commercial classifieds.
 * 4. Rejects generic keyword collisions (e.g. single country/city/broad noun match).
 * 5. Ensures "NO VIDEO" is the safe default when suitable media is absent.
 */

const genericTerms = new Set([
  'india', 'indian', 'australia', 'australian', 'us', 'usa', 'america', 'american',
  'uk', 'britain', 'british', 'china', 'chinese', 'japan', 'japanese', 'russia', 'russian',
  'delhi', 'mumbai', 'bengaluru', 'bangalore', 'kolkata', 'chennai', 'hyderabad',
  'police', 'court', 'government', 'minister', 'chief', 'state', 'centre', 'official',
  'hospital', 'case', 'road', 'roads', 'car', 'cars', 'bus', 'train', 'fire',
  'market', 'markets', 'stocks', 'stock', 'bank', 'banks', 'money', 'price', 'prices',
  'high', 'low', 'first', 'second', 'third', 'day', 'week', 'month', 'year',
  'live', 'video', 'watch', 'full', 'match', 'game', 'report', 'reports', 'news'
]);

const stopWords = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'it', 'its', 'from', 'into',
  'over', 'after', 'new', 'latest', 'today', 'how', 'what', 'why', 'who', 'when', 'where',
  'vs', 'versus', 'highlights', 'review', 'analysis', 'explained'
]);

function isRelevantVideo(data) {
  const vid = data.video_id || data.videoId;
  if (!vid || vid === "null" || String(vid).trim() === "") return false;

  const caption = (data.video_caption || data.videoCaption || "").toLowerCase();
  const title = (data.title || "").toLowerCase();
  const dateStr = String(data.date || "");

  // 1. YouTube Shorts / Social media noise filter
  if (caption.includes("#shorts") || caption.includes("#reels") || caption.includes("#videoshort") || caption.includes("#tiktok")) {
    return false;
  }

  // 2. Personal ads / commercial spam filter
  if (caption.includes("contact:") || caption.includes("whatsapp") || caption.includes("for sale") || caption.includes("#flat #home")) {
    return false;
  }

  // 3. Temporal gate:
  // Current news cycle (2025/2026/2027) rejects older historical videos (1980-2024) unless the article title explicitly covers that historical year
  const articleYearMatch = dateStr.match(/202[4-7]/);
  const articleYear = articleYearMatch ? parseInt(articleYearMatch[0], 10) : 2026;

  const pastYearMatch = caption.match(/\b(19\d\d|200\d|201\d|202[0-4])\b/);
  if (pastYearMatch) {
    const videoYear = parseInt(pastYearMatch[1], 10);
    if (articleYear >= 2025 && videoYear <= 2024 && !title.includes(pastYearMatch[1])) {
      return false;
    }
  }

  // 4. Entity / Topic keyword overlap
  const cleanWords = (text) => text.replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  const titleWords = cleanWords(title);
  const captionWords = cleanWords(caption);

  if (!caption || caption.length < 5) {
    return false;
  }

  const titleSet = new Set(titleWords);
  const common = captionWords.filter(w => titleSet.has(w));
  const specificMatches = common.filter(w => !genericTerms.has(w));

  // Must have at least 2 specific non-generic words OR 1 specific non-generic word with total 2+ common words
  if (specificMatches.length >= 2) return true;
  if (specificMatches.length === 1 && (specificMatches[0].length >= 5 || common.length >= 2)) return true;

  return false;
}

module.exports = {
  layout: "layouts/article.njk",
  eleventyComputed: {
    video_id: (data) => {
      const vid = data.video_id || data.videoId || "";
      if (!vid) return "";
      return isRelevantVideo(data) ? vid : "";
    }
  }
};
