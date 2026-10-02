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

  return {
    phase15b: phase15bData
  };
};
