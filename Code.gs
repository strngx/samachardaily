/**
 * SamacharDaily - Cloud-Native Auto-Blogger Google Apps Script Pipeline
 * Version: 2.1.0
 * 
 * Focus Desks:
 * 1. India (/india/)
 * 2. World (/world/)
 * 3. Business (/business/)
 * 4. Tech (/tech/)
 * 5. Sports (/sports/)
 * 
 * Pipeline Fixes Included:
 * - Fix 1: Image Quality Guard (validateImage_ with byte-size & upscale CDN stripping)
 * - Fix 2: Language Guard (isNonEnglishTitle_ filtering mistagged non-English news)
 * - Fix 3: Cross-Source Duplicate Detection (>60% keyword overlap against GitHub category history)
 * - Fix 4: Date-Anchored Groq Prompt (explicit current UTC date to avoid training hallucinated years)
 * - Fix 5: Expose Trending Signal to Frontend (trending: true/false frontmatter)
 * - Fix 6: Multiple Videos per Article (searchYouTubeVideo_ returns top 3 videos array + YAML list)
 * - Fix 7: Real 'What Happens Next' Content (Groq schema key + what_happens_next frontmatter)
 */

// ============================================================================
// 1. CONFIGURATION & SCRIPT PROPERTIES
// ============================================================================

/**
 * Retrieves environment properties configured in Google Apps Script.
 * Settings -> Script Properties
 */
function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    GITHUB_TOKEN: props.getProperty('GITHUB_TOKEN') || '',
    GITHUB_REPO: props.getProperty('GITHUB_REPO') || 'strngx/samachardaily',
    GITHUB_BRANCH: props.getProperty('GITHUB_BRANCH') || 'main',
    GROQ_API_KEY: props.getProperty('GROQ_API_KEY') || '',
    NEWSDATA_API_KEY: props.getProperty('NEWSDATA_API_KEY') || '',
    CURRENTS_API_KEY: props.getProperty('CURRENTS_API_KEY') || '',
    PEXELS_API_KEY: props.getProperty('PEXELS_API_KEY') || '',
    YOUTUBE_API_KEY: props.getProperty('YOUTUBE_API_KEY') || '',
    AUTHOR_NAME: props.getProperty('AUTHOR_NAME') || 'SamacharDaily Editorial Team'
  };
}

/**
 * Category Desk Configurations
 */
var CATEGORY_CONFIG = {
  'india': {
    name: 'India',
    folder: 'src/articles/india',
    newsDataCategory: 'top,politics,entertainment',
    newsDataCountry: 'in',
    currentsCategory: 'regional',
    currentsKeywords: 'India',
    trendGeo: 'IN'
  },
  'world': {
    name: 'World',
    folder: 'src/articles/world',
    newsDataCategory: 'world,entertainment',
    newsDataCountry: 'us,gb,au,ca,in',
    currentsCategory: 'world',
    currentsKeywords: 'World diplomacy geopolitics',
    trendGeo: 'US'
  },
  'business': {
    name: 'Business',
    folder: 'src/articles/business',
    newsDataCategory: 'business',
    newsDataCountry: 'in,us',
    currentsCategory: 'business',
    currentsKeywords: 'Business economy markets',
    trendGeo: 'IN'
  },
  'tech': {
    name: 'Tech',
    folder: 'src/articles/tech',
    newsDataCategory: 'technology,science',
    newsDataCountry: 'in,us',
    currentsCategory: 'technology',
    currentsKeywords: 'Technology AI software hardware',
    trendGeo: 'IN'
  },
  'sports': {
    name: 'Sports',
    folder: 'src/articles/sports',
    newsDataCategory: 'sports',
    newsDataCountry: 'in,us,gb',
    currentsCategory: 'sports',
    currentsKeywords: 'Cricket sports championship football',
    trendGeo: 'IN'
  }
};

// ============================================================================
// 2. LANGUAGE GUARD (Fix 2)
// ============================================================================

/**
 * Detects if a headline title is non-English despite API metadata tags.
 * Checks non-ASCII/Latin script ratio and common foreign stopword signatures.
 * 
 * @param {string} title - The news headline to inspect.
 * @returns {boolean} True if the title is identified as non-English.
 */
function isNonEnglishTitle_(title) {
  if (!title || typeof title !== 'string') return true;
  var cleanTitle = title.trim();
  if (cleanTitle.length === 0) return true;

  // 1. Check for non-Latin script Unicode blocks (Devanagari, Cyrillic, Chinese, Arabic, Hebrew, Thai, Japanese)
  if (/[\u0900-\u097F\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F\u3040-\u30FF]/.test(cleanTitle)) {
    return true;
  }

  // 2. High ratio of non-ASCII characters
  var nonAsciiMatches = cleanTitle.match(/[^\x00-\x7F]/g);
  var nonAsciiCount = nonAsciiMatches ? nonAsciiMatches.length : 0;
  var nonAsciiRatio = nonAsciiCount / cleanTitle.length;
  if (nonAsciiRatio > 0.12) {
    return true;
  }

  // 3. Stopword pattern detection for Spanish, Portuguese, French, German, Italian
  var lower = ' ' + cleanTitle.toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
  var foreignStopwords = [
    // Spanish / Portuguese
    ' el ', ' la ', ' los ', ' las ', ' un ', ' una ', ' unos ', ' unas ',
    ' de ', ' del ', ' para ', ' por ', ' con ', ' sobre ', ' entre ',
    ' que ', ' como ', ' pero ', ' mas ', ' mais ', ' este ', ' esta ',
    ' são ', ' não ', ' um ', ' uma ', ' pelos ', ' pelas ', ' após ',
    ' até ', ' contra ', ' seus ', ' suas ', ' foi ', ' foram ',
    // French
    ' le ', ' les ', ' du ', ' des ', ' dans ', ' pour ', ' avec ', ' sur ',
    // German
    ' der ', ' die ', ' das ', ' und ', ' für ', ' mit ', ' auf ', ' von ',
    // Italian
    ' gli ', ' nella ', ' delle ', ' sono ', ' alla '
  ];

  var matchCount = 0;
  for (var i = 0; i < foreignStopwords.length; i++) {
    if (lower.indexOf(foreignStopwords[i]) !== -1) {
      matchCount++;
    }
  }

  if (matchCount >= 2) {
    return true;
  }

  // High-signal foreign news keywords
  if (/\b(notícias|noticias|última hora|dernière heure|nachrichten|cronaca|morre|queda|muerte|guerra|presidente)\b/i.test(cleanTitle)) {
    if (matchCount >= 1 || nonAsciiCount > 0) {
      return true;
    }
  }

  return false;
}

