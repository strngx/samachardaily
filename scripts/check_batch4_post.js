const fs = require('fs');
const matter = require('gray-matter');

const files = [
  {
    path: 'src/articles/tech/amazon-launches-alexa-in-india-with-early-access-hindihinglish-support-and-ai-feature.md',
    before: 80
  },
  {
    path: 'src/articles/tech/apple-rolls-out-ios-27-with-revamped-siri-and-ai-upgrades-ahead-of-iphone-18-launch.md',
    before: 87
  },
  {
    path: 'src/articles/tech/trump-labels-ai-data-centers-oil-of-next-50-years-blames-google-for-misplaced-project.md',
    before: 64
  },
  {
    path: 'src/articles/business/cpsc-orders-recall-of-hundreds-of-thousands-of-amazon-fingerlight-toys-over-battery-s.md',
    before: 47
  },
  {
    path: 'src/articles/business/gcrta-stalls-service-cuts-until-2027-election-amid-taxincrease-debate.md',
    before: 56
  }
];

let totalAdded = 0;

files.forEach((f, i) => {
  const content = fs.readFileSync(f.path, 'utf8');
  const parsed = matter(content);
  const body = parsed.content.trim();
  const afterWords = body.split(/\s+/).filter(Boolean).length;
  const added = afterWords - f.before;
  totalAdded += added;

  // Check contamination
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
