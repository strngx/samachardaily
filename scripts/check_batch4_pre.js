const fs = require('fs');
const matter = require('gray-matter');

const files = [
  'src/articles/tech/amazon-launches-alexa-in-india-with-early-access-hindihinglish-support-and-ai-feature.md',
  'src/articles/tech/apple-rolls-out-ios-27-with-revamped-siri-and-ai-upgrades-ahead-of-iphone-18-launch.md',
  'src/articles/tech/trump-labels-ai-data-centers-oil-of-next-50-years-blames-google-for-misplaced-project.md',
  'src/articles/business/cpsc-orders-recall-of-hundreds-of-thousands-of-amazon-fingerlight-toys-over-battery-s.md',
  'src/articles/business/gcrta-stalls-service-cuts-until-2027-election-amid-taxincrease-debate.md'
];

files.forEach((file, i) => {
  const content = fs.readFileSync(file, 'utf8');
  const parsed = matter(content);
  const body = parsed.content.trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  console.log(`\nFile ${i+1}: ${file}`);
  console.log('Title:', parsed.data.title);
  console.log('seoTitle:', parsed.data.seoTitle);
  console.log('category:', parsed.data.category);
  console.log('date:', parsed.data.date);
  console.log('slug:', parsed.data.slug);
  console.log('noindex:', parsed.data.noindex || false);
  console.log('video_id:', parsed.data.video_id);
  console.log('author:', parsed.data.author);
  console.log('body word count:', words);
});