var INDIA_SIGNAL_PATTERN = /\b(india|indian|modi|delhi|mumbai|bengaluru|bangalore|kolkata|chennai|hyderabad|pune|bihar|punjab|kerala|gujarat|maharashtra|rajasthan|karnataka|tamil nadu|west bengal|uttar pradesh|lok sabha|rajya sabha|rbi|sebi|bjp|congress party|rupee)\b/i;

/**
 * Checks if a news story contains India-relevant geographic or institutional signals.
 */
function isIndiaRelevant_(title, description) {
  var text = (title || '') + ' ' + (description || '');
  return INDIA_SIGNAL_PATTERN.test(text);
}

var SPAM_PATTERN = /\b(market size|market share|cagr|forecast to 2\d{3}|usd\s+\d+(\.\d+)?\s+(million|billion)|press release|pr newswire|globenewswire|market research)\b/i;

/**
 * Checks if a headline matches syndicated market-research or PR-wire spam.
 *
 * @param {string} title - Headline to check.
 * @returns {boolean} True if matched as market-report/PR spam.
 */
function isPressReleaseSpam_(title) {
  if (!title || typeof title !== 'string') return false;
  return SPAM_PATTERN.test(title);
}

var TICKER_DUMP_PATTERN = /\b(short interest|shares outstanding|institutional ownership|insider (buying|selling)|13F filing|price target (raised|lowered)|moving average|NASDAQ:|NYSE:|hedge fund holdings)\b/i;

var LOCAL_SPORTS_SUFFIX_PATTERN = /\b(high school|pool play|invitational|junior varsity|jv|little league|middle school|prep roundup|prep sports)\b/i;
var LOCAL_SPORTS_RECAP_PATTERN = /\b(sweeps|splits|edges past|powers past|rallies past|takes down|rolls past|shuts out|holds off|top seeds|undefeated in pool)\b/i;
var PRO_MAJOR_SPORTS_PATTERN = /\b(nfl|nba|mlb|nhl|fifa|uefa|premier league|la liga|serie a|bundesliga|ipl|bcci|icc|test|odi|t20|world cup|olympics|champions league|atp|wta|pga|formula 1|f1|isl|national team|championship)\b/i;

/**
 * Checks if a headline represents low-substance content (ticker dumps or small-scale local recaps).
 *
 * @param {string} title - Headline to check.
 * @returns {boolean} True if low-substance content.
 */
function isLowSubstance_(title) {
  if (!title || typeof title !== 'string') return false;

  // 1. Stock / finance ticker dump
  if (TICKER_DUMP_PATTERN.test(title)) {
    return true;
  }

  // 2. Local youth / high school sports recaps (without professional/major signals)
  if (LOCAL_SPORTS_SUFFIX_PATTERN.test(title) && LOCAL_SPORTS_RECAP_PATTERN.test(title)) {
    if (!PRO_MAJOR_SPORTS_PATTERN.test(title)) {
      return true;
    }
  }

  return false;
}

var GAMBLING_PATTERN = /\b(prop bet|prop picks?|betting (odds|lines|picks)|best bets?|parlay|moneyline|point spread|over\/under|lock of the (day|week)|sportsbook|bet slip|wager|odds to win|futures odds)\b/i;

/**
 * Checks if a headline involves sports betting, odds, or gambling content (AdSense policy risk).
 *
 * @param {string} title - Headline to check.
 * @returns {boolean} True if gambling/betting content.
 */
function isGamblingContent_(title) {
  if (!title || typeof title !== 'string') return false;
  return GAMBLING_PATTERN.test(title);
}

var LISTICLE_PATTERN = /^(\d+\s+(essential|best|top|reasons|ways|things|tips|features|mistakes)|why you (should|need)|how to |the ultimate guide|everything you need to know about)/i;

/**
 * Checks if a headline matches generic listicle or how-to blog formats.
 *
 * @param {string} title - Headline to check.
 * @returns {boolean} True if listicle/blog format.
 */
function isListicleFormat_(title) {
  if (!title || typeof title !== 'string') return false;
  return LISTICLE_PATTERN.test(title.trim());
}

var SELF_PROMO_PATTERN = /\b(success at|shines at|showcases? (its|their)|proud to (announce|present)|celebrates? (its|their) success|wins accolades at|receives? recognition at)\b/i;

/**
 * Checks if a headline matches self-promotional, corporate self-praise, or tourism-board PR.
 *
 * @param {string} title - Headline to check.
 * @returns {boolean} True if self-promotional content.
 */
function isSelfPromotional_(title) {
  if (!title || typeof title !== 'string') return false;
  return SELF_PROMO_PATTERN.test(title);
}

var ENTERTAINMENT_NEWSWORTHY_PATTERN = /\b(dies|dead at \d|death of|passes away|obituary|arrested|files for divorce|divorce finalized|marries|got engaged|hospitalized|scandal|lawsuit|sues|sentenced|wins (an |the )?(oscar|grammy|award)|nominated for (an |the )?(oscar|grammy)|announces (new |his |her )?(movie|film|series|album|world tour)|trailer released|box office|makes (his|her) directorial debut|joins the cast|signs (a )?deal|biopic|announces retirement|comeback|passed away)\b/i;

var ENTERTAINMENT_NOISE_PATTERN = /\b(live stream|streaming online|tv schedule|episode guide|watch live|live results|segment|playlist|new single|song by|ft\.|featuring|carnival|haunted house|theme park|anniversary event|market size|CAGR|press release|prnewswire|globenewswire|song drops|drops new)\b/i;

/**
 * Strict two-part filter for newsworthy celebrity and entertainment news.
 * Must be categorized under entertainment, match at least one newsworthy signal, and NOT match any noise pattern.
 *
 * @param {string} title - Headline.
 * @param {string} description - Summary or description.
 * @param {Array<string>} categories - Categories array from API.
 * @returns {boolean} True if newsworthy entertainment story.
 */
