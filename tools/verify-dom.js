const fs = require('fs');
const html = fs.readFileSync('_site/index.html', 'utf8');

console.log('--- HOMEPAGE DOM VERIFICATION ---');

// 1. Trending count
const trendingMatches = html.match(/class="trending-rank"[^>]*>(\d+)</g) || [];
console.log('Trending rank badges found:', trendingMatches.length, trendingMatches.map(m => m.replace(/[^0-9]/g, '')));

// 2. India desk cards
const indiaSection = html.split('aria-label="India Desk"')[1]?.split('</section>')[0] || '';
const indiaLead = (indiaSection.match(/desk-lead/g) || []).length;
const indiaCompact = (indiaSection.match(/desk-compact/g) || []).length;
console.log('India Desk: lead=' + indiaLead + ', compact=' + indiaCompact);

// 3. World desk cards
const worldSection = html.split('aria-label="World Desk"')[1]?.split('</section>')[0] || '';
const worldLead = (worldSection.match(/desk-horizontal/g) || []).length;
const worldCompact = (worldSection.match(/desk-compact/g) || []).length;
console.log('World Desk: lead=' + worldLead + ', compact=' + worldCompact);

// 4. Business desk cards
const bizSection = html.split('aria-label="Business Desk"')[1]?.split('</section>')[0] || '';
const bizLead = (bizSection.match(/desk-business-lead/g) || []).length;
const bizCompact = (bizSection.match(/desk-compact/g) || []).length;
console.log('Business Desk: lead=' + bizLead + ', compact rail=' + bizCompact + ' (total=' + (bizLead + bizCompact) + ')');

// 5. Tech desk cards
const techSection = html.split('aria-label="Tech Desk"')[1]?.split('</section>')[0] || '';
const techLead = (techSection.match(/desk-lead/g) || []).length;
const techCompact = (techSection.match(/desk-compact/g) || []).length;
console.log('Tech Desk: lead=' + techLead + ', compact=' + techCompact);

// 6. Sports desk cards
const sportsSection = html.split('aria-label="Sports Desk"')[1]?.split('</section>')[0] || '';
const sportsLead = (sportsSection.match(/desk-sports-lead/g) || []).length;
const sportsCompact = (sportsSection.match(/desk-compact/g) || []).length;
console.log('Sports Desk: lead=' + sportsLead + ', compact=' + sportsCompact);

// 7. Video stories
const videoSection = html.split('aria-label="Watch The Story - Video Journalism"')[1]?.split('</section>')[0] || '';
const videoItems = (videoSection.match(/video-supporting-item/g) || []).length;
console.log('Watch The Story: supporting items=' + videoItems);

// 8. Newsletter field
const hasNewsletterBox = html.includes('newsletter-input-field');
console.log('Newsletter input field present:', hasNewsletterBox);

// 9. Article Deduplication across sections
const sectionIndia = html.split('aria-label="India Desk"')[1]?.split('</section>')[0] || '';
const sectionWorld = html.split('aria-label="World Desk"')[1]?.split('</section>')[0] || '';
const sectionBusiness = html.split('aria-label="Business Desk"')[1]?.split('</section>')[0] || '';
const sectionTech = html.split('aria-label="Tech Desk"')[1]?.split('</section>')[0] || '';
const sectionSports = html.split('aria-label="Sports Desk"')[1]?.split('</section>')[0] || '';
const sectionTrending = html.split('aria-label="Trending Stories"')[1]?.split('</section>')[0] || '';

function extractArticles(sec) {
  const matches = sec.match(/href="(\/articles\/[^"]+)"/g) || [];
  return [...new Set(matches.map(m => m.replace(/href="|"|index\.html/g, '')))];
}

const trendList = extractArticles(sectionTrending);
const indiaList = extractArticles(sectionIndia);
const worldList = extractArticles(sectionWorld);
const bizList = extractArticles(sectionBusiness);
const techList = extractArticles(sectionTech);
const sportsList = extractArticles(sectionSports);

const allDeskArticles = [...indiaList, ...worldList, ...bizList, ...techList, ...sportsList];
const trendingOverlap = trendList.filter(u => allDeskArticles.includes(u));
console.log('Trending and Lower Desks overlap count:', trendingOverlap.length);
if (trendingOverlap.length > 0) {
  console.error('FAIL: Found overlapping articles:', trendingOverlap);
} else {
  console.log('PASS: 0 duplicate stories across Trending and Lower Desks!');
}

