const fs = require('fs');
const path = require('path');

const samples = [
  'articles/business/bank-strike-hits-assam-demands-fiveday-week-pension-overhaul-pli-repeal/index.html',
  'articles/tech/cyble-and-uae-cyber-security-council-ink-mou-to-boost-national-threat-intelligence/index.html',
  'articles/world/witkoff-and-kushner-arrive-in-moscow-as-zelenskyy-demands-air-pause/index.html'
];

for (const s of samples) {
  const html = fs.readFileSync(path.join(__dirname, '..', '_site', s), 'utf8');
  console.log('=== ' + s + ' ===');
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (m) {
    const json = JSON.parse(m[1]);
    console.log('Type:', json['@type']);
    console.log('Publisher:', JSON.stringify(json.publisher, null, 2));
    console.log('Headline:', json.headline);
  }
}