function isNewsworthyEntertainment_(title, description, categories) {
  var itemCategories = categories || [];
  if (itemCategories.indexOf('entertainment') === -1) {
    return false;
  }
  var text = (title || '') + ' ' + (description || '');
  var hasNewsworthySignal = ENTERTAINMENT_NEWSWORTHY_PATTERN.test(text);
  var hasNoiseSignal = ENTERTAINMENT_NOISE_PATTERN.test(text);

  return hasNewsworthySignal && !hasNoiseSignal;
}

// ============================================================================
// 3. CROSS-SOURCE DUPLICATE & KEYWORD OVERLAP DETECTION (Fix 3)
// ============================================================================

var ENGLISH_STOPWORDS = {
  'a': 1, 'about': 1, 'above': 1, 'after': 1, 'again': 1, 'against': 1, 'all': 1, 'am': 1, 'an': 1,
  'and': 1, 'any': 1, 'are': 1, 'as': 1, 'at': 1, 'be': 1, 'because': 1, 'been': 1, 'before': 1,
  'being': 1, 'below': 1, 'between': 1, 'both': 1, 'but': 1, 'by': 1, 'could': 1, 'did': 1, 'do': 1,
  'does': 1, 'doing': 1, 'down': 1, 'during': 1, 'each': 1, 'few': 1, 'for': 1, 'from': 1, 'further': 1,
  'had': 1, 'has': 1, 'have': 1, 'having': 1, 'he': 1, 'her': 1, 'here': 1, 'hers': 1, 'herself': 1,
  'him': 1, 'himself': 1, 'his': 1, 'how': 1, 'i': 1, 'if': 1, 'in': 1, 'into': 1, 'is': 1, 'it': 1,
  'its': 1, 'itself': 1, 'just': 1, 'me': 1, 'more': 1, 'most': 1, 'my': 1, 'myself': 1, 'no': 1,
  'nor': 1, 'not': 1, 'now': 1, 'of': 1, 'off': 1, 'on': 1, 'once': 1, 'only': 1, 'or': 1, 'other': 1,
  'ought': 1, 'our': 1, 'ours': 1, 'ourselves': 1, 'out': 1, 'over': 1, 'own': 1, 'same': 1, 'she': 1,
  'should': 1, 'so': 1, 'some': 1, 'such': 1, 'than': 1, 'that': 1, 'the': 1, 'their': 1, 'theirs': 1,
  'them': 1, 'themselves': 1, 'then': 1, 'there': 1, 'these': 1, 'they': 1, 'this': 1, 'those': 1,
  'through': 1, 'to': 1, 'too': 1, 'under': 1, 'until': 1, 'up': 1, 'very': 1, 'was': 1, 'we': 1,
  'were': 1, 'what': 1, 'when': 1, 'where': 1, 'which': 1, 'while': 1, 'who': 1, 'whom': 1, 'why': 1,
  'with': 1, 'would': 1, 'you': 1, 'your': 1, 'yours': 1, 'yourself': 1, 'yourselves': 1,
  'says': 1, 'said': 1, 'news': 1, 'new': 1, 'report': 1, 'reports': 1, 'will': 1, 'may': 1, 'amid': 1,
  'first': 1, 'day': 1, 'post': 1, 'latest': 1
};

/**
 * Extracts a normalized, sorted set of unique keywords from a string.
 *
 * @param {string} text - Title or slug to process.
 * @returns {Array<string>} Array of unique normalized keywords.
 */
function extractKeywords_(text) {
  if (!text || typeof text !== 'string') return [];
  var words = text.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s_-]+/)
    .filter(function(w) {
      return w.length >= 3 && !ENGLISH_STOPWORDS[w] && !/^\d+$/.test(w);
    });

  var uniqueSet = {};
  var result = [];
  for (var i = 0; i < words.length; i++) {
    if (!uniqueSet[words[i]]) {
      uniqueSet[words[i]] = true;
      result.push(words[i]);
    }
  }
  return result.sort();
}

/**
 * Calculates overlap ratio between two keyword sets relative to the smaller set.
 *
 * @param {Array<string>} keywordsA
 * @param {Array<string>} keywordsB
 * @returns {number} Ratio between 0.0 and 1.0.
 */
function calculateKeywordOverlapRatio_(keywordsA, keywordsB) {
  if (!keywordsA || !keywordsB || keywordsA.length === 0 || keywordsB.length === 0) return 0.0;
  var setB = {};
  for (var i = 0; i < keywordsB.length; i++) {
    setB[keywordsB[i]] = true;
  }
  var matchCount = 0;
  for (var j = 0; j < keywordsA.length; j++) {
    if (setB[keywordsA[j]]) {
      matchCount++;
    }
  }
  var minLength = Math.min(keywordsA.length, keywordsB.length);
  return matchCount / minLength;
}

/**
 * Retrieves recent published articles in a category folder from GitHub API.
 *
 * @param {string} categoryKey - Category identifier.
 * @param {Object} config - Configuration object.
 * @returns {Array<Object>} List of existing file items with parsed keywords.
 */
function getRecentCategoryArticles_(categoryKey, config) {
  var catCfg = CATEGORY_CONFIG[categoryKey.toLowerCase()] || { folder: 'src/articles/' + categoryKey.toLowerCase() };
  var folderPath = catCfg.folder;
  var url = 'https://api.github.com/repos/' + config.GITHUB_REPO + '/contents/' + folderPath + '?ref=' + config.GITHUB_BRANCH;
  var headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'SamacharDaily-AutoBlogger'
  };
  if (config.GITHUB_TOKEN) {
    headers['Authorization'] = 'token ' + config.GITHUB_TOKEN;
  }

  try {
    var resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var files = JSON.parse(resp.getContentText());
      if (Array.isArray(files)) {
        return files.filter(function(f) {
          return f.type === 'file' && f.name.endsWith('.md');
        }).map(function(f) {
          var slugName = f.name.replace(/\.md$/, '');
          return {
            name: f.name,
            slug: slugName,
            keywords: extractKeywords_(slugName)
          };
        });
      }
    }
  } catch (err) {
    Logger.log('Error fetching recent category articles from GitHub: ' + err.toString());
  }
  return [];
}

