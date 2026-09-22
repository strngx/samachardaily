const fs = require('fs');

const p2c = fs.readFileSync('PHASE_2C_THIN_CONTENT_PRIORITY_AUDIT.md', 'utf8');
console.log('Length of Phase 2C audit:', p2c.length);

// Check headings
const headings = p2c.split('\n').filter(line => line.startsWith('## '));
console.log('Headings in Phase 2C audit:\n', headings);
