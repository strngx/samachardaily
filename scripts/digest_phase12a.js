const fs = require('fs');
const path = require('path');

const deepData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scratch', 'phase12a_deep_audit.json'), 'utf8'));
const invData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scratch', 'phase12a_inventory_summary.json'), 'utf8'));

console.log('--- PHASE 12A STATISTICAL DIGEST ---');
console.log(`Total Articles: ${invData.totalArticles}`);
console.log(`Indexable: ${invData.indexable}`);
console.log(`Noindex: ${invData.noindexCount}`);
console.log('Categories:', invData.categories);
console.log('Word Count Buckets:', invData.wordCountBuckets);
console.log('Sources:', invData.sources);
console.log('Media:', invData.media);
console.log('Phrase Repetition:', deepData.phraseAnalysis.phrasePatterns);
console.log('Sampled Articles Count:', deepData.sampledCount);

// Categorize editorial function across sampled matrix
const functionCounts = {};
for (const row of deepData.matrix) {
  functionCounts[row.editorialFunction] = (functionCounts[row.editorialFunction] || 0) + 1;
}
console.log('Editorial Functions in Sample:', functionCounts);

// Calculate originality signals across sample
const signals = {
  context: deepData.matrix.filter(r => r.contextPresent === 'YES').length,
  explanation: deepData.matrix.filter(r => r.explanationPresent === 'YES').length,
  comparison: deepData.matrix.filter(r => r.comparisonPresent === 'YES').length,
  timeline: deepData.matrix.filter(r => r.timelinePresent === 'YES').length,
  originalData: deepData.matrix.filter(r => r.originalData === 'YES').length,
  originalReporting: deepData.matrix.filter(r => r.originalReportingEvidence === 'YES').length,
  multiSource: deepData.matrix.filter(r => r.multipleSourceSynthesis === 'YES').length,
  readerGuidance: deepData.matrix.filter(r => r.readerGuidance === 'YES').length
};
console.log('Originality Signals in Sample (out of ' + deepData.matrix.length + '):', signals);