/**
 * Checks if exact slug already exists on GitHub repository.
 *
 * @param {string} slug - Article slug.
 * @param {string} categoryKey - Category identifier.
 * @param {Object} config - Configuration object.
 * @returns {boolean} True if file exists.
 */
function isDuplicate_(slug, categoryKey, config) {
  var catCfg = CATEGORY_CONFIG[categoryKey.toLowerCase()] || { folder: 'src/articles/' + categoryKey.toLowerCase() };
  var filePath = catCfg.folder + '/' + slug + '.md';
  var url = 'https://api.github.com/repos/' + config.GITHUB_REPO + '/contents/' + filePath + '?ref=' + config.GITHUB_BRANCH;
  var headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'SamacharDaily-AutoBlogger'
  };
  if (config.GITHUB_TOKEN) {
    headers['Authorization'] = 'token ' + config.GITHUB_TOKEN;
  }
  try {
    var resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    return (resp.getResponseCode() === 200);
  } catch (e) {
    return false;
  }
}

// ============================================================================
// 4. IMAGE QUALITY GUARD (Fix 1)
// ============================================================================

/**
 * Validates article photo quality before publishing.
 * - Strips or rejects forced-upscale CDN parameters (e.g. enlarge=true).
 * - Verifies HTTP availability and rejects thumbnails (< 15KB).
 *
 * @param {string} url - Image URL to validate.
 * @returns {string|null} Cleaned valid image URL, or null if validation fails.
 */
function validateImage_(url) {
  if (!url || typeof url !== 'string') return null;
  var trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  // 1. Strip or reject URLs containing forced-upscale query params
  var cleanedUrl = trimmed
    .replace(/([?&])enlarge=(?:true|1|yes)(&|$)/gi, '$1')
    .replace(/[?&]$/, '');

  if (/enlarge=true/i.test(cleanedUrl)) {
    Logger.log('Rejecting image containing enlarge=true: ' + cleanedUrl);
    return null;
  }

  // 2. Reject domains known to block cross-origin hotlinking (HTTP 403)
  if (/\b(c\.ndtvimg\.com)\b/i.test(cleanedUrl)) {
    Logger.log('Rejecting image from domain with strict hotlinking protection: ' + cleanedUrl);
    return null;
  }

  // 2. Perform HEAD / partial fetch check to verify byte size
  try {
    var headOptions = {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Range': 'bytes=0-20480'
      }
    };
    var resp = UrlFetchApp.fetch(cleanedUrl, headOptions);
    var statusCode = resp.getResponseCode();

    if ((statusCode < 200 || statusCode >= 300) && statusCode !== 206) {
      Logger.log('Image validation failed (HTTP ' + statusCode + '): ' + cleanedUrl);
      return null;
    }

    var headers = resp.getAllHeaders();
    var contentType = headers['Content-Type'] || headers['content-type'] || '';
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      Logger.log('Image validation failed (Content-Type ' + contentType + '): ' + cleanedUrl);
      return null;
    }

    // Check Content-Length header proxy
    var contentLengthStr = headers['Content-Length'] || headers['content-length'];
    if (contentLengthStr) {
      var size = parseInt(contentLengthStr, 10);
      if (!isNaN(size) && size < 15360) { // Reject under ~15KB
        Logger.log('Image validation failed: size ' + size + ' bytes is under 15KB threshold: ' + cleanedUrl);
        return null;
      }
    }

    return cleanedUrl;
  } catch (err) {
    Logger.log('Image validation error for ' + url + ': ' + err.toString());
    return null;
  }
}

// ============================================================================
// 5. GROQ EDITORIAL SYNTHESIS (Fixes 4 & 7)
// ============================================================================

/**
 * Rewrites news wire dispatch into high-credibility SamacharDaily article.
 * Date-anchored system prompt prevents training hallucinated years.
 * Adds what_happens_next concrete forward-looking section.
 *
 * @param {Object} headline - The selected candidate news dispatch.
 * @param {string} category - Focus category name.
 * @param {Object} config - Configuration object.
 * @returns {Object} Parsed JSON article structure.
 */
function rewriteWithGroq_(headline, category, config) {
  if (!config.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY in script properties.');
  }

  // Anchor current date explicitly to prevent hallucinated historical years (Fix 4)
  var todayDateStr = Utilities.formatDate(new Date(), 'Etc/UTC', 'MMMM d, yyyy');

  var systemPrompt = 'You are a senior investigative and wire editor at SamacharDaily, a high-velocity Indian and international digital news publication.\n' +
    "Today's date is " + todayDateStr + '.\n' +
    "Do not reference years, cycles, or 'upcoming' events using any year other than what's explicitly stated in the source headline/description — never infer or carry over a year from your own training data.\n\n" +
    'Editorial Requirements:\n' +
    '1. Craft a high-credibility, authoritative headline (60-90 characters) in sharp newsroom tone (no clickbait).\n' +
    '2. Write a crisp "dek" (1-2 sentence executive summary).\n' +
    '3. Produce 2-3 detailed paragraphs of rigorous journalistic reporting synthesizing the core facts.\n' +
    '4. Compose a 2-paragraph "why_it_matters" section analyzing institutional, policy, or market impact.\n' +
    '5. Provide "what_happens_next" (Fix 7): 1 short paragraph (40-70 words) on concrete next steps specific to THIS story — not generic boilerplate. If genuinely nothing concrete is known, write "No confirmed next steps reported yet."\n' +
    '6. Provide a targeted "image_keyword" for editorial photo search (e.g. "semiconductor cleanroom", "cricket stadium floodlights").\n' +
    '7. Provide a concise "video_query" for broadcast coverage search.\n\n' +
    'You MUST return ONLY a valid JSON object matching this exact structure:\n' +
    '{\n' +
    '  "title": "String (authoritative headline)",\n' +
    '  "dek": "String (1-2 sentence executive summary)",\n' +
    '  "content": ["Paragraph 1 string...", "Paragraph 2 string...", "Paragraph 3 string..."],\n' +
    '  "why_it_matters": "Paragraph 1\\n\\nParagraph 2",\n' +
    '  "what_happens_next": "1 short paragraph (40-70 words) on concrete next steps specific to THIS story — not generic boilerplate. If genuinely nothing concrete is known, write \'No confirmed next steps reported yet.\'",\n' +
    '  "image_keyword": "String",\n' +
    '  "video_query": "String"\n' +
    '}';

  var userPrompt = 'Category: ' + category + '\n' +
    'Source Headline: ' + headline.title + '\n' +
    'Source Description: ' + (headline.description || '') + '\n' +
    'Source Content Snippet: ' + (headline.content || '') + '\n' +
    'Source Outlet: ' + (headline.sourceName || 'News Wire');

  var payload = {
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 2048
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + config.GROQ_API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', options);
  var statusCode = resp.getResponseCode();

  // Handle Groq 429 Rate Limit with single 10-second retry backoff
  if (statusCode === 429) {
    Logger.log('Groq 429 rate limit reached. Backing off for 10 seconds before single retry...');
    Utilities.sleep(10000);
    resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', options);
    statusCode = resp.getResponseCode();
  }

  // Handle Groq 400 json_validate_failed with simplified fallback retry
  if (statusCode === 400) {
    var respText = resp.getContentText();
    if (respText.indexOf('json_validate_failed') !== -1) {
      Logger.log('Groq 400 json_validate_failed encountered. Retrying with simplified fallback (max_tokens: 1500)...');
      var fallbackSystemPrompt = systemPrompt + '\nKeep all string values concise and ensure the JSON is complete and properly closed.';
      var fallbackPayload = {
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: fallbackSystemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1500
      };
      var fallbackOptions = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'Authorization': 'Bearer ' + config.GROQ_API_KEY
        },
        payload: JSON.stringify(fallbackPayload),
        muteHttpExceptions: true
      };
      resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', fallbackOptions);
      statusCode = resp.getResponseCode();
    }
  }

  if (statusCode !== 200) {
    throw new Error('Groq API error (' + statusCode + '): ' + resp.getContentText());
  }

  var parsed = JSON.parse(resp.getContentText());
  var resultText = parsed.choices[0].message.content;
  return JSON.parse(resultText);
}

