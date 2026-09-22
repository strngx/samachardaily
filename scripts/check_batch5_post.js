const fs = require('fs');
const matter = require('gray-matter');

const batch5 = [
  {
    path: 'src/articles/business/starlink-leads-satellite-internet-as-europe-commits-156b-to-rival-projects.md',
    before: 48
  },
  {
    path: 'src/articles/business/studded-jewellery-lifts-indias-august-export-growth-as-cpd-falls-labgrown-diamonds-su.md',
    before: 53
  },
  {
    path: 'src/articles/tech/ai-nova-tab-set-for-india-launch-via-flipkart-reveals-orange-option-and-flat-rear-des.md',
    before: 73
  },
  {
    path: 'src/articles/tech/apples-ios-27-embeds-private-frameworks-enabling-thirdparty-ai-to-replace-siri.md',
    before: 88
  },
  {
    path: 'src/articles/tech/cybersecurity-stocks-rally-as-threats-mount-crowdstrike-palo-alto-sentinelone-surge.md',
    before: 54
  }
];

let totalAdded = 0;

batch5.forEach((f, i) => {
  const content = fs.readFileSync(f.path, 'utf8');
  const parsed = matter(content);
  const body = parsed.content.trim();
  const afterWords = body.split(/\s+/).filter(Boolean).length;
  const added = afterWords - f.before;
  totalAdded += added;

  const hasArabic = /[\u0600-\u06FF]/.test(content);
  const hasOperator = /\b(site:|link:|inurl:|intitle:)/i.test(content);
  const hasPromptScrap = /(as an ai|as an ai language model|in this article|here is the summary)/i.test(content);

  console.log(`\n--- Article ${i+1} ---`);
  console.log('Path:', f.path);
  console.log('Title:', parsed.data.title);
  console.log('Before Words:', f.before);
  console.log('After Words:', afterWords);
  console.log('Words Added:', added);
  console.log('Slug:', parsed.data.slug);
  console.log('noindex:', parsed.data.noindex || false);
  console.log('Contamination Checks:', { hasArabic, hasOperator, hasPromptScrap });
});

console.log('\n====================================');
console.log('Total words added across 5 articles:', totalAdded);
