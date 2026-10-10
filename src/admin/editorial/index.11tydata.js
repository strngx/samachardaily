const fs = require('fs');
const path = require('path');

module.exports = function () {
  const queuePath = path.resolve(__dirname, '../../../data/editorial/phase-15b-content-queue.json');
  let phase15bData = null;
  if (fs.existsSync(queuePath)) {
    try {
      phase15bData = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    } catch (err) {
      console.error('Error loading phase-15b-content-queue.json in index.11tydata.js:', err);
    }
  }

  // Phase E: Build quality index JSON from article corpus (deterministic, no AI, no external APIs)
  let corpusIndexJson = JSON.stringify({ articles: [], generatedAt: new Date().toISOString(), count: 0 });
  try {
    const { buildQualityIndex } = require('../../../scripts/build-quality-index.js');
    corpusIndexJson = buildQualityIndex();
  } catch (err) {
    console.error('[Phase E] Error building quality index in index.11tydata.js:', err.message);
  }

  // Phase G: Build site health index JSON (deterministic, read-only)
  let siteHealthJson = '{}';
  try {
    const { buildSiteHealthIndex } = require('../../../scripts/build-site-health.js');
    siteHealthJson = buildSiteHealthIndex();
  } catch (err) {
    console.error('[Phase G] Error building site health index in index.11tydata.js:', err.message);
  }

  return {
    phase15b: phase15bData,
    editorial: {
      corpusIndexJson,
      siteHealthJson
    }
  };
};