// ============================================================================
// 6. YOUTUBE VIDEO SEARCH (Fix 6)
// ============================================================================

/**
 * Searches YouTube Data API v3 for relevant broadcast videos.
 * Returns up to top 3 videos as an array for video-grid frontend presentation.
 *
 * @param {string} query - Search query.
 * @param {Object} config - Configuration object.
 * @returns {Array<Object>} Array of up to 3 video objects {video_id, title, channel}.
 */
function searchYouTubeVideo_(query, config) {
  if (!config.YOUTUBE_API_KEY || !query) return [];
  try {
    var url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=3&q=' +
      encodeURIComponent(query) + '&type=video&key=' + config.YOUTUBE_API_KEY;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.items && data.items.length > 0) {
        return data.items.slice(0, 3).map(function(v) {
          return {
            video_id: v.id.videoId,
            title: v.snippet.title,
            channel: v.snippet.channelTitle
          };
        });
      }
    }
  } catch (err) {
    Logger.log('YouTube API search error: ' + err.toString());
  }
  return [];
}

// ============================================================================
// 7. MARKDOWN & FRONTMATTER BUILDER (Fixes 5, 6, 7)
// ============================================================================

/**
 * Truncates headline to 60 characters at last full word for SEO title tag.
 *
 * @param {string} title - Full headline string.
 * @returns {string} Truncated SEO title without trailing punctuation/ellipsis.
 */
function generateSeoTitle_(title) {
  if (!title || typeof title !== 'string') return '';
  var cleanTitle = title.trim();
  if (cleanTitle.length <= 60) return cleanTitle;
  var sub = cleanTitle.substring(0, 60);
  var lastSpace = sub.lastIndexOf(' ');
  if (lastSpace > 0) {
    return sub.substring(0, lastSpace).trim();
  }
  return sub.trim();
}

/**
 * Constructs production Markdown file with complete frontmatter schema.
 *
 * @param {Object} article - Groq synthesized article.
 * @param {Object} image - Validated image object {url, alt, credit}.
 * @param {Array<Object>} videos - Array of video objects from searchYouTubeVideo_.
 * @param {string} sourceUrl - Original source URL.
 * @param {Object} headline - Source candidate metadata (including trendingMatch).
 * @returns {string} Fully formatted Markdown document.
 */
