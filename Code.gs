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
    GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY') || '',
    CEREBRAS_API_KEY: props.getProperty('CEREBRAS_API_KEY') || '',
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
// 2. LANGUAGE GUARD (INPUT & OUTPUT VALIDATION)
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
  if (nonAsciiRatio > 0.10) {
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
    ' em ', ' no ', ' na ', ' nos ', ' nas ', ' ao ', ' aos ', ' declara ',
    ' culpado ', ' ex presidente ', ' caso de ',
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
  if (/\b(notícias|noticias|última hora|dernière heure|nachrichten|cronaca|morre|queda|muerte|guerra|presidente|declara culpado|tribunal do)\b/i.test(cleanTitle)) {
    if (matchCount >= 1 || nonAsciiCount > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Detects if a body paragraph or text section is non-English.
 *
 * @param {string} text - Text to analyze.
 * @returns {boolean} True if non-English.
 */
function isNonEnglishText_(text) {
  if (!text || typeof text !== 'string') return false;
  var clean = text.trim();
  if (clean.length === 0) return false;

  // 1. Non-Latin scripts
  if (/[\u0900-\u097F\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F\u3040-\u30FF]/.test(clean)) {
    return true;
  }

  // 2. High ratio of accented/non-ASCII chars
  var nonAsciiMatches = clean.match(/[^\x00-\x7F]/g);
  var nonAsciiCount = nonAsciiMatches ? nonAsciiMatches.length : 0;
  if ((nonAsciiCount / clean.length) > 0.08) {
    return true;
  }

  // 3. Foreign stopword frequency test
  var lower = ' ' + clean.toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
  var foreignStopwords = [
    ' o ', ' a ', ' os ', ' as ', ' um ', ' uma ', ' uns ', ' umas ',
    ' de ', ' do ', ' da ', ' dos ', ' das ', ' no ', ' na ', ' nos ', ' nas ',
    ' pelo ', ' pela ', ' pelos ', ' pelas ', ' em ', ' para ', ' por ', ' com ',
    ' que ', ' como ', ' mais ', ' mas ', ' este ', ' esta ', ' estes ', ' estas ',
    ' são ', ' não ', ' após ', ' até ', ' contra ', ' seus ', ' suas ', ' foi ',
    ' foram ', ' era ', ' eram ', ' caso ', ' corrupção ', ' governo ', ' tribunal ',
    ' el ', ' la ', ' los ', ' las ', ' del ', ' sobre ', ' entre ', ' pero ',
    ' le ', ' la ', ' les ', ' du ', ' des ', ' dans ', ' pour ', ' avec ', ' sur ',
    ' der ', ' die ', ' das ', ' ein ', ' eine ', ' und ', ' für ', ' mit '
  ];

  var matchCount = 0;
  for (var i = 0; i < foreignStopwords.length; i++) {
    var regex = new RegExp(foreignStopwords[i], 'g');
    var matches = lower.match(regex);
    if (matches) {
      matchCount += matches.length;
    }
  }

  var totalWords = clean.split(/\s+/).length;
  if (totalWords > 10 && (matchCount / totalWords) > 0.06) {
    return true;
  }
  if (totalWords <= 10 && matchCount >= 2) {
    return true;
  }

  return false;
}

/**
 * Validates whether the synthesized article output (title, dek, body) is strictly English (Issue #4).
 *
 * @param {Object} articleObj - Synthesized article JSON object.
 * @returns {boolean} True if the article output is verified English.
 */
function isArticleOutputEnglish_(articleObj) {
  if (!articleObj || typeof articleObj !== 'object') return false;
  if (isNonEnglishTitle_(articleObj.title)) return false;
  if (articleObj.seoTitle && isNonEnglishTitle_(articleObj.seoTitle)) return false;
  if (articleObj.dek && isNonEnglishText_(articleObj.dek)) return false;

  var bodyText = '';
  if (Array.isArray(articleObj.content)) {
    bodyText = articleObj.content.join(' ');
  } else if (typeof articleObj.content === 'string') {
    bodyText = articleObj.content;
  }

  if (bodyText && isNonEnglishText_(bodyText)) return false;
  if (articleObj.why_it_matters && isNonEnglishText_(articleObj.why_it_matters)) return false;

  return true;
}

var INDIA_SIGNAL_PATTERN = /\b(india|indian|modi|delhi|mumbai|bengaluru|bangalore|kolkata|chennai|hyderabad|pune|bihar|punjab|kerala|gujarat|maharashtra|rajasthan|karnataka|tamil nadu|west bengal|uttar pradesh|lok sabha|rajya sabha|rbi|sebi|bjp|congress party|rupee)\b/i;

/**
 * Checks if a news story contains India-relevant geographic or institutional signals.
 */
function isIndiaRelevant_(title, description) {
  var text = (title || '') + ' ' + (description || '');
  return INDIA_SIGNAL_PATTERN.test(text);
}

var SPAM_TITLE_PATTERN = /\b(market size|market share|cagr|forecast to 2\d{3}|usd\s+\d+(\.\d+)?\s*(million|billion|m|b)|press release|pr newswire|globenewswire|businesswire|market research|market projected to reach)\b/i;

var SPAM_BODY_PATTERN = /\b(market is projected to reach|projected to reach usd|market size was valued at|cagr of \d+(\.\d+)?%|according to a new report by|published by (grand view research|allied market research|technavio|marketsandmarkets|transparency market research|coherent market insights|fortunebusinessinsights|verified market research|persistencemarketresearch|market research future|spherical insights|polarismarketresearch)|global .+ market report|key players profiled in this report)\b/i;

/**
 * Checks if a candidate matches syndicated market-research or PR-wire spam across title, description, or body.
 *
 * @param {string} title - Headline.
 * @param {string} description - Description or summary.
 * @param {string} content - Body content.
 * @returns {boolean} True if matched as market-report/PR spam.
 */
function isPressReleaseSpam_(title, description, content) {
  var titleText = title || '';
  if (SPAM_TITLE_PATTERN.test(titleText)) return true;

  var fullText = (title || '') + ' ' + (description || '') + ' ' + (content || '');
  return SPAM_BODY_PATTERN.test(fullText);
}

var WIRE_SUMMARY_PATTERN = /\b(AP\s+([A-Za-z\s]+)?(Summary|Brief)s?\s+at\s+\d+:\d+|\bAP\s+Sports\s+Summary\b|\bReuters\s+Briefs?\b|\bDaily\s+Rundown\s+Breaking\b|\bNews\s+Roundup\s+at\s+\d+:\d+|\bBriefing\s+at\s+\d+:\d+)\b/i;

/**
 * Checks if a title is a raw wire ticker dump or automated summary brief.
 *
 * @param {string} title - Headline.
 * @returns {boolean} True if wire summary dump.
 */
function isWireSummaryDump_(title) {
  if (!title || typeof title !== 'string') return false;
  return WIRE_SUMMARY_PATTERN.test(title);
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

var GAMBLING_PATTERN = /\b(polymarket|kalshi|betmgm|fanduel|draftkings|bovada|bet365|sportsbook|promo code|bonus code|deposit match|prop bet|prop picks?|betting (odds|lines|picks|market)|best bets?|parlay|moneyline|point spread|over\/under|lock of the (day|week)|bet slip|wager|wagering|odds to win|futures odds|prediction market)\b/i;

/**
 * Checks if candidate involves gambling, betting, wagering, or prediction market promotions (AdSense policy risk).
 *
 * @param {string} title - Headline to check.
 * @param {string} description - Summary or description.
 * @returns {boolean} True if gambling/betting content.
 */
function isGamblingContent_(title, description) {
  var text = (title || '') + ' ' + (description || '');
  return GAMBLING_PATTERN.test(text);
}

var COMMERCIAL_DEAL_PATTERN = /\b(\d+%\s*off|coupon|promo code|\bdeals?\b|on sale|drops? to \$\d+|discounted?|price drop|save \$\d+|lowest price ever|special offer on (amazon|walmart|best buy|target|flipkart)|on amazon with coupon|with coupon code)\b/i;

/**
 * Checks if candidate is promotional deal, coupon, or retailer SKU price-drop content.
 *
 * @param {string} title - Headline.
 * @param {string} description - Summary or description.
 * @returns {boolean} True if commercial deal/coupon spam.
 */
function isCommercialDeal_(title, description) {
  var text = (title || '') + ' ' + (description || '');
  return COMMERCIAL_DEAL_PATTERN.test(text);
}

var GAME_HINTS_AND_STREAM_PATTERN = /\b(quordle|wordle|connections|crossword|strands|spelling bee|octordle|contexto)\s+(hints?|clues?|answers?|today|daily)|today's\s+(quordle|wordle|connections|crossword|strands)\b|\b(how to watch|where to watch|watch\s+.+\s+live\s+stream|streaming details|live stream channel|live stream online|air time and tv channel)\b/i;

/**
 * Checks if candidate is game-puzzle answer hints or pure streaming availability schedule dumps.
 *
 * @param {string} title - Headline.
 * @param {string} description - Summary or description.
 * @returns {boolean} True if puzzle hint or streaming listing.
 */
function isAggregatorOrGameHint_(title, description) {
  var text = (title || '') + ' ' + (description || '');
  return GAME_HINTS_AND_STREAM_PATTERN.test(text);
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

/**
 * FIX 2: Content Relevance Filtering.
 * Excludes hyperlocal US small-town noise (city/county-specific business,
 * local real estate, high school sports) that has no relevance to an India-focused global news audience.
 *
 * @param {Object} headline - Candidate headline object with title and description.
 * @param {string} category - Category key.
 * @returns {boolean} True if candidate is relevant.
 */
function isRelevantCandidate_(headline, category) {
  var title = (headline.title || '').toLowerCase();
  var desc = (headline.description || '').toLowerCase();
  var text = title + ' ' + desc;
  
  // Exclude hyperlocal US small-town noise (city/county-specific business, 
  // local real estate, high school sports) that has no relevance to an 
  // India-focused global news audience
  var excludePatterns = [
    /\bhigh school\b/, /\bfactory closes\b/, /\bfactory closing\b/,
    /\blocal home sales\b/, /\bmost expensive home\b/, /\bsingle-family\b/,
    /\bdonut\b/, /\bhometown\b/, /\bfreshman quarterback\b/
  ];
  for (var i = 0; i < excludePatterns.length; i++) {
    if (excludePatterns[i].test(text)) return false;
  }
  return true;
}

/**
 * Classifies story by true subject matter to prevent cross-category misrouting (Issue #3).
 *
 * @param {string} title - Headline.
 * @param {string} description - Summary or description.
 * @param {Array<string>} categories - Raw categories from API.
 * @returns {string} 'sports' | 'tech' | 'business' | 'world' | 'india'
 */
function classifyStoryCategory_(title, description, categories) {
  var text = ((title || '') + ' ' + (description || '')).toLowerCase();
  
  // 1. SPORTS (sports match results, championships, athletes regardless of nationality)
  var sportsSignal = /\b(cricket|chess|grand chess tour|grandmaster|fide|praggnanandhaa|gukesh|erigaisi|diamond league|neeraj chopra|javelin|ipl|bcci|icc|test match|odi|t20|world cup|olympics|fifa|uefa|premier league|champions league|la liga|serie a|bundesliga|football|soccer|tennis|atp|wta|us open|wimbledon|french open|australian open|badminton|bwf|formula 1|f1|grand prix|motogp|hockey|fih|nba|nfl|mlb|nhl|pga tour|golf|boxing|ufc|mma|wrestling|wwe|asian games|commonwealth games|world championship|vuelta|tour de france|giro)\b/i;
  var sportsActionSignal = /\b(beats|defeats|wins title|clinches gold|clinches title|tournament|championship|match victory|semi-final|quarter-final|final round|qualifies for final|scores goal|hat-trick|century|wicket|podium finish|silver medal|bronze medal|stage win|solos to win)\b/i;
  
  if (sportsSignal.test(text) || (categories && categories.indexOf('sports') !== -1 && sportsActionSignal.test(text))) {
    return 'sports';
  }

  // 2. TECH (products, software, AI, hardware, robotics, cybersecurity)
  var techSignal = /\b(artificial intelligence|\bai\b|generative ai|llm|chatgpt|openai|anthropic|gemini ai|claude ai|deepseek|voice authentication|detectifai|facial recognition|cybersecurity|malware|ransomware|semiconductor|semiconductors|microchip|microchips|nvidia|tsmc|qualcomm|intel|amd|smartphone|smartphones|iphone|android|software update|cloud computing|supercomputer|quantum computing|robotics|humanoid robot|kddi.+robot)\b/i;
  if (techSignal.test(text) || (categories && (categories.indexOf('technology') !== -1 || categories.indexOf('tech') !== -1 || categories.indexOf('science') !== -1))) {
    if (techSignal.test(text)) {
      return 'tech';
    }
  }

  // 3. BUSINESS & MARKETS (financial regulation, IPO, markets, corporate earnings)
  var businessSignal = /\b(sebi|rbi|ipo|initial public offering|stock market|sensex|nifty|wall street|nasdaq|dow jones|nyse|quarterly profit|revenue surge|q[1-4] results|fiscal deficit|interest rates|rate cut|repo rate|inflation rate|merger|acquisition|private equity|venture capital|bankruptcy|insolvency|shares surge|shares plunge|market capitalization|trade tariff|board-opposition|jio platforms)\b/i;
  if (businessSignal.test(text) || (categories && categories.indexOf('business') !== -1)) {
    if (businessSignal.test(text)) {
      return 'business';
    }
  }

  // 4. NON-INDIA GOVERNANCE & GEOPOLITICS -> WORLD
  // Non-India leaders, foreign military, foreign courts, foreign state affairs
  var foreignEntitySignal = /\b(china|chinese|beijing|cmc|central military commission|zhang youxia|xi jinping|taiwan|united states|white house|pentagon|us congress|trump|biden|kamala|ukraine|russia|kremlin|putin|zelenskyy|israel|netanyahu|gaza|hamas|iran|tehran|ayatollah|hezbollah|united kingdom|downing street|starmer|france|macron|germany|scholz|japan|tokyo|south korea|north korea|kim jong|pakistan|islamabad|bangladesh|dhaka|yunus|sri lanka|nepal|latin america|ecuador|lenin moreno|brazil|lula|argentina|milei|venezuela|united nations|un security council|nato|eu commission|norway|king harald)\b/i;
  
  var indiaSpecificGovSignal = /\b(lok sabha|rajya sabha|supreme court of india|election commission of india|bjp|congress party|aap|narendra modi|amit shah|rahul gandhi|delhi high court|mumbai police|delhi police|isro|rbi|sebi|ed\b|cbi\b|ncb\b)\b/i;

  if (foreignEntitySignal.test(text) && !indiaSpecificGovSignal.test(text)) {
    return 'world';
  }

  // 5. INDIA
  if (isIndiaRelevant_(title, description)) {
    return 'india';
  }

  return (categories && categories[0]) ? categories[0].toLowerCase() : 'world';
}

// ============================================================================
// 3. CROSS-CATEGORY DEDUPLICATION & FINGERPRINTING ENGINE
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
  return minLength > 0 ? (matchCount / minLength) : 0.0;
}

/**
 * Calculates Jaccard similarity index between two keyword sets.
 *
 * @param {Array<string>} keywordsA
 * @param {Array<string>} keywordsB
 * @returns {number} Jaccard index between 0.0 and 1.0.
 */
function calculateJaccardSimilarity_(keywordsA, keywordsB) {
  if (!keywordsA || !keywordsB || keywordsA.length === 0 || keywordsB.length === 0) return 0.0;
  var setA = {};
  var unionSet = {};
  for (var i = 0; i < keywordsA.length; i++) {
    setA[keywordsA[i]] = true;
    unionSet[keywordsA[i]] = true;
  }
  var intersectionCount = 0;
  for (var j = 0; j < keywordsB.length; j++) {
    if (setA[keywordsB[j]]) {
      intersectionCount++;
    }
    unionSet[keywordsB[j]] = true;
  }
  var unionSize = Object.keys(unionSet).length;
  return unionSize > 0 ? (intersectionCount / unionSize) : 0.0;
}

/**
 * Generates a normalized fingerprint for a story candidate.
 *
 * @param {string} title - Candidate headline.
 * @param {string} description - Candidate description or summary.
 * @returns {Object} Fingerprint object { normalizedTitle, keywords, key }.
 */
function computeNormalizedFingerprint_(title, description) {
  var cleanTitle = (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  var text = (title || '') + ' ' + (description || '');
  var keywords = extractKeywords_(text);
  return {
    normalizedTitle: cleanTitle,
    keywords: keywords,
    key: keywords.slice(0, 8).join('-')
  };
}

/**
 * Fetches the rolling 7-day story fingerprints index from GitHub.
 *
 * @param {Object} config - Configuration object.
 * @returns {Object} { items: Array<Object>, sha: string|null }
 */
function getRecentFingerprints_(config) {
  var filePath = 'src/_data/recent-fingerprints.json';
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
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.content) {
        var rawJson = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString('UTF-8');
        var parsed = JSON.parse(rawJson);
        return {
          items: Array.isArray(parsed) ? parsed : [],
          sha: data.sha || null
        };
      }
    }
  } catch (err) {
    Logger.log('Error reading recent-fingerprints.json from GitHub: ' + err.toString());
  }

  return { items: [], sha: null };
}

/**
 * Saves updated fingerprints back to GitHub, maintaining a rolling 7-day window.
 *
 * @param {Object} newEntry - New article fingerprint entry.
 * @param {Object} existingStore - Object with { items, sha }.
 * @param {Object} config - Configuration object.
 */
function saveRecentFingerprints_(newEntry, existingStore, config) {
  var filePath = 'src/_data/recent-fingerprints.json';
  var now = Date.now();
  var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // Filter existing entries to keep only those within rolling 7-day window
  var activeItems = (existingStore.items || []).filter(function(item) {
    if (!item.timestamp) return false;
    var itemAge = now - new Date(item.timestamp).getTime();
    return itemAge <= SEVEN_DAYS_MS;
  });

  // Prepend latest entry
  activeItems.unshift(newEntry);

  var jsonContent = JSON.stringify(activeItems, null, 2);
  var commitMsg = 'Update recent fingerprints index [' + newEntry.slug + ']';

  var url = 'https://api.github.com/repos/' + config.GITHUB_REPO + '/contents/' + filePath;
  var headers = {
    'Authorization': 'token ' + config.GITHUB_TOKEN,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'SamacharDaily-AutoBlogger'
  };

  var payload = {
    message: commitMsg,
    content: Utilities.base64Encode(jsonContent, Utilities.Charset.UTF_8),
    branch: config.GITHUB_BRANCH
  };
  if (existingStore.sha) {
    payload.sha = existingStore.sha;
  }

  try {
    var options = {
      method: 'put',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    var resp = UrlFetchApp.fetch(url, options);
    var code = resp.getResponseCode();
    if (code === 200 || code === 201) {
      Logger.log('Successfully updated recent-fingerprints.json on GitHub (' + activeItems.length + ' entries tracked).');
    } else {
      Logger.log('Warning: Failed to update recent-fingerprints.json (HTTP ' + code + '): ' + resp.getContentText());
    }
  } catch (err) {
    Logger.log('Error committing recent-fingerprints.json: ' + err.toString());
  }
}

/**
 * Checks candidate against all published stories in the last 72 hours across ALL categories.
 * Discards candidate if similarity is >= 75% overlap or >= 65% Jaccard similarity.
 *
 * @param {Object} candidate - Candidate news object { title, description, sourceUrl }.
 * @param {Array<Object>} recentFingerprints - List of recent fingerprint records.
 * @returns {boolean} True if candidate matches an existing story within 72h window.
 */
function isFingerprintDuplicate_(candidate, recentFingerprints) {
  if (!recentFingerprints || recentFingerprints.length === 0) return false;

  var fp = computeNormalizedFingerprint_(candidate.title, candidate.description);
  var now = Date.now();
  var SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

  for (var i = 0; i < recentFingerprints.length; i++) {
    var existing = recentFingerprints[i];
    if (!existing.timestamp) continue;

    var ageMs = now - new Date(existing.timestamp).getTime();
    if (ageMs > SEVENTY_TWO_HOURS_MS) continue; // Only check last 72 hours

    var ageHours = Math.round(ageMs / (1000 * 60 * 60));

    // 1. Direct source URL match
    if (candidate.sourceUrl && existing.sourceUrl && candidate.sourceUrl === existing.sourceUrl) {
      Logger.log('[DEDUPLICATION DISCARD] Exact source URL match with "' + existing.slug +
        '" (' + existing.category + ', ' + ageHours + 'h ago): ' + candidate.sourceUrl);
      return true;
    }

    // 2. Keyword overlap ratio
    var overlap = calculateKeywordOverlapRatio_(fp.keywords, existing.keywords || []);
    if (overlap >= 0.75) {
      Logger.log('[DEDUPLICATION DISCARD] High keyword overlap (' + Math.round(overlap * 100) +
        '% >= 75%) between candidate "' + candidate.title + '" and existing "' +
        existing.slug + '" in [' + existing.category + '] (' + ageHours + 'h ago). Discarding candidate.');
      return true;
    }

    // 3. Jaccard similarity
    var jaccard = calculateJaccardSimilarity_(fp.keywords, existing.keywords || []);
    if (jaccard >= 0.65) {
      Logger.log('[DEDUPLICATION DISCARD] High Jaccard similarity (' + Math.round(jaccard * 100) +
        '% >= 65%) between candidate "' + candidate.title + '" and existing "' +
        existing.slug + '" in [' + existing.category + '] (' + ageHours + 'h ago). Discarding candidate.');
      return true;
    }

    // 4. Normalized title substring / containment check
    if (fp.normalizedTitle && existing.normalizedTitle) {
      if (fp.normalizedTitle === existing.normalizedTitle ||
          (fp.normalizedTitle.length > 25 && existing.normalizedTitle.indexOf(fp.normalizedTitle) !== -1) ||
          (existing.normalizedTitle.length > 25 && fp.normalizedTitle.indexOf(existing.normalizedTitle) !== -1)) {
        Logger.log('[DEDUPLICATION DISCARD] Normalized title near-match with "' + existing.slug +
          '" in [' + existing.category + '] (' + ageHours + 'h ago). Discarding candidate.');
        return true;
      }
    }
  }

  return false;
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
// 5. COMPETITOR ANGLE RSS FETCH & GROQ EDITORIAL SYNTHESIS
// ============================================================================

/**
 * Fetches recent competitor/publisher headline angles via RSS.
 *
 * @param {string} category - Category key ('india', 'world', 'business', 'tech', 'sports')
 * @returns {Array<string>} Array of up to 3 top headline angles.
 */
function getCompetitorAngle(category) {
  const feeds = {
    india: "https://www.indiatoday.in/rss/1206578",
    world: "https://www.indiatoday.in/rss/1206577",
    business: "https://www.indiatoday.in/rss/1206574",
    tech: "https://www.indiatoday.in/rss/1206688",
    sports: "https://www.indiatoday.in/rss/1206550"
  };
  try {
    const feedUrl = feeds[category];
    if (!feedUrl) return [];
    const xml = UrlFetchApp.fetch(feedUrl, { muteHttpExceptions: true }).getContentText();
    const doc = XmlService.parse(xml);
    const items = doc.getRootElement().getChild("channel").getChildren("item");
    return items.slice(0, 3).map(i => i.getChildText("title")).filter(Boolean);
  } catch (e) {
    Logger.log("getCompetitorAngle failed, continuing without it: " + e);
    return [];
  }
}

/**
 * Standalone test function to verify RSS angle fetching across all categories.
 */
function testCompetitorAngle() {
  ["india", "world", "business", "tech", "sports"].forEach(cat => {
    Logger.log(cat + ": " + JSON.stringify(getCompetitorAngle(cat)));
  });
}

/**
 * Helper to safely extract and validate JSON article object from AI text responses.
 *
 * @param {string} rawText - Raw string content returned by AI provider.
 * @returns {Object} Parsed article structure.
 */
function parseArticleJson_(rawText) {
  if (!rawText) throw new Error('Empty response from AI provider.');
  var cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  var parsed = JSON.parse(cleaned);
  if (!parsed.title || !parsed.content) {
    throw new Error('AI response JSON missing required fields (title or content).');
  }
  return parsed;
}

/**
 * Fallback #1: Rewrites article via Google Gemini 3.6 Flash.
 *
 * @param {string} systemPrompt - Standardized system prompt.
 * @param {string} userPrompt - Standardized user prompt.
 * @param {Object} config - Configuration object.
 * @returns {Object} Parsed JSON article structure.
 */
function rewriteWithGemini_(systemPrompt, userPrompt, config) {
  var geminiKey = (config && config.GEMINI_API_KEY) || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!geminiKey) {
    throw new Error('Missing GEMINI_API_KEY in script properties.');
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + geminiKey;
  var payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(url, options);
  var statusCode = resp.getResponseCode();
  if (statusCode !== 200) {
    throw new Error('Gemini API error (' + statusCode + '): ' + resp.getContentText());
  }

  var data = JSON.parse(resp.getContentText());
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
    throw new Error('Malformed response from Gemini API.');
  }

  var text = data.candidates[0].content.parts[0].text;
  return parseArticleJson_(text);
}

/**
 * Fallback #2: Rewrites article via Cerebras (llama3.1-70b with gpt-oss-120b fallback).
 *
 * @param {string} systemPrompt - Standardized system prompt.
 * @param {string} userPrompt - Standardized user prompt.
 * @param {Object} config - Configuration object.
 * @returns {Object} Parsed JSON article structure.
 */
function rewriteWithCerebras_(systemPrompt, userPrompt, config) {
  var cerebrasKey = (config && config.CEREBRAS_API_KEY) || PropertiesService.getScriptProperties().getProperty('CEREBRAS_API_KEY');
  if (!cerebrasKey) {
    throw new Error('Missing CEREBRAS_API_KEY in script properties.');
  }

  var url = 'https://api.cerebras.ai/v1/chat/completions';
  var modelsToTry = ['llama3.1-70b', 'gpt-oss-120b'];
  var lastError = null;

  for (var m = 0; m < modelsToTry.length; m++) {
    var modelName = modelsToTry[m];
    var payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + cerebrasKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var resp = UrlFetchApp.fetch(url, options);
    var statusCode = resp.getResponseCode();
    if (statusCode === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        var text = data.choices[0].message.content;
        return parseArticleJson_(text);
      }
    } else if (statusCode === 404 || statusCode === 400) {
      Logger.log('Cerebras model ' + modelName + ' failed (' + statusCode + '). Trying next option...');
      lastError = new Error('Cerebras API error with ' + modelName + ' (' + statusCode + '): ' + resp.getContentText());
      continue;
    } else {
      lastError = new Error('Cerebras API error (' + statusCode + '): ' + resp.getContentText());
    }
  }

  throw lastError || new Error('Malformed response from Cerebras API.');
}

/**
 * FIX 3: Groq TPD (Tokens Per Day) Guardrail.
 * Checks tracked token counter in Script Properties. Resets every 24h.
 * If within 5,000 tokens of 200,000 (i.e. >= 195,000), skips Groq to avoid 429.
 *
 * @returns {boolean} True if within safe limit; false if limit exceeded.
 */
function checkGroqTpdLimit_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var now = Date.now();
    var lastResetStr = props.getProperty('groq_tpd_reset_time');
    var lastReset = lastResetStr ? parseInt(lastResetStr, 10) : 0;
    var ONE_DAY_MS = 24 * 60 * 60 * 1000;

    if (!lastReset || (now - lastReset) >= ONE_DAY_MS) {
      props.setProperty('groq_tpd_used', '0');
      props.setProperty('groq_tpd_reset_time', now.toString());
      return true;
    }

    var usedStr = props.getProperty('groq_tpd_used') || '0';
    var usedTokens = parseInt(usedStr, 10) || 0;
    if (usedTokens >= 195000) {
      Logger.log('Groq TPD guardrail active: used ' + usedTokens + ' / 200,000 tokens. Skipping Groq to prevent 429.');
      return false;
    }
    return true;
  } catch (e) {
    Logger.log('Error checking Groq TPD counter: ' + e);
    return true;
  }
}

