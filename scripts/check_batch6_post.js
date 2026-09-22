const fs = require('fs');
const matter = require('gray-matter');

const batch6 = [
  {
    path: 'src/articles/tech/google-says-android-auto-speedometer-vanishes-because-its-a-paidplan-feature.md',
    before: 88
  },
  {
    path: 'src/articles/tech/gsmarena-lists-display-sizes-resolutions-for-next-years-pro-iphones.md',
    before: 54
  },
  {
    path: 'src/articles/tech/ideagen-retains-verdantix-green-quadrant-leader-status-in-2026-ehs-software-report.md',
    before: 84
  }
];

let totalOld = 0;
let totalNew = 0;
let totalAdded = 0;

batch6.forEach((f, i) => {
  const content = fs.readFileSync(f.path, 'utf8');
  const parsed = matter(content);
  const body = parsed.content.trim();
  const afterWords = body.split(/\s+/).filter(Boolean).length;
  const added = afterWords - f.before;
  
  totalOld += f.before;
  totalNew += afterWords;
  totalAdded += added;

  const hasArabic = /[\u0600-\u06FF]/.test(content);
  const hasOperator = /\b(site:|link:|inurl:|intitle:)/i.test(content);
  const hasPromptScrap = /(as an ai|as an ai language model|in this article|here is the summary)/i.test(content);
  const hasTodo = /TODO|SOURCE VERIFICATION REQUIRED/i.test(body);

  console.log(`\n--- Article ${i+1} ---`);
  console.log('Path:', f.path);
  console.log('Title:', parsed.data.title);
  console.log('Before Words:', f.before);
  console.log('After Words:', afterWords);
  console.log('Words Added:', added);
  console.log('Slug:', parsed.data.slug);
  console.log('noindex:', parsed.data.noindex || false);
  console.log('Contamination Checks:', { hasArabic, hasOperator, hasPromptScrap, hasTodo });
});

console.log('\n====================================');
console.log('TOTAL OLD WORDS:', totalOld);
console.log('TOTAL NEW WORDS:', totalNew);
console.log('TOTAL WORDS ADDED:', totalAdded);