function buildMarkdown_(article, image, videos, sourceUrl, headline, isFeatured) {
  var nowIso = Utilities.formatDate(new Date(), 'Etc/UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  
  // Fix 5: Expose trending signal to frontend
  var isTrending = (headline && headline.trendingMatch === 'yes') ? 'true' : 'false';
  var featuredFlag = isFeatured ? 'true' : 'false';

  // Fix 6: Top video and videos array
  var topVideoId = (videos && videos.length > 0) ? videos[0].video_id : '';
  var topVideoCaption = (videos && videos.length > 0) ? videos[0].title : '';

  var videosYaml = '';
  if (videos && videos.length > 0) {
    videosYaml = 'videos:\n' + videos.map(function(v) {
      var safeTitle = (v.title || '').replace(/"/g, '\\"');
      var safeChannel = (v.channel || '').replace(/"/g, '\\"');
      return '  - video_id: "' + v.video_id + '"\n    title: "' + safeTitle + '"\n    channel: "' + safeChannel + '"';
    }).join('\n');
  } else {
    videosYaml = 'videos: []';
  }

  // Format content paragraphs
  var contentBody = '';
  if (Array.isArray(article.content)) {
    contentBody = article.content.join('\n\n');
  } else if (typeof article.content === 'string') {
    contentBody = article.content;
  }

  var safeTitle = (article.title || '').replace(/"/g, '\\"');
  var seoTitle = generateSeoTitle_(article.title || '');
  var safeSeoTitle = seoTitle.replace(/"/g, '\\"');
  var safeDek = (article.dek || '').replace(/"/g, '\\"');
  var safeImageAlt = (image && image.alt ? image.alt : safeTitle).replace(/"/g, '\\"');
  var safeImageCredit = (image && image.credit ? image.credit : 'SamacharDaily Desk').replace(/"/g, '\\"');
  var safeSourceName = (headline && headline.sourceName ? headline.sourceName : safeImageCredit).replace(/"/g, '\\"');
  var safeWhyItMatters = (article.why_it_matters || '').trim();
  // Fix 7: Real what_happens_next
  var safeWhatHappensNext = (article.what_happens_next || 'No confirmed next steps reported yet.').replace(/"/g, '\\"');

  var md = [
    '---',
    'title: "' + safeTitle + '"',
    'seoTitle: "' + safeSeoTitle + '"',
    'category: "' + (headline.categoryName || 'India') + '"',
    'date: ' + nowIso,
    'image: "' + (image && image.url ? image.url : '') + '"',
    'imageAlt: "' + safeImageAlt + '"',
    'imageCredit: "' + safeImageCredit + '"',
    'trending: ' + isTrending,
    'featured: ' + featuredFlag,
    'video_id: "' + topVideoId + '"',
    'video_caption: "' + topVideoCaption.replace(/"/g, '\\"') + '"',
    videosYaml,
    'slug: "' + headline.slug + '"',
    'sourceUrl: "' + (sourceUrl || '') + '"',
    'sourceName: "' + safeSourceName + '"',
    'dek: "' + safeDek + '"',
    'author: "SamacharDaily Editorial Team"',
    'why_it_matters: |',
    safeWhyItMatters.split('\n').map(function(line) { return '  ' + line; }).join('\n'),
    'what_happens_next: "' + safeWhatHappensNext + '"',
    '---',
    contentBody,
    ''
  ].join('\n');

  return md;
}

// ============================================================================
// 8. NEWS DATA & CURRENTS FETCHERS (Fix 2)
// ============================================================================

/**
 * Fetches news candidates from NewsData.io API.
 * Applies Language Guard (Fix 2) to exclude mistagged non-English items.
 */
function fetchFromNewsData_(categoryKey, config) {
  if (!config.NEWSDATA_API_KEY) return [];
  var isIndiaDesk = categoryKey.toLowerCase() === 'india';
  var isWorldDesk = categoryKey.toLowerCase() === 'world';
  var catCfg = CATEGORY_CONFIG[categoryKey.toLowerCase()] || CATEGORY_CONFIG['india'];
  var url = 'https://newsdata.io/api/1/latest?apikey=' + config.NEWSDATA_API_KEY +
    '&language=en&category=' + catCfg.newsDataCategory;
  if (catCfg.newsDataCountry) {
    url += '&country=' + catCfg.newsDataCountry;
  }

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.results && data.results.length > 0) {
        return data.results
          .filter(function(item) {
            // Language Guard (Fix 2)
            if (!item || !item.title || isNonEnglishTitle_(item.title)) {
              return false;
            }

            var itemCategories = item.category || [];
            var isEntertainment = isNewsworthyEntertainment_(item.title, item.description, itemCategories);

            // India desk: skip isIndiaRelevant_ if newsworthy entertainment (country=in guarantees India source)
            if (isIndiaDesk) {
              if (!isEntertainment && !isIndiaRelevant_(item.title, item.description)) {
                return false;
              }
            }

            // World desk: exclude if newsworthy entertainment AND India-relevant (belongs to India desk)
            if (isWorldDesk) {
              if (isEntertainment && isIndiaRelevant_(item.title, item.description)) {
                return false;
              }
            }

            return true;
          })
          .map(function(item) {
            return {
              title: item.title,
              description: item.description || '',
              content: item.content || item.description || '',
              categories: item.category || [],
              sourceName: item.source_name || item.source_id || 'NewsData Wire',
              sourceUrl: item.link || '',
              imageUrl: item.image_url || null,
              pubDate: item.pubDate || new Date().toISOString()
            };
          });
      }
    } else {
      Logger.log('NewsData API returned HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText());
    }
  } catch (err) {
    Logger.log('NewsData API error: ' + err.toString());
  }
  return [];
}

/**
 * Fallback news fetcher from Currents API.
 * Applies Language Guard (Fix 2) to exclude mistagged non-English items.
 */
function fetchFromCurrents_(categoryKey, config) {
  if (!config.CURRENTS_API_KEY) return [];
  var isIndiaDesk = categoryKey.toLowerCase() === 'india';
  var isWorldDesk = categoryKey.toLowerCase() === 'world';
  var catCfg = CATEGORY_CONFIG[categoryKey.toLowerCase()] || CATEGORY_CONFIG['india'];
  var url = 'https://api.currentsapi.services/v1/latest-news?language=en&category=' +
    catCfg.currentsCategory + '&apiKey=' + config.CURRENTS_API_KEY;

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.news && data.news.length > 0) {
        return data.news
          .filter(function(item) {
            // Language Guard (Fix 2)
            if (!item || !item.title || isNonEnglishTitle_(item.title)) {
              return false;
            }

            var itemCategories = item.category || [];
            var isEntertainment = isNewsworthyEntertainment_(item.title, item.description, itemCategories);

            // India desk: skip isIndiaRelevant_ if newsworthy entertainment
            if (isIndiaDesk) {
              if (!isEntertainment && !isIndiaRelevant_(item.title, item.description)) {
                return false;
              }
            }

            // World desk: exclude if newsworthy entertainment AND India-relevant
            if (isWorldDesk) {
              if (isEntertainment && isIndiaRelevant_(item.title, item.description)) {
                return false;
              }
            }

            return true;
          })
          .map(function(item) {
            return {
              title: item.title,
              description: item.description || '',
              content: item.description || '',
              categories: item.category || [],
              sourceName: item.author || 'Currents Wire',
              sourceUrl: item.url || '',
              imageUrl: (item.image && item.image !== 'None') ? item.image : null,
              pubDate: item.published || new Date().toISOString()
            };
          });
      }
    } else {
      Logger.log('Currents API returned HTTP ' + resp.getResponseCode());
    }
  } catch (err) {
    Logger.log('Currents API error: ' + err.toString());
  }
  return [];
}

// ============================================================================
// 9. TREND SCORING
// ============================================================================

/**
 * Scores a candidate against Google Trends RSS feeds.
 *
 * @param {Object} candidate - Candidate news item.
 * @param {string} trendGeo - Country code for trends (e.g. 'IN', 'US').
 * @returns {string} 'yes' or 'no'.
 */
function scoreAgainstTrends_(candidate, trendGeo) {
  var geo = trendGeo || 'IN';
  try {
    var trendsRssUrl = 'https://trends.google.com/trending/rss?geo=' + geo;
    var resp = UrlFetchApp.fetch(trendsRssUrl, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var xml = XmlService.parse(resp.getContentText());
      var items = xml.getRootElement().getChild('channel').getChildren('item');
      var trendTitles = items.map(function(it) {
        return it.getChildText('title') || '';
      }).filter(Boolean);

      var candidateKeywords = extractKeywords_(candidate.title);
      for (var i = 0; i < trendTitles.length; i++) {
        var trendLower = trendTitles[i].toLowerCase();
        for (var j = 0; j < candidateKeywords.length; j++) {
          if (candidateKeywords[j].length >= 4 && trendLower.indexOf(candidateKeywords[j]) !== -1) {
            return 'yes';
          }
        }
      }
    }
  } catch (err) {
    Logger.log('Trend scoring error: ' + err.toString());
  }
  return 'no';
}

// ============================================================================
// 10. PEXELS IMAGE FALLBACK & SLUG GENERATOR
// ============================================================================

/**
 * Fetches high-resolution landscape photo from Pexels API.
 */
function fetchImage_(keyword, config) {
  if (config.PEXELS_API_KEY && keyword) {
    try {
      var url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(keyword) + '&per_page=1&orientation=landscape';
      var resp = UrlFetchApp.fetch(url, {
        headers: { 'Authorization': config.PEXELS_API_KEY },
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() === 200) {
        var data = JSON.parse(resp.getContentText());
        if (data.photos && data.photos.length > 0) {
          var photo = data.photos[0];
          return {
            url: photo.src.large || photo.src.medium || photo.src.landscape,
            alt: photo.alt || keyword,
            credit: photo.photographer || 'Pexels Contributor'
          };
        }
      }
    } catch (err) {
      Logger.log('Pexels API error: ' + err.toString());
    }
  }

  var fallbackImages = [
    { url: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=80', alt: 'Global Newsroom and Editorial Reporting', credit: 'Unsplash' },
    { url: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80', alt: 'Daily News and Newspaper Headlines', credit: 'Unsplash' },
    { url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80', alt: 'Technology and Global Connectivity', credit: 'Unsplash' }
  ];
  var randomIndex = Math.floor(Math.random() * fallbackImages.length);
  return fallbackImages[randomIndex];
}

/**
 * Generates clean, URL-safe slug from title.
 */
function generateSlug_(title) {
  if (!title) return 'article-' + Date.now();
  var slug = title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  return slug.substring(0, 85).replace(/-$/, '');
}

// ============================================================================
// 11. GITHUB PUBLISHING VIA REST API
// ============================================================================

/**
 * Publishes or updates markdown file on GitHub repository.
 */
function publishToGitHub_(filePath, markdownContent, commitMessage, config) {
  if (!config.GITHUB_TOKEN || !config.GITHUB_REPO) {
    throw new Error('Missing GITHUB_TOKEN or GITHUB_REPO in script properties.');
  }

  var url = 'https://api.github.com/repos/' + config.GITHUB_REPO + '/contents/' + filePath;
  var headers = {
    'Authorization': 'token ' + config.GITHUB_TOKEN,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'SamacharDaily-AutoBlogger'
  };

  var sha = null;
  try {
    var checkResp = UrlFetchApp.fetch(url + '?ref=' + config.GITHUB_BRANCH, {
      headers: headers,
      muteHttpExceptions: true
    });
    if (checkResp.getResponseCode() === 200) {
      var existingData = JSON.parse(checkResp.getContentText());
      sha = existingData.sha;
    }
  } catch (e) {
    // File doesn't exist yet
  }

  var payload = {
    message: commitMessage,
    content: Utilities.base64Encode(markdownContent, Utilities.Charset.UTF_8),
    branch: config.GITHUB_BRANCH
  };
  if (sha) {
    payload.sha = sha;
  }

  var options = {
    method: 'put',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub API publish failed (' + code + '): ' + resp.getContentText());
  }

  Logger.log('Successfully published to GitHub: ' + filePath);
  return JSON.parse(resp.getContentText());
}

// ============================================================================
// 12. ORCHESTRATION PIPELINE
// ============================================================================

/**
 * Core orchestration function for an editorial category desk.
 *
 * @param {string} categoryKey - 'india', 'world', 'business', 'tech', 'sports'
 * @returns {Object} Execution result metadata.
 */
function runPipelineForCategory_(categoryKey) {
  var key = categoryKey.toLowerCase();
  var catCfg = CATEGORY_CONFIG[key];
  if (!catCfg) {
    throw new Error('Invalid category key: ' + categoryKey);
  }

  var config = getConfig_();
  Logger.log('Starting pipeline for Desk: ' + catCfg.name);

  // Step 1: Fetch candidates (NewsData -> Currents fallback)
  var candidates = fetchFromNewsData_(key, config);
  if (!candidates || candidates.length === 0) {
    Logger.log('NewsData returned 0 candidates, attempting CurrentsAPI fallback...');
    candidates = fetchFromCurrents_(key, config);
  }

  if (!candidates || candidates.length === 0) {
    Logger.log('No news candidates found for ' + catCfg.name + '. Skipping.');
    return { success: false, reason: 'No news candidates found' };
  }

  // Step 2: Cross-Source Duplicate & Overlap Detection and Trending Selection
  var recentGitHubArticles = getRecentCategoryArticles_(key, config);
  Logger.log('Found ' + recentGitHubArticles.length + ' existing articles in category ' + catCfg.name);

  var validCandidates = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];

    // Reject gambling and betting content (AdSense policy risk)
    if (isGamblingContent_(c.title)) {
      Logger.log('SKIPPED (Gambling/Betting Content - Policy Risk): "' + c.title + '"');
      continue;
    }

    // Reject syndicated market-research and PR-wire spam
    if (isPressReleaseSpam_(c.title)) {
      Logger.log('Skipping market report / PR spam candidate: "' + c.title + '"');
      continue;
    }

    // Reject low-substance content (ticker dumps, local school sports recaps)
    if (isLowSubstance_(c.title)) {
      Logger.log('Skipping low-substance candidate: "' + c.title + '"');
      continue;
    }

    // Reject listicles and generic blog formats
    if (isListicleFormat_(c.title)) {
      Logger.log('Skipping listicle/blog format candidate: "' + c.title + '"');
      continue;
    }

    // Reject self-promotional and tourism-board self-praise
    if (isSelfPromotional_(c.title)) {
      Logger.log('Skipping self-promotional candidate: "' + c.title + '"');
      continue;
    }

    var slug = generateSlug_(c.title);

    // Exact duplicate slug check
    if (isDuplicate_(slug, key, config)) {
      Logger.log('Skipping exact slug duplicate: ' + slug);
      continue;
    }

    // Cross-source duplicate check (Fix 3): >60% keyword overlap with articles in category
    var candidateKeywords = extractKeywords_(c.title);
    var isOverlapDuplicate = false;
    for (var j = 0; j < recentGitHubArticles.length; j++) {
      var existingArt = recentGitHubArticles[j];
      var overlapRatio = calculateKeywordOverlapRatio_(candidateKeywords, existingArt.keywords);
      if (overlapRatio > 0.60) {
        Logger.log('Skipping cross-source duplicate (>60% overlap: ' +
          Math.round(overlapRatio * 100) + '%) between "' + c.title + '" and "' + existingArt.slug + '"');
        isOverlapDuplicate = true;
        break;
      }
    }
    if (isOverlapDuplicate) {
      continue;
    }

    // Passed duplicate guards
    c.slug = slug;
    c.categoryName = catCfg.name;
    // Compute trend score before selection
    c.trendingMatch = scoreAgainstTrends_(c, catCfg.trendGeo);
    validCandidates.push(c);
  }

  if (validCandidates.length === 0) {
    Logger.log('All candidates filtered out as duplicates or non-English. Skipping run.');
    return { success: false, reason: 'All candidates duplicate or non-English' };
  }

  // Sort valid candidates: trendingMatch === 'yes' first, then newer pubDate
  validCandidates.sort(function(a, b) {
    var aTrend = a.trendingMatch === 'yes' ? 1 : 0;
    var bTrend = b.trendingMatch === 'yes' ? 1 : 0;
    if (aTrend !== bTrend) {
      return bTrend - aTrend;
    }
    var aDate = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    var bDate = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bDate - aDate;
  });

  var selectedCandidate = validCandidates[0];
  Logger.log('Selected candidate from ' + validCandidates.length + ' valid items: "' +
    selectedCandidate.title + '" [Trending: ' + selectedCandidate.trendingMatch + ']');

  var isFeatured = (function() {
    if (!selectedCandidate.pubDate) return false;
    var published = new Date(selectedCandidate.pubDate);
    var ageMs = Date.now() - published.getTime();
    return ageMs > 0 && ageMs <= (3 * 60 * 60 * 1000);
  })();

  // Step 3: Editorial synthesis with Groq (Fixes 4 & 7)
  Logger.log('Synthesizing article with Groq Llama 3.3...');
  var article = rewriteWithGroq_(selectedCandidate, catCfg.name, config);

  // Step 4: Image Quality Guard (Fix 1)
  var imageObj = null;
  var imageSourceLabel = '';
  if (selectedCandidate.imageUrl) {
    var validatedUrl = validateImage_(selectedCandidate.imageUrl);
    if (validatedUrl) {
      imageObj = {
        url: validatedUrl,
        alt: article.title || selectedCandidate.title,
        credit: selectedCandidate.sourceName || 'Official Dispatch'
      };
      imageSourceLabel = 'article_photo';
      Logger.log('Using validated article photo: ' + validatedUrl);
    } else {
      Logger.log('Article photo failed validation. Falling back to Pexels...');
    }
  }

  if (!imageObj) {
    imageObj = fetchImage_(article.image_keyword || catCfg.name, config);
    imageSourceLabel = 'pexels';
    Logger.log('Using Pexels/curated editorial image for: ' + (article.image_keyword || catCfg.name));
  }

  // Step 5: Video Search - Top 3 Videos (Fix 6)
  var videoQuery = article.video_query || selectedCandidate.title;
  var videos = searchYouTubeVideo_(videoQuery, config);
  Logger.log('Found ' + videos.length + ' matching YouTube videos.');

  // Step 6: Build Markdown & Frontmatter (Fixes 5, 6, 7)
  var markdownContent = buildMarkdown_(article, imageObj, videos, selectedCandidate.sourceUrl, selectedCandidate, isFeatured);

  // Step 7: Publish to GitHub
  var targetPath = catCfg.folder + '/' + selectedCandidate.slug + '.md';
  var commitMsg = 'Auto-publish: ' + selectedCandidate.slug;
  var publishResult = publishToGitHub_(targetPath, markdownContent, commitMsg, config);

  return {
    success: true,
    slug: selectedCandidate.slug,
    category: catCfg.name,
    trending: selectedCandidate.trendingMatch,
    imageSource: imageSourceLabel,
    videosCount: videos.length,
    github: publishResult
  };
}

// ============================================================================
// 13. DESK RUNNERS & TRIGGER SETUP
// ============================================================================

function runPipelineAllCategories() {
  var keys = ['india', 'world', 'business', 'tech', 'sports'];
  var results = {};
  for (var i = 0; i < keys.length; i++) {
    try {
      results[keys[i]] = runPipelineForCategory_(keys[i]);
    } catch (err) {
      Logger.log('Error running pipeline for ' + keys[i] + ': ' + err.toString());
      results[keys[i]] = { success: false, error: err.toString() };
    }
    // 15-second rate limit buffer between desks to stay safely under Groq TPM limit
    Utilities.sleep(15000);
  }
  return results;
}

function runIndiaDesk() { return runPipelineForCategory_('india'); }
function runWorldDesk() { return runPipelineForCategory_('world'); }
function runBusinessDesk() { return runPipelineForCategory_('business'); }
function runTechDesk() { return runPipelineForCategory_('tech'); }
function runSportsDesk() { return runPipelineForCategory_('sports'); }

/**
 * Helper to install standard time-based triggers in Google Apps Script.
 */
function setupAutomatedTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  ScriptApp.newTrigger('runIndiaDesk').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('runWorldDesk').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('runBusinessDesk').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('runTechDesk').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('runSportsDesk').timeBased().everyHours(2).create();
  Logger.log('Automated time-based triggers configured successfully.');
}
