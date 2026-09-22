const fs = require('fs');
const path = require('path');

const scratchClean = path.join('C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch\\clean_evaluated_thin.json');
const p2cEvaluated = JSON.parse(fs.readFileSync(scratchClean, 'utf8'));

console.log('Sample item from clean_evaluated_thin.json:');
console.log(JSON.stringify(p2cEvaluated.slice(0, 5), null, 2));

// Let's also check clean_p0.json, clean_p1.json, clean_p2.json
const cleanP0Path = path.join('C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch\\clean_p0.json');
const cleanP1Path = path.join('C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch\\clean_p1.json');
const cleanP2Path = path.join('C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch\\clean_p2.json');

const p0List = fs.existsSync(cleanP0Path) ? JSON.parse(fs.readFileSync(cleanP0Path, 'utf8')) : [];
const p1List = fs.existsSync(cleanP1Path) ? JSON.parse(fs.readFileSync(cleanP1Path, 'utf8')) : [];
const p2List = fs.existsSync(cleanP2Path) ? JSON.parse(fs.readFileSync(cleanP2Path, 'utf8')) : [];

console.log(`clean_p0 count: ${p0List.length}`);
console.log(`clean_p1 count: ${p1List.length}`);
console.log(`clean_p2 count: ${p2List.length}`);
