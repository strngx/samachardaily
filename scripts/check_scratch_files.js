const fs = require('fs');

const scratchDir = 'C:\\Users\\Xeno\\.gemini\\antigravity-ide\\brain\\b88e28ae-cdde-45cd-a235-6d2860462e6b\\scratch';
if (fs.existsSync(scratchDir)) {
  const files = fs.readdirSync(scratchDir);
  console.log('Scratch files:', files);
} else {
  console.log('Scratch dir does not exist at path');
}