/**
 * Updates tracked Groq daily token usage counter.
 *
 * @param {number} tokens - Tokens consumed by Groq request.
 */
function recordGroqTokenUsage_(tokens) {
  if (!tokens || tokens <= 0) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var usedStr = props.getProperty('groq_tpd_used') || '0';
    var currentUsed = parseInt(usedStr, 10) || 0;
    props.setProperty('groq_tpd_used', (currentUsed + tokens).toString());
  } catch (e) {
    Logger.log('Failed to update groq_tpd_used counter: ' + e);
  }
}

/**
 * Rewrites news wire dispatch into high-credibility SamacharDaily article.
 * Tier 1: Groq Llama 3.3 / GPT-OSS (Primary)
 * Tier 2: Gemini 3.6 Flash (Fallback #1 on 429 / TPD limit)
 * Tier 3: Cerebras Llama 3.1 70B (Fallback #2 on double failure)
 *
 * @param {Object} headline - The selected candidate news dispatch.
 * @param {string} category - Focus category name.
 * @param {Object} config - Configuration object.
 * @returns {Object} Parsed JSON article structure.
 */
function rewriteWithGroq_(headline, category, config) {
  // Anchor current date explicitly to prevent hallucinated historical years (Fix 4)
  var todayDateStr = Utilities.formatDate(new Date(), 'Etc/UTC', 'MMMM d, yyyy');
  var englishEnforceRule = (headline && headline.enforceEnglish)
    ? '\nCRITICAL REQUIREMENT: Output MUST be 100% written in fluent, standard journalistic English. Never output Portuguese, Spanish, French, German, or non-English text for title, seoTitle, dek, or content under any circumstances.\n'
    : '\nCRITICAL REQUIREMENT: All output fields (title, seoTitle, dek, content, why_it_matters, what_happens_next) MUST be written in 100% fluent English even if source dispatches contain foreign-language text.\n';

  var systemPrompt = 'You are a senior investigative and wire editor at SamacharDaily, a high-velocity Indian and international digital news publication.\n' +
    "Today's date is " + todayDateStr + '.\n' +
    englishEnforceRule +
    "Do not reference years, cycles, or 'upcoming' events using any year other than what's explicitly stated in the source headline/description — never infer or carry over a year from your own training data.\n\n" +
    'Editorial Requirements:\n' +
    '1. Craft a high-credibility, authoritative headline (60-90 characters) in sharp newsroom tone (no clickbait).\n' +
    '2. Provide a concise seoTitle (50-55 characters max) optimized for search results, distinct from the main headline.\n' +
    '3. Write a crisp "dek" (1-2 sentence executive summary).\n' +
    '4. Write the core story in at least 4-5 substantial paragraphs (350-450 words total). Include: the main event, relevant background/context that a reader unfamiliar with this topic would need to understand it, and specific named details (people, places, dates, numbers, organizations) drawn only from the source article. Do not write a short summary — write a full explanatory news article a reader could rely on without needing to read the original source.\n' +
    '5. Compose a 2-paragraph "why_it_matters" section analyzing institutional, policy, or market impact.\n' +
    '6. Provide "what_happens_next" (Fix 7): 1 short paragraph (40-70 words) on concrete next steps specific to THIS story — not generic boilerplate. If genuinely nothing concrete is known, write "No confirmed next steps reported yet."\n' +
    '7. Provide a targeted "image_keyword" for editorial photo search (e.g. "semiconductor cleanroom", "cricket stadium floodlights").\n' +
    '8. Provide a concise "video_query" for broadcast coverage search.\n\n' +
    'You MUST return ONLY a valid JSON object matching this exact structure:\n' +
    '{\n' +
    '  "title": "String (authoritative headline, 60-90 characters)",\n' +
    '  "seoTitle": "String (concise, 50-55 characters max)",\n' +
    '  "dek": "String (1-2 sentence executive summary)",\n' +
    '  "content": ["Paragraph 1 string...", "Paragraph 2 string...", "Paragraph 3 string..."],\n' +
    '  "why_it_matters": "Paragraph 1\\n\\nParagraph 2",\n' +
    '  "what_happens_next": "1 short paragraph (40-70 words) on concrete next steps specific to THIS story — not generic boilerplate. If genuinely nothing concrete is known, write \'No confirmed next steps reported yet.\'",\n' +
    '  "image_keyword": "String",\n' +
    '  "video_query": "String"\n' +
    '}';

  const catKey = (category || '').toLowerCase();
  const competitorAngles = getCompetitorAngle(catKey);
  const angleBlock = competitorAngles.length > 0
    ? `\nHere's how top Indian publishers are currently framing similar stories today:\n- ${competitorAngles.join("\n- ")}\nUse a similar hook/framing style (punchy, direct, wire-service tone) — but write 100% original wording using ONLY the facts from the source article below. Do not copy their headlines or sentences.\n`
    : "";

  var userPrompt = 'Category: ' + category + '\n' +
    angleBlock +
    'Source Headline: ' + headline.title + '\n' +
    'Source Description: ' + (headline.description || '') + '\n' +
    'Source Content Snippet: ' + (headline.content || '') + '\n' +
    'Source Outlet: ' + (headline.sourceName || 'News Wire');

  var isGroq429 = false;
  var groqError = null;

  // Tier 1: Groq (Primary) - with FIX 3 TPD Guardrail
  var isGroqTpdAllowed = checkGroqTpdLimit_();
  if (!isGroqTpdAllowed) {
    Logger.log('Groq daily token limit reached (TPD >= 195,000). Skipping directly to Tier 2 (Gemini)...');
    isGroq429 = true;
    groqError = new Error('Groq daily token limit reached (TPD guardrail >= 195,000).');
  } else if (!config.GROQ_API_KEY) {
    Logger.log('Missing GROQ_API_KEY in script properties. Triggering fallback waterfall...');
    isGroq429 = true;
    groqError = new Error('Missing GROQ_API_KEY in script properties.');
  } else {
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

    try {
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

      if (statusCode === 200) {
        var parsed = JSON.parse(resp.getContentText());
        var tokensUsed = (parsed.usage && parsed.usage.total_tokens) ? parsed.usage.total_tokens : 1800;
        recordGroqTokenUsage_(tokensUsed);
        var resultText = parsed.choices[0].message.content;
        var articleObj = parseArticleJson_(resultText);
        Logger.log('Generated via: Groq');
        return articleObj;
      }

      if (statusCode === 429) {
        isGroq429 = true;
        groqError = new Error('Groq API rate limit (429): ' + resp.getContentText());
      } else {
        groqError = new Error('Groq API error (' + statusCode + '): ' + resp.getContentText());
      }
    } catch (err) {
      groqError = err;
      if (err.message && (err.message.indexOf('429') !== -1 || err.message.indexOf('rate') !== -1)) {
        isGroq429 = true;
      }
    }
  }

  // Tier 2 & 3: Fallback Waterfall on 429 / TPD limit
  if (isGroq429) {
    Logger.log('Groq rate limited (429). Falling back to Tier 2 (Gemini 3.6 Flash)...');
    try {
      var geminiArticle = rewriteWithGemini_(systemPrompt, userPrompt, config);
      Logger.log('Generated via: Gemini (Groq fallback)');
      return geminiArticle;
    } catch (geminiErr) {
      Logger.log('Gemini fallback failed: ' + geminiErr.message + '. Falling back to Tier 3 (Cerebras Llama 3.1 70B)...');
      try {
        var cerebrasArticle = rewriteWithCerebras_(systemPrompt, userPrompt, config);
        Logger.log('Generated via: Cerebras (double fallback)');
        return cerebrasArticle;
      } catch (cerebrasErr) {
        Logger.log('All 3 AI tiers (Groq, Gemini, Cerebras) failed.');
        throw new Error('Groq rate limit: ' + (groqError ? groqError.message : '429') + ' | Gemini error: ' + geminiErr.message + ' | Cerebras error: ' + cerebrasErr.message);
      }
    }
  }

  // Throw non-429 Groq error directly
  throw groqError || new Error('Unknown Groq synthesis error.');
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
 * Truncates headline to 55 characters at last full word for SEO title tag.
 * Leaves headroom for the " | SamacharDaily" brand suffix to stay under 60 chars.
 *
 * @param {string} title - Full headline string.
 * @returns {string} Truncated SEO title without trailing punctuation/ellipsis.
 */
function generateSeoTitle_(title) {
  if (!title || typeof title !== 'string') return '';
  var cleanTitle = title.trim();
  if (cleanTitle.length <= 55) return cleanTitle;
  var sub = cleanTitle.substring(0, 55);
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
  var rawSeoTitle = article.seoTitle || article.title || '';
  var seoTitle = generateSeoTitle_(rawSeoTitle);
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

  // Step 2: Cross-Category Fingerprint & Duplicate Detection
  var recentFingerprintsStore = getRecentFingerprints_(config);
  Logger.log('Fetched ' + (recentFingerprintsStore.items ? recentFingerprintsStore.items.length : 0) + ' recent fingerprints from GitHub.');

  // Content Relevance Filtering
  var relevanceCandidates = candidates.filter(function(c) {
    return isRelevantCandidate_(c, key);
  });
  if (relevanceCandidates.length === 0) {
    Logger.log('WARNING: All candidates filtered out by isRelevantCandidate_. Using original candidates.');
    relevanceCandidates = candidates;
  } else {
    Logger.log('Relevance filter kept ' + relevanceCandidates.length + ' of ' + candidates.length + ' candidates.');
  }

  var validCandidates = [];

  for (var i = 0; i < relevanceCandidates.length; i++) {
    var c = relevanceCandidates[i];

    // Reject gambling, betting, and prediction market promotions (AdSense policy risk)
    if (isGamblingContent_(c.title, c.description)) {
      Logger.log('SKIPPED (Gambling/Betting/Prediction Market - Policy Risk): "' + c.title + '"');
      continue;
    }

    // Reject commercial deals, coupons, and retailer price-drops
    if (isCommercialDeal_(c.title, c.description)) {
      Logger.log('SKIPPED (Commercial Deal/Coupon/Price-Drop): "' + c.title + '"');
      continue;
    }

    // Reject wire summary ticker dumps
    if (isWireSummaryDump_(c.title)) {
      Logger.log('SKIPPED (Wire Summary/Brief Dump): "' + c.title + '"');
      continue;
    }

    // Reject syndicated market-research and PR-wire spam
    if (isPressReleaseSpam_(c.title, c.description, c.content)) {
      Logger.log('Skipping market report / PR spam candidate: "' + c.title + '"');
      continue;
    }

    // Reject game puzzle hints (Quordle/Wordle/Crossword) and pure streaming schedules
    if (isAggregatorOrGameHint_(c.title, c.description)) {
      Logger.log('Skipping game hint or pure streaming schedule: "' + c.title + '"');
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

    // Strict Subject-Matter Category Classification Check (Issue #3)
    var classifiedDesk = classifyStoryCategory_(c.title, c.description, c.categories);
    if (classifiedDesk !== key) {
      Logger.log('Desk mismatch: candidate "' + c.title + '" classified as [' + classifiedDesk +
        '] desk, skipping on [' + key + '] desk.');
      continue;
    }

    var slug = generateSlug_(c.title);

    // Exact duplicate slug check
    if (isDuplicate_(slug, key, config)) {
      Logger.log('Skipping exact slug duplicate on GitHub: ' + slug);
      continue;
    }

    // Cross-Category 72-Hour Deduplication Fingerprint Check (Issue #1)
    if (isFingerprintDuplicate_(c, recentFingerprintsStore.items)) {
      // Discard candidate — logged with [DEDUPLICATION DISCARD] inside isFingerprintDuplicate_
      continue;
    }

    // Passed duplicate guards
    c.slug = slug;
    c.categoryName = catCfg.name;
    // Compute trend score before selection
    c.trendingMatch = scoreAgainstTrends_(c, catCfg.trendGeo);
    validCandidates.push(c);
  }

  // Strict deduplication: If all candidates are duplicates or filtered out, discard run rather than forcing duplicate publication
  if (validCandidates.length === 0) {
    Logger.log('All candidates were duplicates or filtered out. Discarding run to prevent duplicate content.');
    return { success: false, reason: 'All candidates filtered out or duplicates' };
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

  // Fix 4: Validate output language AFTER synthesis, before commit
  if (!isArticleOutputEnglish_(article)) {
    Logger.log('Synthesized article failed output language check (detected non-English). Retrying synthesis with strict English instruction...');
    selectedCandidate.enforceEnglish = true;
    try {
      article = rewriteWithGroq_(selectedCandidate, catCfg.name, config);
    } catch (retryErr) {
      Logger.log('Retry synthesis failed: ' + retryErr);
    }
    if (!isArticleOutputEnglish_(article)) {
      Logger.log('Synthesized article failed language verification on retry. Discarding candidate to prevent foreign-language leak.');
      return { success: false, reason: 'Synthesized article output was not English' };
    }
  }

  // Ensure slug is derived from clean English synthesized title
  selectedCandidate.slug = generateSlug_(article.title || selectedCandidate.title);

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

  // Step 8: Update Rolling 7-Day Fingerprints Store on GitHub
  var fp = computeNormalizedFingerprint_(selectedCandidate.title, selectedCandidate.description);
  var fingerprintEntry = {
    title: selectedCandidate.title,
    normalizedTitle: fp.normalizedTitle,
    keywords: fp.keywords,
    category: catCfg.name,
    categoryKey: key,
    slug: selectedCandidate.slug,
    sourceUrl: selectedCandidate.sourceUrl || '',
    timestamp: new Date().toISOString()
  };
  saveRecentFingerprints_(fingerprintEntry, recentFingerprintsStore, config);

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
